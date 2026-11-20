# v2.26.0 的密码重置与登录会话

**保留定制版 `83884307` 的重置令牌修复。** 两个官方标签的重置签发和消费语义相同，通用 JWT 函数、会话中间件和原管理员身份读取这三个文件也逐字相同。v2.26.0 仍缺少在登录时区分重置令牌的校验。比较基线为 v2.25.3 的 `a5affe62` 与 v2.26.0 的 `132859f3`，以下结论来自固定提交的源码静态核查。[v2.25.3 源码](https://github.com/gitroomhq/postiz-app/tree/a5affe62c74e39c1e7ac960d50d8418b807d532c) · [v2.26.0 源码](https://github.com/gitroomhq/postiz-app/tree/132859f32d854830ce44b509da87409c3ec10a77)

## 两个官方版本分别检查什么

| 环节 | v2.25.3 → v2.26.0 |
| --- | --- |
| 发出重置邮件 | 两版均查本地密码账户，使用通用签名密钥，写入用户 ID 和 20 分钟后的日期字符串。签发时没有重置专用密钥、用途声明或标准 JWT 到期时间。 [v2.25.3 签发](https://github.com/gitroomhq/postiz-app/blob/a5affe62c74e39c1e7ac960d50d8418b807d532c/apps/backend/src/services/auth/auth.service.ts#L220-L236) · [v2.26.0 签发](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts#L247-L263) · [公用签名和验签函数](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/helpers/src/auth/auth.service.ts#L42-L47) |
| 提交新密码 | 两版均先通用验签，如果 ID 不是字符串或所给日期早于当前时间则返回失败，否则更新密码。这里没有明确要求日期存在、可解析、严格晚于当前时间，也没有检查重置用途。 [v2.25.3 提交](https://github.com/gitroomhq/postiz-app/blob/a5affe62c74e39c1e7ac960d50d8418b807d532c/apps/backend/src/services/auth/auth.service.ts#L238-L248) · [v2.26.0 提交](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts#L265-L275) |
| 已登录用户访问 API | 两版都优先读 `auth` 请求头，回退到既有 cookie。通用验签后检查非空字符串 ID，再查数据库中的用户、激活状态和模拟身份所需的超级管理员权限。数据库授权值得保留，但它发生在读取 ID 之后，没检查提交的凭据是否属于登录会话，也没有检查旧重置令牌的自定义到期字段。 [v2.25.3 中间件](https://github.com/gitroomhq/postiz-app/blob/a5affe62c74e39c1e7ac960d50d8418b807d532c/apps/backend/src/services/auth/auth.middleware.ts#L34-L65) · [v2.26.0 中间件](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.middleware.ts#L34-L65) |
| 模拟用户时还原原管理员身份 | 切换账户前，控制器检查超级管理员权限和几个不能互换的 ID。两个标签的 `getRequestUserId` 都再次从请求中通用验签取 ID，验签失败则返回空。这里也需要与中间件复用严格的会话验证。 [v2.25.3 管理员查询](https://github.com/gitroomhq/postiz-app/blob/a5affe62c74e39c1e7ac960d50d8418b807d532c/apps/backend/src/api/routes/users.controller.ts#L176-L214) · [v2.26.0 管理员查询](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/api/routes/users.controller.ts#L176-L214) |

## 合并时保留的行为

- **新重置链接**沿用定制版派生的重置专用签名密钥，固定 HS256，验证签发者、受众、用途、用户主体和标准 `exp`。有效期为 20 分钟，到期即拒绝。重置提交失败返回 `reset: false`，在验证成功后才更新密码。[重置令牌实现](../../../libraries/helpers/src/auth/auth.service.ts#L73-L137) · [重置服务](../../../apps/backend/src/services/auth/auth.service.ts#L222-L245) · [返回契约](../../../apps/backend/src/api/routes/auth.controller.ts#L143-L149)
- **升级前已发出的旧链接**保留原截止时间，重置提交时以原密钥验签，只允许旧重置格式的字段，要求日期可解析、能按原格式往返、且严格晚于当前时间。登录与原管理员查询继续走 `verifySessionJWT`，始终拒绝新旧重置令牌。既有登录仍接受历史用户记录格式，并从数据库读取当前激活状态、组织及权限，无须集体重新登录。原有链接在有效期内可以重复重置，本地修复没有增加一次性消费或改密后的会话撤销。[旧链接与会话验证](../../../libraries/helpers/src/auth/auth.service.ts#L50-L138) · [会话中间件](../../../apps/backend/src/services/auth/auth.middleware.ts#L34-L56) · [原管理员查询](../../../apps/backend/src/api/routes/users.controller.ts#L163-L198) · [既有兼容约定](../../password-reset-token-fix/spec.md)
- **浏览器与宿主应用**沿用登录响应头和标签页的 `sessionStorage`。浏览器保存 `auth`、`showorg` 和 `impersonate`，后续请求带相应请求头，收到 `logout` 时清理。商户 SSO 继续签发既有用户会话并用响应头交给前端。整合上游邀请后，OAuth 登录成功及切换组织时沿用定制版响应头和原有 OAuth state 校验，避免因官方 cookie 写入或 `NOT_SECURED` 条件让嵌入页面丢失会话。[响应头接收](../../../apps/frontend/src/components/layout/layout.context.tsx#L44-L70) · [请求头发送](../../../libraries/helpers/src/utils/custom.fetch.func.ts#L20-L67) · [商户 SSO](../../../apps/backend/src/api/routes/auth.controller.ts#L295-L308) · [官方 OAuth 邀请响应](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/api/routes/auth.controller.ts#L361-L415)

## 本次发布新增的凭据用途

针对这两个标签的后端差异，未发现新增直接读取登录 JWT 来确定账户身份的入口。既有账户接受邀请的新 OAuth 分支先按组织邀请规则校验邀请，再按提供商身份查找账户，沿用原登录签发函数。公开的渠道 connect link 使用随机标识和 Redis 的一小时有效期。发布说明所称的令牌加密仅作用于数据库中渠道的 `token` 和 `refreshToken` 两列。这些改动可独立整合，均未提供账户重置的用途隔离。[邀请校验](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts#L135-L157) · [既有 OAuth 账户和会话签发](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts#L343-L376) · [渠道 connect link](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#L499-L514) · [渠道加密字段](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/services/encryption.service.ts#L13-L24)

## 历史修复提案与验收

上游 PR #2382 的目标分支是 `staging`，在 2026-11-06 关闭，GitHub 标记为未合并。该提案的固定提交 `37a4c129` 为会话、激活与重置各派生专用密钥，保留 20 分钟重置期限，同时要求增加数据库授权记录、使已有登录和旧链接全部失效。定制版已采用其中的重置密钥隔离。完整采用提案会违反既有会话与有效旧链接的兼容要求。[PR 状态](https://api.github.com/repos/gitroomhq/postiz-app/pulls/2382) · [固定提交的设计与迁移规则](https://github.com/gitroomhq/postiz-app/blob/37a4c129012d2baa62dd74d0ff55462d67508d40/docs/security/user-auth-tokens.md#L5-L22) · [本地修复规格](../../password-reset-token-fix/spec.md)

后续候选版应分别核对新旧链接到期边界、无效提交不改密、旧登录持续有效、普通与原管理员两处只接受会话、请求头与历史 cookie 回退一致，以及 SSO/OAuth 完成后的标签页内请求头往返。本轮为源码核查，已有测试记录属于升级前版本，候选版需取得自己的验证结果。[既有修复审查](../../password-reset-token-fix/review.md) · [重置回归范围](../../../tests/password-reset-token.test.ts) · [OAuth 会话往返](../../../tests/oauth-session-roundtrip.test.ts)
