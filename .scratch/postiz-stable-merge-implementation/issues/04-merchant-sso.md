# 04: 商户通过既有 SSO 入口进入共享账户

**What to build:** 商户从父应用现有 URL 或消息入口进入 Postiz，无需二次登录；首次进入建立商户共享账户与组织，已有商户复用原身份和组织关系。

**Blocked by:** 03 — [用官方启动同步保留旧数据](03-startup-sync-data-retention.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“Postiz 登录、商户共享账户与会话”；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 通过真实页面和公开 API 验证既有 auth/sso token 转接、sso auth_code 和 SSO_TOKEN 消息三个入口；URL code 优先、监听时机及来源配置与已定契约一致，不要求修改父应用。
- [x] SSO_SERVER_URL 作为完整兑换端点接收 POST auth_code，merchant_id/merchant_name 映射商户身份；不自动拼接路径，不新增独立开户接口、needsCreation 或父页成功/失败通知协议。
- [x] 以 GENERIC + merchantId 查找和复用商户共享账户；首次创建用户及组织，初始组织角色为 SUPERADMIN，与全局管理员概念明确区分。
- [x] 已有商户及同一商户的不同使用者复用原用户、组织和内容；保留既有 orgs[0] 选择、成员检查与回退，已有用户缺组织时不自动补建，不采用上游订阅优先重排归属。
- [x] 正确保存非空 auth/showorg/impersonate 响应头并完成客户端进入，保持 cookie 兼容与既定优先级；iframe 不因恢复 cookie 页面门禁被拦截，SSO 页面与成功后的 light cookie 保留。
- [x] 使用可控兑换替身验证有效、无效、缺失、一次性 code 和兑换失败；同标签页 A→B 以及 B 失败按基线比较账户与组织归属，不在开始或失败时新增旧会话清空。
- [x] 从模拟父页到真实页面、API 和隔离数据库观察完整结果，不 mock 掉内部认证链；记录真实父应用联调和真实浏览器环境尚未验证的边界。

## Answer

2026-11-11 于 `codex/ticket-04-merchant-sso`（基于 `codex/postiz-stable-merge` `42487d4c`；合并时集成分支无新提交，无冲突）完成。02 合入后的 SSO 主体行为已符合决议，本票在 HTTP/浏览器边界补齐验证，并修复一处 Next 16 运行时缺口：旧 `/auth/sso?token` 转接读取 `searchParams.token` 时未 await，运行时 `token` 恒为 `undefined`，父应用入口总会落到无 code 的 `/sso`。**除该修复外未改产品行为**：组织选择、会话存储、失败呈现和普通登录均按现状由测试固定，未新增 needsCreation、清空旧会话、跨标签同步或订阅优先排序。

### 变更与位置

| 路径 | 变更 |
| --- | --- |
| `apps/frontend/src/app/(app)/auth/sso/page.tsx` | `searchParams` 改为 `Promise` 并 `await`；token 编码后转到 `/sso?auth_code=`，缺失/重复参数仍转到 `/sso`。 |
| `k8s/apps/frontend/src/app/(app)/auth/sso/page.tsx` | 上述文件的生成副本，由 `prepare-build-context.sh` 刷新，未手改。 |
| `tests/merchant-sso-entry.test.tsx`（9） | 真实 `/auth/sso` 页面函数（Next 16 Promise 形态）与真实 `/sso` 页面：token 转接与编码、缺失/重复 token、URL code 优先于 `SSO_TOKEN` 消息、空 URL code 回退消息、错误 type/缺 code/空 code/非对象载荷与未配置来源均忽略。 |
| `tests/merchant-sso-routes.test.ts`（11） | 真实 `AuthController.ssoLogin` + `ValidationPipe` + `AuthService` + `SsoService`；只替换 SSO 提供方和持久层。覆盖首次开户（1 用户/1 组织、`GENERIC`+merchantId、`showorg`）、已有商户复用、多使用者同商户共享账户、无组织不补建、缺失/空 code 的 400、无效/兑换失败/回复不完整均 400 且无 `auth`/`showorg`、响应体无 `needsCreation`；`node:http` 真实 socket 验证完整端点只 POST `{auth_code}`、一次性 code 首次 200 再次 400。 |
| `tests/merchant-account-org.test.ts`（14） | 真实 `OrganizationRepository.createOrgAndUser` 捕获 Prisma 写入：单组织、成员角色 `SUPERADMIN`、`GENERIC` 绑定、`activated`、`isSuperAdmin` 未设置；真实 `AuthService.ssoLogin` 取 `orgs[0]`、首组织 disabled 时选择不变、缺组织不建；真实 `AuthMiddleware` 验证 SSO/手动 `showorg` 优先、disabled/非成员回退首个可用组织、无可用组织与本票不相关账户 403、`auth` header 优先于 cookie、仅有 cookie 时可用；真实 `UsersController.changeOrg` 写 `showorg`。 |
| `tests/merchant-sso-session.test.tsx`（8） | 真实 `LayoutContext` + `customFetch`，只替换浏览器 fetch：非空 `auth`/`showorg`/`impersonate` 响应头写入、空/缺失头不覆盖、每个请求携带三项、手动切组织改变下一请求、仅 sessionStorage 且无 `storage` 监听、SSO 失败保留旧会话、成功前不清空、A→B 覆盖账户与组织、`impersonate` 残留按基线记录。SSO 页面只请求 `/auth/sso`（无客户端 `/user/self` 门禁）。 |
| `tests/auth-standard-routes.test.ts`（8） | 真实 controller/pipe/AuthService：邮箱密码登录（`auth`+`reload`）、错误密码 400 无会话、注册（`auth`+`onboarding`）、激活（`auth`+`onboarding`）、标准 OAuth `oauth_state` cookie 写入并由回调从 cookie 读回、缺失 state 传 `undefined`、非 JSON 回调 400 且不兑换。 |
| `tests/sso-cookie-gate.test.ts`（8） | 真实 `proxy.ts`：无 auth cookie 时 `/sso`、`/auth/sso`、登录/注册/激活及普通页面均直通不跳登录；仅有无关 cookie 也直通；`/auth/logout` 仍重定向。 |

### 变异检查（证明测试有效）

逐个注入后运行相关测试，均失败，随后原样恢复：

1. `ssoLogin` 的 `orgs[0]` 改为末个组织 → 4 例失败（既有服务测试与新增路由/组织测试）。
2. `layout.context.tsx` 去掉 `if (headerAuth)` 判空、无条件写入 → 空头不覆盖与 SSO 失败保留旧会话 2 例失败。
3. 修复前同步读取 `searchParams`（原始代码）→ `/auth/sso` 转接用例失败，确认 Next 16 Promise 形态是真实回归。

### 命令与结果

工具链 Node 22.23.4 / pnpm 10.6.1；`pnpm install --frozen-lockfile` 成功。

- `pnpm run test` 基线：16 files / 189 tests；首次并行运行出现 `tests/preview-auth.test.tsx` 3 例 5s 超时，单独运行与随后完整运行均通过，属既有并行负载抖动，与本票无关。
- `pnpm run typecheck` → exit 0（frontend/backend/orchestrator）。
- `pnpm run lint` → 0 errors / 713 warnings（基线 0 errors）。
- `pnpm run test` → 22 files / 247 tests passed（新增 58 例）。
- `pnpm run build` → exit 0（frontend、backend、orchestrator）。
- `./k8s/prepare-build-context.sh --allow-dirty` → 966 generated files；`--check` → in sync with `ec5f291f`。

提交：`20c32e7a`（Next 16 `searchParams` 修复，含生成副本）、`ec5f291f`（本票测试）。

### 未证明与边界

- 没有可用隔离 PostgreSQL：持久层以真实 Prisma repository / organization service 的替身捕获写入，未对数据库执行建档；schema 升级由 03 覆盖，但“真实建用户/建组织行”本轮未运行。
- 仅 jsdom 与本地 socket：未运行真实浏览器、真实 iframe/父应用 origin、真实 SSO 提供方、真实 cookie/CORS；父应用调用形式未改，但其部署入口仍由 06 收集。
- Next 16 修复由类型检查、生产构建和页面函数测试证明，未通过运行中的 Next 服务发起 `/auth/sso?token` 请求。
- 记录但不修复的基线：A→B 成功后既有 `impersonate` 保留；全部组织不可用时 403；属 05 范围。

