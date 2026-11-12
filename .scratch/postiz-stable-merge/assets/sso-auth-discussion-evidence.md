# SSO 兼容讨论事实补充

日期：2026-11-11。只读静态复核，不是运行验收或业务决议；业务答复仅记录在 [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)。

## 当前源码核对

- `apps/backend/src/services/auth/auth.service.ts:320`：以 GENERIC + merchantId 查找用户；已存在则复用并取 orgs[0]，不存在则创建用户和组织。没有父页独立开户步骤。
- `apps/backend/src/services/auth/sso.service.ts:10`：直接向完整 SSO_SERVER_URL POST `{auth_code}`，不追加路径；响应 merchant_id/name 只做 truthy 校验。
- `apps/frontend/src/app/(app)/sso/page.tsx:15`：URL auth_code 优先；无 URL code 时才监听 SSO_TOKEN；失败没有清理旧会话。旧 `/auth/sso?token` 页面只是入口转接。
- `libraries/helpers/src/utils/custom.fetch.func.ts:21` 与 `apps/frontend/src/components/layout/layout.context.tsx:44`：请求读取 sessionStorage，响应只以非空 auth/showorg/impersonate 覆盖。重入 SSO 不清旧值；新响应缺少 showorg 或 impersonate 时，旧值可残留。
- `apps/frontend/src/components/layout/impersonate.tsx:447` 与 `apps/backend/src/api/routes/users.controller.ts:113`：停止代入的非 secured 分支只清 cookie；secured 分支提交 id=''，后端回空 impersonate header；前端非空写入规则不清 sessionStorage。`auth.middleware.ts:50` 还优先读取旧 impersonate cookie。这是静态组合缺口，未实测；本轮没有授权修复它。
- `libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts:167` 查询不排序、不排除 disabled 会员；`auth.middleware.ts:79` 随后过滤 disabled，并可能回退到另一个可用组织。因此首组织禁用不一定失败；可能出现响应 showorg 与实际 user/self.orgId 不一致。无可用组织才进入失败路径。
- 普通退出清当前标签页三个 storage 项；未发现通用跨标签页同步协议。渠道 popup 有专用 hash relay。直接打开、复制标签页、opener 继承和 iframe 存储分区的具体浏览器行为未实测，不能一概保证新标签页为空或继承身份。
- Uppy、主布局/Agent Copilot、预览 Copilot 的会话头覆盖不同，原始完整证据见 [身份鉴权证据](customization-auth-evidence.md) 与 [前端证据](customization-frontend-evidence.md)。

## 锁定稳定版的新增语义

稳定版固定为 a5affe62c74e39c1e7ac960d50d8418b807d532c；以下路径行号来自隔离诊断副本中固定版本的 git show，非未解决 merge 工作树。

- `apps/backend/src/api/routes/auth.controller.ts:220`、`:337` 与 `services/auth/auth.service.ts:305`：标准 OAuth 登录新增 oauth_state cookie 的往返及匹配校验。保留登录能力需要按真实 origin 验证这条路径，不能把 SSO 不依赖第三方 cookie 推广到它。
- `libraries/nestjs-libraries/src/database/prisma/users/users.repository.ts:166`：用户查询排除软删除记录；删除清洗 email/providerId 并写 deletedAt。现有 SSO 对未命中的身份自动开户，组合后再登录会创建新账户/组织，不是恢复旧数据。
- 同目录 `users.service.ts:88`：删除账户会删除仅由该用户拥有 SUPERADMIN 权限的组织及渠道，其它组织移除成员；`apps/backend/src/api/routes/users.controller.ts:346` 还取消相关组织订阅。
- `apps/backend/src/api/routes/users.controller.ts:171` 与 `libraries/nestjs-libraries/src/database/prisma/users/users.repository.ts:21`：新增管理员凭据交换会交换 email/password/providerName/providerId 等，组织与历史数据保留在原 userId；因此 merchantId 的登录落点可能改变。
- `apps/backend/src/services/auth/auth.middleware.ts:40`：JWT 验签后重新查数据库的 userId、activated；无需为容纳现有 SSO JWT 而直接退回旧 middleware。新查询排除 deletedAt。
- 同文件 `:95`：组织回退优先有 subscription 的组织。它与本地 SSO 显式发 orgs[0] 的组合需要按现有行为约束验收，不得因文本自动合并而宣称等价。

## 证据界限

没有访问 secret、数据库或真实兑换服务，没有执行产品合并、构建、部署或迁移。实际旧 GENERIC 用户、商户组织分布、父页调用时序、真实 origin 和 code 有效期/一次性行为仍需后续证据票取得；本补充不代答这些事实。
