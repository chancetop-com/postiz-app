# 构建与运行时升级核查

日期：2026-11-11。本文记录只读事实；具体决定只存放在 [决定源码构建与部署运行时的升级方式](../issues/07-build-runtime-strategy.md#answer)。没有执行产品合并、安装依赖、构建镜像、启动应用、迁移或部署。

## 坐标与证据

- 当前产品基准 C：`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`；当前 checkout H：`501e87dbfb2ca6e44662baec308afa468a922b38`。
- 锁定稳定版 S：`a5affe62c74e39c1e7ac960d50d8418b807d532c`（v2.25.3），从已有隔离诊断仓库读取 Git 对象，不把尚未解决冲突的工作树当作最终结果。
- 两项只读核查分别复核构建输入/产物与运行契约；代码先使用 CodeGraph，配置和历史 Git 对象按需读取。当前没有可用构建产物，以下静态推断均须在执行阶段验证。
- 完整旧定制与副本统计见 [打包证据](customization-packaging-evidence.md)；外部声明和未知运行事实见 [部署证据](deployment-evidence-2026-11-11.md)。历史实际生产构建命令仍未证实。

## 构建链的明确差异

| 项目 | 原行为与稳定版证据 | 含义 |
| --- | --- | --- |
| 源码来源 | C 的 `k8s/build-postiz.sh:13` 固定旧电脑目录，默认分支重新复制源码，`--local` 分支使用已有镜像；两分支最后都部署。诊断 merge 中 804 个 k8s blob 全部仍等于 C。 | 不能直接从旧副本或任意现存镜像宣称构建了最终合并源码；原脚本不是本地验证入口。 |
| 新增安装输入 | S `apps/frontend/package.json:8–9` 新增 `postinstall: node scripts/fetch-gtm.mjs`，对应脚本在 `apps/frontend/scripts/`；C 复制脚本的前端文件白名单没有复制该目录，也未复制两套 Nest 应用的 `nest-cli.json`。 | 即使再次运行旧源码复制步骤，也会漏掉安装/编译输入。需要完整、可核对的应用与构建配置集合。 |
| 工具链 | S 根 `package.json` engines/根 `Dockerfile.dev` 使用 Node 22.23.4，pnpm 为 10.6.1；旧 k8s 镜像为 Node 22.20 且未固定全局 pnpm。S 的 Volta Node 仍是 20.17.0。 | 构建和运行版本须统一，不能依赖过时的 Volta 默认值或本机现有 Node 22.22.3。 |
| 前端输出 | C `apps/frontend/next.config.js:6` 无条件新增 `output: 'standalone'`；S 没有该项。C 实际使用的 `var/docker/ecosystem.config.cjs:17–19` 却运行 `next start -p 4200`，没有独立执行 standalone `server.js`。 | 原打包设置与选用启动方式不一致；保留 Next start 可采用 S 的常规输出，并验证 `.next`、静态资源、public 与依赖路径。 |
| 两份 PM2 配置 | 两个 k8s Dockerfile 选用 `var/docker/ecosystem.config.cjs`，不是旁边的 `k8s/ecosystem.config.cjs`。前者 backend/orchestrator 指向 `/app/apps/backend/dist/apps/backend/src/main.js` 与 `/app/apps/orchestrator/dist/apps/orchestrator/src/main.js`；根 tsconfig 的 rootDir 与应用 outDir 支持该预期。 | 尚无产物证明；验收必须核对实际文件和镜像内路径，不能依据闲置同名配置。 |
| 预构建入口 | `k8s/Dockerfile.runtime` 要求的依赖和产物被同目录 `.dockerignore` 排除，也未完整复制 public；现有构建脚本不使用它。 | 它不能充当本次源码构建通过的替代证据。 |
| 数据启动 | C 根 `pnpm pm2` 链调用带 `--accept-data-loss` 的 Prisma db push；S 去掉该参数但仍调用 db push；k8s 直接 PM2 启动不走这条链。 | 镜像构建、服务启动、schema 应用是不同动作；应用能启动不证明旧数据兼容。 |
| 系统依赖与媒体 | B→S 根 Dockerfile 的可执行变化仅 Node 版本；未新增 ffmpeg/yt-dlp。S `UploadFactory:34–51,54–90` 的处理器依赖 cloudflare 和对应远端配置，local storage 返回空处理器；`MediaService:354–389,408–410` 处理无处理器情况。 | 没有源码依据为升级另装本地媒体处理二进制，也不能把现有 local storage 说成已启用所有新版可选媒体处理能力。 |

## 运行契约的明确差异

| 项目 | 已证实事实 | 验证时不能混淆的事项 |
| --- | --- | --- |
| 路由与健康检查 | C/S RootController 均仅提供 GET `/`；nginx `location /api/` 的 `proxy_pass http://localhost:3000/` 将 `/api/` 映射到该路由，`/api/health` 则成为没有对应控制器的 `/health`。外部清单探针为 `/api`。 | 镜像 HEALTHCHECK 的旧 `/api/health` 不匹配源码；无尾斜杠的 `/api` 跳转及探针实际结果需要本地检查。健康路由本身不证明前端、worker 或业务接口就绪。 |
| 完整 API 模式 | S `ApiModule:84–104` 以 `process.env.MCP_ONLY` 的 truthiness 选择控制器；`PublicApiModule:18` 同样分流。非空字符串（包括 `false`）会关闭常规接口，但仍保留根健康控制器。 | 核心健康返回成功不能证明商户 SSO、发帖、媒体等路由仍在；现有完整 flow 所需配置是未设置或空值。 |
| MCP 启动 | C 对 `startMcp` 保留不阻塞、失败记录日志的定制；S 改为等待，并加入 Express 5 wildcard `/copilot/{*splat}`、PostValidationExceptionFilter 和 CORS 更新。 | 需要在新版初始化结构中保留已定非阻塞行为，同时纳入兼容上游变化；不能覆盖整个旧 main 来跳过新逻辑。 |
| 代理与文件 | C nginx 的前端 iframe header、API Connection/300s/禁缓冲、日志 stdout/stderr、`/tmp` pid 和上传 location 均是已存在配置；上传 location 的 CSP 与前端不同。 | 不把前端 `frame-ancestors *` 泛化到所有路径；也不把公网 Envoy 与内网 nginx Ingress 的限制视为同一层配置。 |
| 部署形态 | 已核对的环境声明使用单应用镜像、Pod 5000、内部 API 3000、前端 4200、`/uploads` PVC；公网为 Envoy HTTPRoute，内网另有 nginx Ingress。 | 这些是仓库声明，不是 Pod 当前运行状态。不能凭历史文档改写环境拓扑，也不能凭镜像 root 用户配置推断挂载权限已验证。 |

## 配置与生成资产

- C `apps/frontend/src/app/(app)/sso/page.tsx:23–25` 直接在客户端读取 `NEXT_PUBLIC_SSO_PARENT_ORIGINS`，按逗号拆分并精确匹配；它用于没有 URL `auth_code` 时的既有消息入口。单靠运行时 envFrom 不能证明浏览器包含正确父 origin。本票不推导新增 origin/source 检查，也不修改已定 OAuth relay 规则。
- C/S 的 `(app)/(provider)/(extension)/layout.tsx` 为 force-dynamic，通过 `VariableContextComponent` 传递地址、storage、开关等，进入 React context 与 `window.vars`（`variable.context.tsx:65–76`）。公开变量仍可能被构建内联，不能把动态 layout 当作所有值都能运行时改变的证明；最终链路应使用构建值与运行值不同的非敏感哨兵验证。
- `BACKEND_INTERNAL_URL` 由服务端 internal fetch 使用；SSO 请求直接使用完整 `SSO_SERVER_URL`。`SSO_PARENT_ORIGINS` 没有服务端消费者，不能写成已生效策略。`STORAGE_PROVIDER` 还参与 Next 配置的 rewrites/redirects。
- S `apps/frontend/scripts/fetch-gtm.mjs:7–10,29–49` 可读取根 `.env`；设置 GTM ID 时下载并生成 `public/g.js`。因此 staging 不应复制真实 `.env`；如所选配置启用此功能，应记录生成资产及外部下载结果，不能仅凭 commit 与 lock 声称位级可复现。
- S local storage 继续生成 `${FRONTEND_URL}/uploads/YYYY/MM/DD/...`；新版 stream/类型识别与 Next upload range/路径处理可兼容纳入。经 nginx 的 `/uploads/` 直接读取卷，`/api/uploads/` 则进入 Nest；不能用直连 Next 开发服务器的结果代替正式镜像路由验证。

## 未验证的事实

安装、编译、镜像内 native 模块装载、进程启动、HTTP 请求、上传卷读写、浏览器 iframe/SSO/OAuth、真实数据和 Temporal 任务均未在本轮运行。已有基线因缺少依赖而未启动构建/类型/lint/test，不属于通过，也不能称为合并新增失败。

镜像来源 commit、实际 Pod imageID、真实环境版本与漂移等继续采用部署证据中的未知标记；这些未知不阻塞当前规划，但不能用于宣称上线就绪。
