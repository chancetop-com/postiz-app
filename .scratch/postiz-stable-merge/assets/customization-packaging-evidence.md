# 定制逐项证据：打包、部署、文档与静态资源

日期：2026-11-11。只读调查结果；没有运行安装、构建、启动、测试辅助服务器、镜像推送或部署。本文不代表构建通过或兼容方案已获确认。

## 比较坐标与覆盖

- B：`0b554e684483932d394e703208fe21648e7acd6f`，定制前基线。
- F：`f042c177`，第一定制提交；C：`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`，第二定制提交及定制终态。
- S：`a5affe62c74e39c1e7ac960d50d8418b807d532c`，本轮选定 stable。
- 本报告覆盖 B→C 的 **821 个路径：17 个非 k8s 路径、全部 804 个 k8s 路径**。根 `apps/frontend/`、`apps/backend/src/`、`libraries/` 的业务行为由同轮其他报告负责；本报告包含 `apps/backend/tsconfig.build.json`。
- Git tree/blob、提交 diff、配置和文档为直接证据；当前 indexed JS 先通过 CodeGraph 阅读。已读 `docs/agents/domain.md` 与 `local-audit-2026-11-11.md`。没有可引用的领域 ADR。
- 原仓库 S 部分 blob 为 promisor 缺失对象。首次普通 diff 触发 Git 自动取对象并因 DNS 失败；之后所有 Git 历史读取均加 `GIT_NO_LAZY_FETCH=1`。S 内容最终从主调查准备的临时副本读取：`/private/tmp/postiz-wayfinder-three-way-n90eeeum/repo`。没有把缺失对象误判成上游删除。
- 自动合并观察来自主调查在该临时副本执行的 H（当前 dev）→S 诊断合并，仍存在冲突；本文仅只读检查其 index。H 相比 C 的后续提交是工具/代理说明，不是本范围产品修改。最终决议以主调查完整冲突表为准。
- 文件行号若未标 S 或“诊断合并”，均指 C/当前原工作区。内部部署地址、个人构建目录、凭据值不在本文展开。

## 17 个非镜像路径的完整清单

“F”表示第一提交已改变且 C 保持；“C新增”表示第二提交加入。此范围没有 F→C 的整文件撤销，也没有既有这些文件的第二次 hunk 修改。

