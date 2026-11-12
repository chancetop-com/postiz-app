# 05: 保留组织切换、会话及普通登录流程

**What to build:** 使用者在 iframe、独立窗口和不同标签页中继续使用既有 Postiz 登录、组织选择、退出与管理员代入流程，升级不会改变操作归属或统一重写各场景的会话行为。

**Blocked by:** 04 — [商户通过既有 SSO 入口进入共享账户](04-merchant-sso.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的身份、组织、会话及登录以外请求验证矩阵；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 从页面操作验证单组织、多组织、首组织禁用、全部不可用、已有用户缺组织和手动切换；与基线比较默认归属、成员有效性、回退及后续读写组织。
- [x] 覆盖刷新、新开/复制标签页、iframe 和普通窗口；保留各标签页的 sessionStorage 状态、非空响应头覆盖与 cookie 优先级，不新增全标签同步、有效期或身份命名空间策略。
- [x] 验证 auth/showorg/impersonate 与旧 cookie 共存及 SSO 切商户后的请求归属；真实请求、响应头和 CORS 与既定传输契约兼容，不只断言浏览器本地存储值。
- [x] 邮箱登录、注册、激活及标准 OAuth 登录能完成真实应用内部链路；标准 OAuth state 往返和失败校验保留，不通过移除校验解决兼容问题，外部 OAuth 与邮件使用替身。
- [x] 普通退出、401、专用退出路由、网络错误、开始和停止管理员代入分别按旧基线验证，不统一改写为全局清理或重定向。
- [x] 记录停止代入未清 sessionStorage、旧 cookie/组织残留及部分旁路请求头不齐等已知基线缺口及影响，不将其自动改成升级修复范围。
- [x] 覆盖上传、主布局/Agent/预览 Copilot 的身份传递与各自失败路径；保留客户端用户检查与 proxy 分工，以及加载等待、明确 null 跳登录、非 2xx 返回 null 的既有行为。
- [x] 在可控跨站环境覆盖第三方 cookie 受限场景，记录实际浏览器及配置；未运行的 Safari 或真实父应用结果不得以其它引擎或本地模拟替代。

## Answer

2026-11-11，在 `~/Desktop/Web/postiz-worktrees/05`（分支 `codex/ticket-05-session-org`，起点 64c9e370）完成。两笔提交：`c2fe9ceb`（默认组织归属修复 + 组织流程测试）、`5e4ed441`（会话、退出、代入、上传、Copilot 测试）。已 `git merge codex/postiz-stable-merge`（already up to date，无冲突）。

### 改动的产品行为（仅一处，规格直接授权）

`AuthMiddleware` 在无显式 `showorg` 时的默认组织，从上游 v2.25.3 的“优先有订阅的组织”改回基线的 `organization[0]`。依据 spec「保留既有查询、orgs[0] 选择……不因上游订阅组织优先等变化重排归属」。失败测试先行：`session-org-flow.test.ts` 的 `defaults to the first usable membership, not a later subscribed organisation` 先红（返回 org-subscribed），修改后绿。显式选择、禁用成员过滤与回退保持原样。

### 各场景结果

- **组织**：单/多组织、首组织禁用回退、全部禁用（中间件 403）、缺组织（403）、手动 `POST /user/change-org` 仅回 `showorg` 头并由客户端存储、请求按所选组织运行、所选组织缺 apiKey 时只为它补建。见 `tests/session-org-flow.test.ts`（8 用例）。
- **同标签 A→B**：成功切换替换 auth/showorg；刷新/复制标签页只依赖本标签 sessionStorage，不写 localStorage、不建 storage 监听。见 `tests/session-org-tab.test.tsx`（5 用例）。
- **弹窗**：`channel-relay` 仍从 URL hash 复制 auth/showorg/impersonate 到弹窗 sessionStorage 并跳转。见 `tests/session-popup.test.tsx`（3 用例）。
- **退出/401/网络错误/代入**：普通退出（确认后清三项并跳 `/auth/login`，取消不动）、401 与 `logout` 响应头清三项并跳转、网络错误不清理不跳转、开始代入存储并在下一请求发送、后端 401 清旧 cookie 且回 `logout: true`、`POST /user/logout` 只回头。见 `session-lifecycle.test.tsx`（7）与 `session-401-contract.test.ts`（2）。
- **上传**：local XHR 发送 auth/showorg、multipart 经统一 fetch 发送三项且非 2xx 转为错误。见 `session-upload-headers.test.ts`（4）。
- **Copilot**：主布局与 Agent 显式发送 auth/showorg（无 impersonate），预览不发显式头、靠 `credentials="include"`；主布局 identity 未落定前不渲染不跳转。见 `session-copilot-headers.test.tsx`（4）。
- **普通登录**：邮箱登录/注册/激活/标准 OAuth 状态往返沿用 ticket 04 的 `auth-standard-routes.test.ts`；本票补 state 不匹配/缺 cookie 拒绝、匹配时兑换、移动端 redirect_uri 例外。见 `session-oauth-state.test.ts`（4）。

### 固定的基线缺口（记录，未修复）

1. A→B 成功后响应无 impersonate 头，`sessionStorage.impersonate` 与下一次真实请求仍带 A 的旧值。
2. B 认证失败时整个 A 会话（auth/showorg/impersonate）原样保留并继续归属 A。
3. 停止代入发送空 impersonate 头，客户端只覆盖非空头，旧值留在 sessionStorage；secured 路径也不清旧 cookie。
4. local XHR 上传只带 auth/showorg，不带 impersonate；multipart 路径带三项，二者不统一。
5. 预览 Copilot 完全不发显式头（依赖 cookie），主布局/Agent 也不发 impersonate。

以上均与 spec「不新增 SSO 开始或失败时清空旧会话、不统一改写退出/401/代入、旁路请求头不齐仅记录」一致。

### 命令与结果

工具链 Node v22.23.4、pnpm 10.6.1、Prisma 6.5.0；`pnpm install --frozen-lockfile` 成功。

- `pnpm run test` 第 1 次：30 文件 / 284 用例全过（原 22 文件 / 247，新增 8 文件 / 37）。
- `pnpm run test` 第 2 次：30 文件 / 284 用例全过。未观察到 `preview-auth.test.tsx` 抖动。
- `pnpm run typecheck`：frontend/backend/orchestrator 全过。
- `pnpm run lint`：0 errors，713 warnings（基线约 700）。
- `pnpm run build`：frontend/backend/orchestrator 全部成功。
- `./k8s/prepare-build-context.sh --allow-dirty` 后 `--check`：in sync（967 生成文件，源提交 64c9e370 dirty）。仅生成副本 `k8s/apps/backend/src/services/auth/auth.middleware.ts` 随源更新，未手改 `k8s/apps/**`。

### 未验证（缺条件，不以模拟替代）

- 真实浏览器（Safari / 第三方 cookie 受限的 Chrome）与真实父应用 iframe 的跨站 cookie 行为未运行；仅验证 proxy 不设 cookie 页门禁、请求头契约与存储行为。
- 真实 SSO_SERVER_URL、父页 origin、OAuth provider 与邮件发送未连接；均在外部系统边界留替身。
- 真实网络 CORS 预检与 `Access-Control-Expose-Headers` 未做端到端抓包；仅核对 `main.ts` 的允许/暴露头列表与代码路径。
- iframe 与普通窗口的差异只在 proxy/入口层面核对，未在真实 iframe 中跑完整页面。

### 交接给后续票

- 07（渠道 OAuth）：`apps/frontend/src/app/(app)/channel-relay/page.tsx`、`apps/frontend/src/components/launches/add.provider.component.tsx`、`libraries/helpers/src/utils/custom.fetch.func.ts`。
- 10（媒体编辑/上传）：`libraries/react-shared-libraries/src/helpers/uppy.upload.ts`、`apps/frontend/src/components/media/new.uploader.tsx`、`apps/frontend/src/components/media/media.component.tsx`。
- 11（公开预览）：`apps/frontend/src/components/preview/preview.wrapper.tsx` 的 Copilot 无头行为。
