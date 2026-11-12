# 13: 候选镜像实际运行三进程与持久化媒体

**What to build:** 维护者从合并后的根源码构建一个来源可核对的本地候选镜像，使用既有 nginx 与 PM2 三进程方式运行；浏览器配置、iframe 访问和媒体持久化在实际容器中可用。

**Blocked by:** 03 — [用官方启动同步保留旧数据](03-startup-sync-data-retention.md).

**Status:** resolved (local image rehearsal 85/85; nothing published or deployed)

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“构建、运行与配置”和镜像/媒体验证矩阵；同时遵守[共同执行约束](../README.md#执行约束)。本票验证当前候选，18 必须从最终修订重建并复验。

- [x] 主构建重新从根源码生成干净 staging，完整核对生成副本与独有配置；使用专用多阶段源码镜像完成真实本地构建，不用旧副本、已有镜像、闲置 runtime 入口或预构建产物链替代。
- [x] builder/runtime 统一 Node 22.23.4、pnpm 10.6.1、Prisma 6.5.0，按最终 frozen lock 安装；构建不连接数据库，运行时官方同步及失败阻断复用 03 的已验收入口。
- [x] 采用普通 Next 输出及 Next start 4200，取消不匹配的 standalone；完整产物、静态资源、运行依赖、PM2 工作目录和实际 hoisted 启动入口正确，API 3000、worker 和 frontend 分立，nginx 5000 对外。
- [x] 实际验证 Next/Nest 产物及 Prisma、bcrypt、sharp、Temporal 原生依赖可加载；分别检查三进程、数据库、Temporal 和常规 API，不能把编译成功或单个 HTTP 200 代替全部就绪。
- [x] 主配置 MCP_ONLY 留空或不设置，不使用有真值含义的字符串 false；浏览器同域 /api、服务端内部 API、FRONTEND_URL 和完整 SSO_SERVER_URL 保持契约。
- [x] 按实际消费建立公开构建变量白名单，区分编译值与运行值，用非敏感哨兵在最终浏览器验证 API、父 origin、上传、storage 及启用开关；不把 SSO_PARENT_ORIGINS 描述为已生效的服务端限制。
- [x] 验证前端 iframe CSP、API 身份头转发及响应暴露、Connection 清空、300 秒超时、禁 buffering/cache、标准输出日志和临时 pid；uploads 的 CSP/nosniff 维持原范围。
- [x] 在真实镜像用户和持久化卷权限下验证旧媒体读取、新上传、Import/Editor、视频 Range、删除与重启持久性；nginx 与直接 Next 上传入口分别检查，旧帖子媒体引用继续可读。
- [x] 主镜像健康检查使用 /api/，外部 /api 的跳转和最终响应保持兼容；健康结果与进程、数据库、Temporal、MCP 检查分开记录。
- [x] 记录完整 commit、输入清单/摘要、锁文件、公开配置、工具版本、基础镜像 digest、目标架构、生成资产和最终 image ID；若启用 GTM 下载记录结果与摘要，未启用时不新增跟踪服务，无 registry digest 时如实说明。
- [x] 根镜像及本地 Compose 保留开发用途与官方同步；本地构建无发布或部署副作用，外部拓扑不改动，如确需外部环境调整只交付最小字段差异和理由，不宣称位级可复现或线上已验证。

## Answer

2026-11-11 / 12，分支 `codex/ticket-13-image-runtime`（工作树 `~/Desktop/Web/postiz-worktrees/13`）。

**候选镜像已从合并后的根源码真实构建并在本地真实运行：85 项断言全部通过，0 失败。未推送、未部署、未接触真实数据库。**
过程记录见 [rehearsals/13](../../rehearsals/13/README.md)，逐项 PASS/FAIL 见
[`rehearsals/13/evidence/summary.txt`](../../rehearsals/13/evidence/summary.txt)，其余证据在同一目录。

### 产物与来源

| 项目 | 值 |
| --- | --- |
| image | `postiz-ticket13:candidate` |
| image ID | `sha256:6e7344fcf7ad1ab6b11a6a2f39ca27fa8a4d2d6e80b0409bb4fe7455fe490489` |
| 源 commit（干净工作区） | `7ad47092c09a8e265e151d01320fbbd1e7747f5f`，`contextMatchesHead: true` |
| 输入清单摘要 | `sha256:d6812dab3de6c4f5c6871e58c52f383ea1bef733004fb7cf18331ab1f1fdfcc8`（`k8s/BUILD_CONTEXT_MANIFEST.json`） |
| lockfile | `sha256:caba97c3e0351d85580979737e06f22ca825039605b232b49d51f1e2c2929197` |
| Dockerfile | `sha256:a1afb7881180e24eeb6f770e53f59cb2b78c51ff06c9205a16339e3e5df3697d` |
| 公开构建配置 | `sha256:4b3eb53c3b40fb91de1fd166dc2da5da48d37f408f7f162453b4929c0597374f` |
| PM2 / nginx / entrypoint / next.config | `2318b72b…` / `9c460391…` / `4f8419ee…` / `53e6f50d…`（完整值见 provenance） |
| 基础镜像 | `node@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f`；`node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d` |
| 目标架构 | `linux/arm64` |
| 生成资产 | `apps/frontend/public/g.js` 未生成（`NEXT_PUBLIC_GTM_ID` 为空，未新增跟踪服务） |
| registry digest | **没有**：本地构建从未登录/推送，image ID 只在本机 Docker daemon 有效 |

完整记录在 `k8s/BUILD_PROVENANCE.json`（gitignored，由 `build-local.sh` 每次生成；本次副本见
`rehearsals/13/evidence/50-provenance.json`）。不宣称位级可复现。

### 命令与结果

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"
./k8s/prepare-build-context.sh                     # 969 generated files, clean, commit 7ad47092
NEXT_PUBLIC_VERSION=ticket13-build-sentinel \
  ./k8s/build-local.sh --tag postiz-ticket13:candidate   # 仅本地 docker build
cd .scratch/postiz-stable-merge-implementation/rehearsals/13
IMAGE=postiz-ticket13:candidate ./run-rehearsal.sh       # 85 passed, 0 failed
```

| 门禁 | 结果 |
| --- | --- |
| `pnpm run typecheck` | 通过（frontend/backend/orchestrator） |
| `pnpm run lint` | `0 errors, 713 warnings` |
| `pnpm run test` | 44 files / **368 tests** passed |
| `pnpm run build` | 通过 |
| `./k8s/prepare-build-context.sh --check` | in sync |
| `./k8s/tests/prepare-build-context.test.sh` | 38 passed |
| `./k8s/tests/runtime-contract.test.sh` | 54 passed |
| image rehearsal | **85 passed, 0 failed** |

### 镜像实测（全部在运行中的容器内）

- **工具链**：Node `v22.23.4`、pnpm `10.6.1`、Prisma CLI `6.5.0`、PM2 `7.1.2`、nginx `1.22.1`（`nginx/1.22.1`）。
- **原生依赖**：bcrypt 可 hash/compare；sharp 实际编码出 PNG；生成的 Prisma client 对真实 PostgreSQL 15
  执行 `select 1`；`@temporalio/worker` 与 `@temporalio/core-bridge` 可加载。
- **三进程**（`pm2 jlist`，`/app`，镜像真实用户 root）：
  `backend` → `/app/apps/backend/dist/apps/backend/src/main.js`；
  `frontend` → `/app/node_modules/next/dist/bin/next`，`cwd=/app/apps/frontend`，`next start -p 4200`；
  `orchestrator` → `/app/apps/orchestrator/dist/apps/orchestrator/src/main.js`。三者均 `online`、`restarts: 0`。
- **端口**：nginx `5000` 307、backend `3000` 200、frontend `4200` 307、orchestrator `3002` 404（在监听）。
  `.next/standalone` 不存在；`.next/static`、`public`、`next.config.js`、`package.json`、hoisted Next 入口均存在。
- **健康检查**：镜像 `Healthcheck` 为 `curl -f http://localhost:5000/api/`；容器 `health=healthy`，
  `restartCount=0`、`oomKilled=false`；API 在启动后约 **10 秒**开始应答，连续 3 次 200。
- **`/api/`**：`200`，正文 `App is running!`（backend `RootController` 的 `GET /`）。
  **`/api`（无尾斜杠）**：`301` + `Location: http://localhost:5000/api/`，随后 `/api/` 返回 200——
  外部清单探针的跳转与最终响应均保留。
- **代理/头部**：`Origin: http://localhost:5000` 时返回
  `access-control-allow-origin: http://localhost:5000`、`access-control-allow-credentials: true`、
  `access-control-expose-headers: reload,onboarding,activate,auth,showorg,impersonate,logout,x-copilotkit-runtime-client-gql-version`；
  常规路由 `/api/monitor/queue/main` 200 且返回 `Queue main is healthy.`；前端响应保留
  `Content-Security-Policy: frame-ancestors *;`。镜像内 `/etc/nginx/nginx.conf` 实测逐条保留
  `Auth/Showorg/Impersonate` 转发、`Connection ''`、`proxy_read_timeout 300s`、`proxy_send_timeout 300s`、
  `proxy_buffering off`、`proxy_cache off`、`access_log /dev/stdout`、`error_log /dev/stderr`、`pid /tmp/nginx.pid`。
- **公开配置（编译值 vs 运行值）**：构建期哨兵 `NEXT_PUBLIC_VERSION=ticket13-build-sentinel` 出现在
  浏览器包 `/app/apps/frontend/.next/static/chunks/0gwjweotulmgi.js`；同一镜像以相反的运行期值启动
  （`ticket13-runtime-sentinel`、`/runtime-uploads-sentinel`、`https://runtime-sentinel.invalid`、
  `http://127.0.0.1:5000/api`）后，这些运行期哨兵**没有**出现在浏览器包或页面中，而构建期的
  `/api`、`/uploads` 与 `https://merchant.connexup-dev.net` 保留。相对地，非公开运行值确实来自环境：
  页面携带运行期 `FRONTEND_URL=http://localhost:5000`、`"storageProvider":"local"`、`"isGeneral":true`。
- **媒体**：卷内旧文件 `/uploads/2024/05/06/legacy.png` 经 nginx 读取 200、内容不变，并带
  `x-content-type-options: nosniff` 与 uploads 自己的 CSP；用应用自己的 `LocalStorage` 在镜像内新建上传，
  返回 `http://localhost:5000/uploads/2026/11/11/<hex>.png`，经 nginx 200、`content-type: image/png`；
  `Range: bytes=0-0` 经 nginx 返回 **206** 且带 `content-range: bytes 0-0/…`；经同一 storage 删除后 nginx 404；
  再次上传并 `docker restart` 后，新上传与旧文件都仍为 200，三进程仍在线（重启会重新执行官方 schema 同步）。

### 一项需要知道的行为（不是本票要修的产品缺陷）

直接访问 Next（`localhost:4200`）的 `/api/uploads/<path>` 得到 `404`（跳转到 `http://localhost:4200/404`）：
`next.config.js` 的 `redirects()/rewrites()` 在 `next build` 时求值并写入路由清单，而
`STORAGE_PROVIDER` 不是构建输入（部署通过运行时 `envFrom` 注入）。线上媒体路径是 nginx 的
`/uploads` alias（已验 200/206），所以流程不受影响；若要直连 Next 该路由，需把 `STORAGE_PROVIDER`
纳入构建输入，本票未擅自扩大构建/部署耦合。另：本机曾出现一次启动后瞬时的 502，PM2 未记录重启；
演练改为"连续 3 次 200"并要求重试，最终运行 `restartCount=0`。

### 对后续票的关键事实

- **没有可达的 Temporal，backend 永远不会监听 3000**：`TemporalRegisterMissingSearchAttributesModule`
  在 `onModuleInit` 里 `await` operator 调用（`listSearchAttributes`）。缺 Temporal 时 Nest 初始化卡住，
  nginx 一直 502、HEALTHCHECK 变 unhealthy，而 PM2 仍显示 `online`。本演练用 Temporal CLI dev server
  (`1.10.0` / server `1.32.2`) 作为外部替身。票 17 必须区分"进程 alive"与"API ready"。
- Redis 用 `redis:7-alpine`；PostgreSQL 用 `postgres:15`（15.19）。Temporal、Redis、PostgreSQL 都是
  隔离替身，不是部署环境版本。
- **18 必须从最终修订重建镜像并重跑本演练**；本票只证明当前候选 `6e7344fc…`。

### 仍未验证

- 真实部署环境（PostgreSQL/Redis/Temporal 版本、namespace、Elasticsearch）、真实 PVC/Secret 与线上 Pod。
- 真实商户 SSO、父应用 origin 交互、渠道 OAuth、Import/Editor 的浏览器 UI 流程（属 03/04/07/10）。
- MCP/agent 功能本身（启动失败在本镜像中非致命，但未验证可用性）。
- 无 registry digest，也没有任何推送/部署/CI 重新启用。