| 路径 | 提交及可观察变化 | 上游/诊断合并证据 | 仍需明确的取舍 |
| --- | --- | --- | --- |
| `.env.example` | F：末尾增加三个注释项 `SSO_SERVER_URL`、`SSO_PARENT_ORIGINS`、`NEXT_PUBLIC_SSO_PARENT_ORIGINS`（125–128）。模板给服务根 URL；当前 SSO 源码需要完整验证 URL。 | S 在同一末尾增加 reCAPTCHA 与 provider visibility/migration 示例，另增媒体处理、Apple、MCP/OAuth 等选项；诊断为文本冲突。S 无本定制 SSO 项。 | 保留真实完整端点契约；确认浏览器 origin 配置的注入时机；不能把未被服务端消费的 `SSO_PARENT_ORIGINS` 当作已生效限制。 |
| `Dockerfile.dev` | F：只新增 `# USER www` 注释（28）；**没有新增/删除可执行 USER 指令**，不能说这个提交切换了用户。仍全源码 `COPY .`、安装、build、`nginx && pnpm run pm2`（22–30）。 | S 只把基础 Node 从 22.20 升至 22.23.4；诊断自动合并保留新基础镜像和本地注释。 | 实际选用哪个镜像入口、PVC 权限目标；注释不是已验证的权限方案。 |
| `README.md` | F：追加后端已构建 JS、前端 dev、mock SSO、`docker/` Compose 四段手工启动命令（148–158）。 | S 修改介绍/功能/文档；诊断自动合并，四段追加命令仍在末尾（201–211）。 | 启动片段缺少构建前置说明；mock 被后台启动且 stderr 丢弃，并非测试结果。真正受支持的开发/验收命令待定。 |
| `apps/backend/tsconfig.build.json` | F：exclude 增加 `libraries/nestjs-libraries/src/chat` 与 `agent`（8–9）。 | S 与 B 相同，诊断保留本地 exclude。 | 这是编译配置意图，不能单凭 exclude 推导所有相关 import 或运行功能已被排除；需结合稳定版依赖图和实际编译结果。 |
| `pnpm-lock.yaml` | F：唯一变更是在 `basic-ftp@5.2.0` 条目加入 deprecated 提示（9693）；没有包版本升级。 | S lock 有 8,305 行增加、8,235 行删除，`basic-ftp` 的包、snapshot、引用均已消失；诊断文本冲突。 | 本地这一提示没有需要恢复的运行能力；不能为保留提示重新引入旧依赖。依赖集合以 S 与实际定制需求核对。 |
| `var/docker/nginx.conf` | F：去掉显式 `user www`，error/access 日志到 stderr/stdout，pid 改 `/tmp`；API 清空 Connection、读写超时 300s、禁 buffer/cache；前端位置加 `frame-ancestors *`（1–14、29、37–40、75）。 | S 与 B 完全相同；诊断保留本地变更。 | 300s/流式代理是否业务需要；具体父域白名单或通配符的最终契约。uploads 位置仍有独立 `frame-ancestors 'none'`，不能把前端 header 泛化到所有响应。 |
| `docker/docker-compose.yaml` | F新增：从根 `Dockerfile.dev` 构建（3–7）；应用暴露 5000，挂载 nginx 与持久卷，SSO 指向本机 mock 的完整路径（28–39）；附 Postgres17、Redis7.2、Temporal1.28.1、ES7.17.27、Temporal UI/admin。 | S 无此路径；它不会自动吸收 S 对根 `docker-compose.yaml` 的配置更新。 | 明确仅作本地测试还是正式受支持入口；目前含开发凭据示例、公开本机数据库/Redis/Temporal端口，且应用只等待 DB/Redis health，不等待 Temporal ready。 |
| `docker/dynamicconfig/development-sql.yaml` | C新增：最大 ID 长度 255；开启 search-attribute cache 每次读取刷新（1–6），注释明确仅开发。Compose :127/:135 挂载。 | S 无此路径。 | 是否维持开发用途；不能当成线上配置证据。 |
| `var/docker/ecosystem.config.cjs` | C新增，内容来自先前 k8s 副本：backend/orchestrator 指向各自 `apps/.../dist/apps/.../main.js`；frontend Next4200；三进程 fork、production、2G 重启阈值（5、17–19、29、36）。 | S 无此路径；诊断本地新增保留。 | 这是 k8s Dockerfile 实际复制并执行的 PM2 配置，需与产物及可执行文件位置一起验证。 |
| `doc/Logo.png` | C新增 4,410 bytes PNG。与 `apps/frontend/public/logo-postiz.png` 以及其 k8s 副本逐字节相同；紫色几何连线图标。 | S 无此路径。 | 是否保留文档原件是资产管理决策；实际展示位置由前端清单说明。 |
| `doc/sso-test/index.html` | C新增手工测试页：构造 `/sso?auth_code=...` 并放入 iframe（136–158）；支持 reload/clear/preset。监听 `SSO_NEEDS_ACCOUNT_CREATION` 与 `channel_added`/`success===true`（180–190），没有 origin/source 检查。 | S 无此路径。 | onload 只证明 iframe 加载事件，不能证明登录、授权、回调正确；监听名称与当前 `CHANNEL_UPDATED` 不一致。它不覆盖 postMessage 传入 auth_code 的方案。 |
| `doc/sso-test/mock-sso-server.js` | C新增内存 mock：默认8081，只接 `POST /api/sso/verify`，读取 `auth_code`；任意非空值都映射到商户，返回 snake_case 字段（26、38–60）；打印输入值。 | S 无此路径。 | 文件头仍写8080且仅根 URL（14），与真正默认端口/完整路径不一致；启动输出还读旧 camelCase 属性（77）。这是测试替身，不能用来验收真实兑换服务的拒绝、过期、一次性使用或身份校验。 |
| `docs/sso-migration-plan.md` | C新增1,148行设计/勾选清单，包含 cookie→sessionStorage、iframe、SSO 设计。 | S 无此路径；其“已完成”内容不能替代源码事实。详见下一节。 | 将事实、待办与过时方案分开；不能凭该文档把额外开户接口或父应用改造追加为既定范围。 |
| `doc/social-platform-comments-api.md` | C新增344行、标注2026-04-13的评论 API 调研；声明 YouTube 拉取/回复已实现（37），引用控制器/服务（342–343）。 | B/F/C/S tree 均无其所引用的 `social-comments.controller.ts` 与 `comments/comments.service.ts`。S 无此文档。 | 属于历史调研和可能未提交工作线索，不能验收为已经交付的产品功能；其他调查负责对当前 provider 方法交叉核对。 |
| `var/social-media-platform-execution-plan.md` | C新增550行、标注2026-04-15的产品/API/MCP需求与供应商方案；F01–F24、A01–A14是计划（15–60），评论能力仍列缺口（174–180）；385/400又说 comments 目录开发中。 | S 无此路径；没有该文所引评论服务的 Git tree 证据。 | 选型、价格、平台权限、授权描述没有在本调查重新验证；它们不是本次 stable 合并的隐含实施范围。 |
| `var/social-media-tools-research.md` | C新增566行竞品/架构/评论能力调研；183–186把评论读取/回复/MCP列缺口，515–525提出未来阶段。284引用旁边 PNG。 | S 无此路径。 | 与“API支持文档称 YouTube 已完成”存在文档内部不一致；当前产品能力以代码和运行证据裁定。 |
| `var/social-media-tools-research.assets/image-20260414143850204.png` | C新增40,320 bytes 图片，展示外部服务平台对 Posts/Comments/DMs/Reviews 的支持矩阵。 | S 无此路径；仅作为上述调研插图。 | 不是 Postiz UI 或实现验证截图；不构成平台能力保证。 |

