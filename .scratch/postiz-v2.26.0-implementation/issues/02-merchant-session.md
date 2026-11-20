# 02: 商户从父应用进入并保持标签页身份

**What to build:** 商户从父应用 iframe 进入 Postiz，即使浏览器阻止第三方 Cookie，也能进入自己的商户共享账户。刷新、组织切换、代入和退出均遵循所在标签页的会话。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [既有 sessionStorage 契约](../../postiz-v2.26.0-wayfinder/../postiz-stable-merge-implementation/assets/session-storage-adaptation.md)

- [x] 用隔离父页面和兑换服务运行既有 URL 与消息入口。首次兑换建立商户共享账户和组织，再次兑换复用同一账户。核对无效 code、兑换失败及默认组织选择与定制基线一致。
- [x] 禁用第三方 Cookie，分别在两个标签页选择不同组织。刷新后从实际请求核对组织和身份，确认其中一页切换组织时另一页保持自己的选择。
- [x] 核对 `auth`、`showorg` 和 `impersonate` 在响应头、sessionStorage 与后续请求之间的往返，包括跨源响应头可读性与既有 Cookie 兼容读取。用上传记录核对实际归属。
- [x] 从管理员身份开始、结束代入，分别走普通退出和 401。记录各自页面去向和下一次请求的身份，与现行定制行为对照。

## Answer

