# 12: 缺少可选服务时核心操作仍可用

**What to build:** 商户在未配置 OpenAI 等可选服务时仍能完成核心内容操作；受保护的可选接口及时给出既定不可用结果，MCP 启动失败能够被观察但不会阻塞主 API。

**Blocked by:** 10 — [旧媒体与新上传贯通编辑流程](10-media-editing.md); 11 — [公开预览保持匿名访问与异常回退](11-public-preview.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的可选服务契约和“无可选服务”验证矩阵；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 具备必需基础服务但不配置 OpenAI、RunPod、Deepgram 等可选服务时，从页面完成 SSO、日历、媒体上传/选择、编辑和提交排程、分析，以及匿名公开预览，不要求开通付费服务。
- [x] 排程提交经真实内部 API 写入隔离服务并在界面呈现正确状态；本票证明无可选服务时核心入口可用，实际发布和旧任务接续由 15、16 证明并在 18 联合复验。
- [x] OpenAI key 未定义和空字符串分别验证；已鉴权且具备权限的 chat/agent 请求及时返回既定 503 JSON，鉴权与权限检查仍有效，不新增 AI 总开关或通过编译排除冒充接口可用。
- [x] 保留并适配上游 Node handler、CORS 和 useSingleEndpoint；在真实请求边界核对返回内容、状态及完成行为，而非仅检查启动配置。
- [x] 对 MCP 异步启动注入受控 reject，观察日志且确认主 API 与核心页面继续可用；保留既有 unhandledRejection 日志处理，不扩大成吞掉所有异常或通用重试。
- [x] 可选媒体处理关闭时原上传完成；启用受控替身时身份、轮询与失败收尾仍正确，复用 10 的流程证据，不恢复隐藏工具入口。
- [x] 保存缺配置、接口拒绝和 MCP 失败的实际运行证据，分别标明已通过、失败与未验证；日志不含凭据，不把本地替身结果当作真实外部服务集成通过。

## Answer

2026-11-12 于 `codex/ticket-12-optional-services`（起点 `f0e11bd0`，即 `codex/postiz-stable-merge` 当前 tip）完成；测试提交 `dfee7794`。合并 `codex/postiz-stable-merge` 时该分支仍是 `f0e11bd0`，结果为 `Already up to date`，没有冲突或额外合并提交。

**本票没有改变产品行为**：02 合入后 OpenAI 缺配置 503、MCP 异步启动非阻塞、可选媒体处理门控与核心路由均已是既定实现。本票把它们变成可执行的回归验证，并补齐上游 Node handler、CORS、`useSingleEndpoint` 与 MCP 失败路径的请求/启动边界证据。未新增 AI 总开关，未修改编译 exclude，未恢复任何隐藏工具入口。

### 实际改动的文件

- 新增 `tests/optional-services-copilot.test.ts`（9 用例）：真实 `CopilotController` + 真实 `AuthMiddleware` + 真实 `PoliciesGuard`/`PermissionsService` + 真实 `SubscriptionExceptionFilter`/`HttpExceptionFilter`，`listen(0)` 真实 HTTP；只在持久化、Mastra、CopilotKit Node handler 边界替身。
- 新增 `tests/optional-services-mcp.test.ts`（4 用例）：直接 import 真实 `apps/backend/src/main.ts`，仅替换 Nest、`AppModule`、配置检查与 `startMcp`；验证 `startMcp(app).catch(...)` 与进程级 `unhandledRejection` 的真实代码。
- 新增 `tests/optional-services-core-flows.test.ts`（12 用例）：真实 SSO/Posts/Analytics/Media/Public 控制器、真实 `AuthMiddleware`/策略 guard/过滤器，`listen(0)` 真实 HTTP；仅替身持久化、平台分析与外部 SSO 校验。
- 修改 `tests/session-copilot-headers.test.tsx`：为三个 Copilot 界面各补一条 `useSingleEndpoint === true` 断言（既有行为，不改实现）。
- 无 `apps/`、`libraries/` 生产代码改动。未手改 `k8s/apps/**`；`./k8s/prepare-build-context.sh --allow-dirty` 后 `--check` 通过（见下方说明）。

### 证据矩阵

| 场景 | 入口与替身边界 | 实际结果 |
| --- | --- | --- |
| OpenAI key 未定义 | 真实 HTTP `POST /copilot/chat`、`/copilot/agent`，带 `auth`/`showorg`，无 `STRIPE_PUBLISHABLE_KEY` | 两者均 503、body `{"error":"AI not configured"}`；Node handler/CopilotRuntime/OpenAIAdapter 0 次构造；`MastraService.mastra` 未调用；固定 warn 文案 `OpenAI API key not set, chat functionality will not work` |
| OpenAI key 空字符串 | 同上，`OPENAI_API_KEY=''` | 两者均 503、同一 JSON；运行时不构造 |
| 未鉴权 | 不带 `auth` 请求 `chat`/`agent` | 401、空 body、`logout: true`；不含 `AI not configured`，AI 相关 warn 未触发（不泄露配置状态） |
| 已鉴权但套餐无 AI | `STRIPE_PUBLISHABLE_KEY` 已设置，订阅 `FREE`（`ai: false`）请求 `/copilot/agent` | 402、带 `/billing` URL；handler 未执行、未返回 503；证明权限检查先于 AI 配置检查 |
| 已配置 AI | `OPENAI_API_KEY='sk-ticket-12'`，Node handler 替身在外部边界接管响应 | 204；`endpoint` 分别为 `/copilot/chat`、`/copilot/agent`；CORS `origin` 含 `FRONTEND_URL`、`credentials: true`；无 Cookie 的 `NOT_SECURED` 下仍为 true；`OpenAIAdapter` 收到 `{model:'gpt-4.1'}`；agent 路径调用 Mastra |
| MCP reject | 真实 `main.ts`，`startMcp` 注入 `Promise.reject(new Error('mcp transport refused'))` | `Logger.error('MCP startup failed (non-fatal)', Error)`；随后 `app.listen(3000)` 仍执行；`/copilot` 大 body parser、全局 pipe、三个异常过滤器均安装；`startMcp` 只调用 1 次（无通用重试） |
| MCP 挂起 | `startMcp` 返回永不 resolve 的 Promise | 未 await，`app.listen(3000)` 仍执行；证明失败/挂起都不会阻塞 API |
| unhandledRejection | 捕获 `main.ts` 注册的监听器并直接调用 | 输出 `Unhandled promise rejection (non-fatal): <message>`，返回 `undefined`，未吞掉其它异常、未新增策略 |
| CORS / body parser | 真实 `main.ts` 的 `NestFactory.create` 入参 | `rawBody:true`；`allowedHeaders`/`exposedHeaders` 均含 `x-copilotkit-runtime-client-gql-version`；origin 含 `FRONTEND_URL` |
| useSingleEndpoint | 真实主布局/Agent/预览 wrapper | 三处 `useSingleEndpoint === true`，既有每界面请求头差异不变 |
| SSO 入口 | 真实 `POST /auth/sso`，只替身 SSO 校验与用户/组织持久化 | 200 `{"login":true}`；`auth` header 可验签为新建商户用户，`showorg=org-sso`；创建参数含 `Acme Ltd`、`merchant-12@sso.merchant`、`Provider.GENERIC` |
| 日历 | 真实 `GET /posts?startDate&endDate` + 真实 auth/策略 | 200 返回日历列表；服务收到 `org-1` 与两个 ISO 日期 |
| 媒体上传 | 真实 `POST /media/upload-server` + 真实 multer 流式引擎 + 真实 `LocalStorage` | 201 `{id,status:'ready'}`；文件真实落盘；`UploadFactory.processorEnabled()` 为 false，`createProcessor()` 为 null，故无需轮询、无新增外部依赖 |
| 提交排程 | 真实 `POST /posts`，`type:'schedule'` | 201 `{id:'post-1',state:'QUEUE'}`；真实校验与 `mapTypeToPost` 后交给 `createPost(org,'WEB')`，负载原样保留 |
| 编辑排程 | 真实 `PUT /posts/:id/date` | 200；`changeDate(org,'post-1',date,'schedule',false)` |
| 分析 | 真实 `GET /analytics/:integration` | 200 返回指标；`checkAnalytics(org,'int-1','30')` |
| 匿名公开预览 | 真实 `GET /public/posts/:id`，不带任何会话头 | 200；集成信息保留；`batchId`/`childrenPost` 被剥离 |
| 媒体处理门控 | 真实 `UploadFactory` 配置矩阵 | local + RunPod → false；cloudflare 缺任一 RunPod 值 → false；cloudflare + 两值齐 → true；关闭时不创建 processor |
| 可选处理开启后的轮询/失败收尾 | 复用 10 的 `tests/media-processing.test.ts` | 该文件仍全绿：关闭不轮询；开启时 `auth`/`showorg`/`impersonate`、`ready` 收尾、失败保留原件、连续失败放弃 |

命令与结果（Node 22.23.4，pnpm 10.6.1，Prisma 6.5.0）：

| 命令 | 结果 |
| --- | --- |
| `git log -1 --oneline` / `git merge codex/postiz-stable-merge` | `f0e11bd0`；`Already up to date` |
| `pnpm install --frozen-lockfile` | 通过（33.2s） |
| `pnpm vitest run tests/optional-services-copilot.test.ts` | 9 passed |
| `pnpm vitest run tests/optional-services-mcp.test.ts` | 4 passed |
| `pnpm vitest run tests/optional-services-core-flows.test.ts` | 12 passed（首次运行时测试自身有两处搭建错误：`MediaController` 装饰器在 import 期读取上传目录、`AuthController` 需要 Throttler 模块；均修正测试搭建，不涉及产品代码） |
| `pnpm run typecheck` | 通过（frontend / backend / orchestrator） |
| `pnpm run lint` | 0 errors / 713 warnings（与 10 的基线一致，新增测试无告警） |
| `pnpm run test`（连续两次） | 两次均 47 files / 393 tests passed；本票前基线 44 files / 368 tests，新增 25 个用例 |
| `pnpm run build` | 通过（frontend / backend / orchestrator） |
| `./k8s/prepare-build-context.sh --check` | 首次因 tip 既有生成副本的 mtime/行尾差异报 drift；按约定执行 `./k8s/prepare-build-context.sh --allow-dirty` 后 `--check` 通过：`in sync with f0e11bd0` |

### 已通过 / 失败 / 未验证

- **已通过**：缺 key（未定义与空串）的 503、未鉴权 401 与权限拒绝 402 先于 AI 检查、配置后的 Node handler/CORS/`useSingleEndpoint`、MCP reject 与挂起的非阻塞、`unhandledRejection` 既有日志、SSO/日历/上传/排程/编辑/分析/匿名预览的真实 HTTP 边界、媒体处理配置门控。
- **失败**：产品代码无失败。测试搭建阶段的两次失败已定位并修正，不计为产品失败。
- **未验证**：真实浏览器完整 flow（18）；真实 PostgreSQL/Temporal 写入与实际发布（15、16）；真实 OpenAI/RunPod/Deepgram 与真实 MCP 就绪；`MCP_ONLY` 运行模式（13/18）。本票的排程写入以服务边界替身证明，不声称真实队列/数据库结果已发生。

### 边界说明与交接

- 核心路由的真实 import 链仍包含 AI SDK 类（例如 `PostsController` → `AgentGraphService` 在模块加载时以占位 key 构造 `ChatOpenAI`）。这属于既有结构，不是本票新增；本票证明的是“不配置可选服务时请求与启动行为正确”，不声称二进制里不存在 AI 代码，也不把编译 exclude 当功能关闭。
- `./k8s/prepare-build-context.sh --allow-dirty` 暴露 `k8s/apps/frontend/public/magic.svg` 与根源码的既有行尾差异（CRLF/LF），规范化后 `git diff` 为空，未提交任何 k8s 业务内容；`--check` 在刷新后通过。18 在干净检出上复验时若再次遇到该 mtime/行尾 drift，应按同一准备器刷新，不应手改 `k8s/apps/**`。
- **15 需要知道**：可选服务缺失不构成排程门控；`POST /posts` 校验、`mapTypeToPost` 与 `createPost(..., 'WEB')` 在无 OpenAI/RunPod/Deepgram 时照常到达服务边界，媒体记录在处理器关闭时为 `status:'ready'`，客户端不会进入轮询。真实写库、Temporal 排队、发布与旧任务接续仍由 15/16 证明。
- **17 需要知道**：MCP 启动失败只记录 `MCP startup failed (non-fatal)`，不能当作 MCP 就绪；`unhandledRejection` 仅记录日志，不是恢复或重试机制，也未扩大为吞掉所有异常。AI 未配置的唯一契约是已鉴权/有权限后的 503 `{"error":"AI not configured"}`；401/402 必须先于它返回。故障恢复票不应把这两条可观察信号改写成全局禁用或通用重试。
- 证据位置：`tests/optional-services-copilot.test.ts`、`tests/optional-services-mcp.test.ts`、`tests/optional-services-core-flows.test.ts`、`tests/session-copilot-headers.test.tsx`；可选处理轮询复用 `tests/media-processing.test.ts`。