## SSO 文档与源码/辅助文件的不一致

以下是应归入定制清单的“文档债”，不是新增实现要求：

1. 迁移计划 :596/:725/:1020/:1050/:1123 设计并勾选 `/auth/sso/create-account`；:656/:1018/:1147 声称不存在用户时返回403并让父应用创建。当前已观察实现自动创建用户和组织，没有此独立端点；初查已记录。DTO 文件存在不足以证明端点存在。
2. 文档 :570/:714/:862 仍使用 URL `token` 与请求体 `{token}`；mock 和当前正式入口使用 `auth_code`。旧 `/auth/sso?token` 是兼容入口，不代表后端 body 仍接受 token。
3. 文档 :614/:857 追加 `/api/sso/verify` 并预期 camelCase；当前 SSO 服务直接使用完整 `SSO_SERVER_URL` 并读取 `merchant_id`/`merchant_name`。`.env.example` 的根地址示例和 mock 文件头不能直接复制成正确配置。`docker/docker-compose.yaml:28` 的完整地址与 mock 契约相符。
4. 文档 :1065 写 `frame-ancestors 'self'`，:1144 要求白名单；当前 nginx 是 `*`。文档 :1066 勾选 Google/GitHub/OAuth 登录按钮改 popup，也不能替代前端实际渠道 relay 流程清单。
5. 文档 :4 声明不修改父页面，但多处流程又要求父页面处理开户通知。必须先明确现有父应用真实契约，而不能按示例改动对方应用。
6. 测试页 :185 的开户通知分支和 :188 的渠道通知分支不能证明当前流程实现了这些消息。mock 接受任意字符串，且预置对象用 snake_case、启动日志取 camelCase，因此会打印 undefined 名称；这些缺陷均未在本轮改动。

## 全部 k8s 文件：来源与差异

通过 Git tree OID 比较而不是文件名推测：

| 快照 | k8s 总数 | 有根同名且 blob相同 | 有根同名但 blob不同 | 无根同名 |
| --- | ---: | ---: | ---: | ---: |
| F | 326 | 318 | 1 | 7 |
| C | 804 | 797 | 2 | 5 |