2026-11-20，实现分支以 `--no-ff` 合入 `postiz-v2.26.0-integration`，0 个未合并路径；全量回归 61 文件 / 614 用例通过，类型检查 exit 0。生产会话行为在合并候选中本已符合定制契约，本票不再改动流程，只把 `main.ts` 内联的 CORS 策略提取为可测试的单一来源，并用真实 HTTP + 真实浏览器会话固定住商户 iframe 的标签页身份契约。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-02-merchant-session` |
| 实现提交 | `7da008887`（`test(auth): pin merchant session over real HTTP`） |
| 分支头 | `528b187b1`（先把当时集成分支 `b8f1545e3` 合入实现分支） |
| 合入前集成分支 | `eb512dbbc`（已含 ticket 03 邀请与 ticket 06 公开 Connect Link） |
| 合并提交 | `8a27e713876e08fd8bd167b48a11e6ae2d22ddcc`，父提交 `eb512dbbc` 与 `528b187b1` |
| 祖先校验 | `eb512dbbc`、`528b187b1`、`7da008887`、`a4318b8a5`（ticket 03）、`4f425ec8d` / `d736f79a6`（ticket 06）均 `merge-base --is-ancestor HEAD` 为真 |
| 冲突 | 0 个未合并路径（`git ls-files -u` 为空）；无 `<<<<<<<`/`>>>>>>>` 标记；`git diff --check` exit 0 |
| ticket 03/06 保留 | 合并相对 `eb512dbbc` 只触及 3 个路径（`cors.config.ts`、`main.ts`、`tests/merchant-sso-http.test.ts`），邀请流程与 Connect Link 同意/回调文件未变，相关用例随全量回归通过 |

### CORS 单一来源（本票唯一的生产代码变化）

| 位置 | 变化 |
| --- | --- |
| `apps/backend/src/cors.config.ts`（新增） | 导出 `getCorsOptions()`，把原 `main.ts` 内联的 `cors` 对象原样搬出：`allowedHeaders` 含 `auth`、`showorg`、`impersonate`、`oauth-state-token`、`org-invite`、`x-postiz-org` 等；`exposedHeaders` 含 `auth`、`showorg`、`impersonate`、`logout`、`oauth-state`、`oauth-state-token`；`origin` 仍为 `FRONTEND_URL`、`localhost:6274`、可选 `MAIN_URL` 与 `CANVA_APP_ORIGIN`；`credentials` 仍只在非 `NOT_SECURED` 时开启 |
| `apps/backend/src/main.ts` | 删除内联 `cors` 对象，改为 `cors: getCorsOptions()`；其余启动顺序（rawBody、ValidationPipe、cookieParser、过滤器、MCP 非致命）未变 |
| 行为影响 | 无：允许/暴露头、来源与凭证条件逐项一致；提取后 `org-invite` 仍在内，ticket 03 的邀请头不丢 |

### 12 用例真实 HTTP 夹具

`tests/merchant-sso-http.test.ts` 起真实 Nest HTTP 服务，使用真实 `AuthController`、`ValidationPipe`、`AuthService`、`SsoService`、`AuthMiddleware`、`HttpExceptionFilter` 和上表的 CORS 策略；仅持久化用内存替身，SSO 提供方为一次性 code socket。覆盖：账户首建/复用、无效 code、跨源头可读性与请求头放行、标签页组织选择与两标签独立、外来/缺失 `showorg` 回退首个可用成员、旧 Cookie 兼容、头优先于陈旧 Cookie、401 + `logout` + 过期 Cookie、普通退出、上传归属、`change-org` 响应头接力、管理员代入解析。

### 已验证矩阵

| 流程 | 实测结果 |
| --- | --- |
| 首次兑换 / 再次兑换 | 首次 `200` 且返回 `auth` + `showorg`；同一商户第二次兑换得到同一 user id 与同一 org id；DB `User providerId=…` 计数 1、`UserOrganization userId=…` 计数 1；另一商户建立独立账户 |
| 无效 code | `400` + `Invalid or expired SSO token`，响应无 `auth`/`showorg` |
| 响应头 → sessionStorage → 后续请求 | 合成父页面向 `localhost:4302/sso` 的 iframe 投递 `SSO_TOKEN`；子页把 `auth`/`showorg` 只写入 `sessionStorage`（无 `document.cookie`、无 localStorage auth 键）；`/user/self` 携带本标签页的 `auth`/`showorg`，且无 `Cookie` 请求头 |
| CORS 可读性 | 预检放行 `auth`、`showorg`、`impersonate` 请求头；响应暴露 `auth,showorg,impersonate,logout` |
| Cookie 兼容回退 | 仅带 `Cookie: auth=…; showorg=…` 的请求仍按该组织解析（`cookieSession`）；同时带标签页头与陈旧共享 Cookie 时头胜出 |
| 两标签组织独立 | 两标签共用同一商户账户；标签 1 留在组织 A，标签 2 经真实 `/user/change-org` 切换；双标签刷新后各自 `/user/self` 携带自己的 `showorg` 并返回自己的 `orgId` |
| 上传归属 | 两标签各自真实 multipart `POST /media/upload-simple`，`Media` 表记录分别落在本标签组织 |
| 401 / 普通退出 | 401 → `401` + `logout: true` + 过期 `auth` Cookie，浏览器转到 `/auth/login` 并清空三个会话键；从 `/settings` 普通退出同样到 `/auth/login` 且键已清 |
| 代入开始 / 结束 | 开始返回 `impersonate: uo-…`，下一次 `/user/self` 报告目标用户、目标组织、`admin: true`、`impersonate: true`；结束返回空 `impersonate` 头（浏览器忽略空头，陈旧值保留，属定制基线缺口，记录未修）；开始/结束均调用 `window.location.reload()`（`apps/frontend/src/components/layout/impersonate.tsx`）；头的写入、下一次请求携带与空头被忽略后的残留由 `tests/session-lifecycle.test.tsx` 断言 |

### 命令与计数

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0（frontend `next typegen` + tsc、backend、orchestrator） |
| `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **61 文件 / 614 用例全部通过**（合入前 60 文件 / 602 用例；本票新增 `tests/merchant-sso-http.test.ts` 12 例） |

冷缓存首次全量运行时 `tests/media-api-upload.test.ts` 的 `beforeAll` 在 20s 钩子超时（该文件 5 例被计为 skipped），单文件重跑与暖缓存全量重跑均通过；属导入耗时导致的环境抖动，不是代码失败。未删除或弱化任何既有用例。

### 未验证

- 未在 Chromium 中真正切换“阻止第三方 Cookie”开关；现有证据是商户路径既不写也不发 `auth` Cookie，身份只在每标签 `sessionStorage`，且父页（`127.0.0.1`）嵌入子页（`localhost`）本身即跨站。
- 父应用是本地合成页面；Safari 与真实商户父应用未执行。
- 未使用真实平台 OAuth、邮件、Temporal 工作流与媒体 CDN。
- 代入下拉菜单的真实点击未在浏览器中驱动；服务端开始/结束由 live probe 与 HTTP 套件覆盖，客户端的头存储/残留与 `impersonate.tsx` 的 reload 调用由源码与 `tests/session-lifecycle.test.tsx` 覆盖，未在真实页面上走完点击 → reload → 新身份。

本票未推送、未部署，未改动 `.env`、其它 worktree 与 wayfinder 目录。