- F 新增326个；C 再新增478个；**F→C 没有修改或删除任何既有 k8s 文件**。F 中无根对应的两个 SSO DTO 与 `var/docker/ecosystem.config.cjs` 在 C 才加入根目录，C 还加入独有 `.core-ai/tool-permissions.json`。这解释了 unique 数量变化。
- C 的797个相同文件按根目录对应项复用业务审计；不是797项额外定制逻辑。包含 `.npmrc`、package/lock/workspace/tsconfig、三应用源码和配置、libraries、nginx、实际使用的 PM2 配置。主报告的全路径 manifest 承担逐文件映射，本文不复制799行。
- **差异1 `k8s/.dockerignore`**：独立构建上下文规则，排除 node_modules、backend/orchestrator dist、frontend .next、git、日志、shell脚本、Dockerfile等（1–33）；根规则还排除 Markdown/LICENSE等，二者用途不同。
- **差异2 `k8s/apps/frontend/public/magic.svg`**：根2,419 bytes、7个CRLF；k8s2,412 bytes、0个CRLF。将根 CRLF 归一为 LF 后与副本逐字节相同。**只是换行格式，无图形、颜色、品牌行为变化**。

5个独有文件逐项：

| 路径 | 当前可观察作用 | 需确认或失配 |
| --- | --- | --- |
| `k8s/Dockerfile` | F新增；Node22.20 builder + slim runtime；builder安装pnpm和依赖、build；复制根node_modules、三应用产物及frontend public；运行nginx+`pm2-runtime`；5000端口和 `/api/health` 健康检查（10–67）。 | 全局pnpm未像根Dockerfile固定10.6.1；runtime没有根启动链的schema步骤；frontend PM2相对路径、workspace产物与Next启动需要运行证据。S已固定Node22.23.4，唯一Dockerfile不会随源码同步自动更新。 |
| `k8s/Dockerfile.runtime` | F新增，只包装预构建产物，`USER www`，直接pm2-runtime（20–40）。 | 它要求的node_modules/dist/.next恰被同目录.dockerignore排除；也没有复制frontend public。当前build-postiz脚本不引用这个文件。不能把它列为已验证入口。 |
| `k8s/build-postiz.sh` | F新增，构建/推送并部署。固定个人工作区目录（13）及部署常量（19–23）。默认模式删除并重复制app/library/package配置（99–136），ACR build（148–155）；`--local`则tag/push已有镜像（80–85）。共同执行kubectl set image和rollout（166–174）。 | 任何模式都会部署；不是只读/本地验证命令。源码来自固定目录，运行地点不能证明所构建的是当前checkout。许多cp错误被忽略；失败的上下文复制需单独验证。 |
| `k8s/ecosystem.config.cjs` | F新增另一份PM2配置，backend/orchestrator指向根 `./dist/apps/...`，orchestrator阈值1G（5、29、36）。 | **不是两个Dockerfile选用的配置**；二者复制的是 `var/docker/ecosystem.config.cjs`。该闲置配置与实际复制的apps路径不一致，不能拿它解释线上进程。 |
| `k8s/.core-ai/tool-permissions.json` | C新增工具allow列表，含固定个人机器k8s目录。 | 代理工具元数据，不是Kubernetes清单/运行时权限。是否保留属于仓库清理取舍，不能当成部署访问控制。 |

## 三方合并为何不会自动修好 k8s

S 没有 `k8s/`，Git 不认识该目录是根源码的复制品，因此新增副本可无冲突保留，同时根文件大幅升级。

- C 的799个有根对应项中，直接用 **C k8s blob 对比 S 根blob**：432个相同，351个不同，16个根路径在S中没有；另有5个k8s独有项。16包含8个本地新增与8个上游删除，不能全部算上游删功能。这里直接比较副本，故与“C根对S根”的434/349口径相差`.dockerignore`和`magic.svg`两项。
- **诊断合并直接验证：804个 k8s stage-0 blob 全部仍等于C。** 按799个根对应项，当前index是452个相同、329个不同、11个根文件尚冲突、7个根路径不存在；另5个无C根对应。这是未解决诊断状态，不是最终合并计数。
- 干净合并后的根 `package.json` 已要求Node22.23.4并更新依赖，k8s副本仍是旧package/lock；干净合并后的根源码也不同于对应k8s源码。直接以已提交k8s目录构建会继续使用旧代码。
- `build-postiz.sh` 默认模式会重新复制源码，故“必须永久手工同步799个文件”不准确。但要先确认它实际指向正确checkout；它保留的独有Dockerfile仍是Node22.20，复制新package后仍有版本契约差异。`--local`完全不走源码同步。
- 根Dockerfile与README自动合并成功，只说明文本能组合；不等于某条构建路径打包到了所有新文件。`.env.example`和lock的文本冲突亦仍未解决。

## 构建、运行、数据与部署的具体决策点

| 主题 | 已有证据 | 后续必须取得的具体结论/证据 |
| --- | --- | --- |
| 实际入口 | 新local Compose和`.github/workflows/build-containers.yml:52–59`用根Dockerfile；根`docker-compose.yaml:3`用官方latest镜像；k8s脚本用独有Dockerfile并部署。 | 本次目标到底是哪条构建发布链、镜像引用及其受控源码位置；可以用去敏配置/流水线记录确认，无需提供secret值。 |
| Node/pnpm/依赖 | S根Node22.23.4；k8s Node22.20；根固定pnpm10.6.1而k8s安装未固定；S Next16.4.2、Nest11.2.7、Copilot1.72及其他依赖发生升级。S `volta.node`仍20.17.0，与engines不一致。 | 统一实际构建/运行版本，解析lock冲突；不能使用本地旧镜像成功代表新依赖成功。没有在本轮安装或编译。 |
| 数据启动行为 | C根Dockerfile→`pnpm pm2`→`pm2-run`→`prisma-db-push --accept-data-loss`（package18/34）；S移除accept-data-loss，但保留启动时db push链；k8s直接pm2-runtime不执行该链。 | 明确schema应用发生在何时、由哪个入口负责、如何验证数据保留及恢复；不能默认两条镜像启动行为一致。 |
| 新schema/工作流 | stable根代码升级，镜像副本不自动刷新；S新增多代post workflow及媒体/video/clipping活动。 | schema和Temporal兼容性由专项证据确认；仅删除accept-data-loss不是迁移验收。 |
| 前端环境/SSO | `.env.example`是注释模板；local Compose配置完整mock地址，却没有父origin列表；k8s只显式传NODE_ENV build arg，根Dockerfile只显式声明NEXT_PUBLIC_VERSION。 | 确认线上完整SSO端点及浏览器origin配置由何处注入、运行产物最终看到什么值；不索取凭据。 |
| 产物与文件权限 | k8s多阶段仅复制特定产物；实际PM2 frontend使用cwd `apps/frontend`+相对Next脚本；一个runtime Dockerfile非root，另一个为root注释方案。 | 用所选构建入口核对Next执行文件、public资源、数据库客户端、上传卷读写与健康检查；当前没有产物可证明这些已满足。 |
| 无副作用验证入口 | `var/docker/docker-build.sh:5`先删本地镜像，:6–7要求不存在的`dist`/`devcontainer` stages；`build-postiz.sh`会push并部署。 | 后续验证应有明确不部署、不接生产数据库的命令及上下文；不能直接运行这些现成脚本当作测试。 |
| k8s配置归属 | 仓库k8s目录主要是构建副本，没提供线上Deployment/PVC/ConfigMap/probe实况；历史交接提到外部部署仓库。 | 取得实际部署清单位置或去敏快照，确定env、持久卷、探针、资源、镜像和schema步骤。历史说明不替代集群事实。 |
| 文档与辅助材料 | SSO计划、comment API说明、调研和测试页各有过时/互相不一致内容。 | 标出保留的业务契约与不适用的旧方案；不要把规划需求无意扩大成stable升级必做功能。 |

## 可复核命令与限制

本报告的关键结论可通过离线 `git diff --no-renames B C -- <path>`、`git ls-tree -r <ref>`、S显式`git show`、诊断副本`git ls-files --stage`复核；应保持 `GIT_NO_LAZY_FETCH=1`。副本一致性以blob OID判定，magic差异另做CRLF字节归一验证，PNG做SHA-256与目视检查。

没有做容器/Node启动、网络SSO验证、browser测试、数据库接入或集群访问。本报告未更改生产代码、脚本或配置；唯一写入文件是本证据报告。
