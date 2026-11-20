# 04: 保留新旧找回密码链接和既有登录

**What to build:** 用户可以用有效的历史链接或候选版新发出的邮件链接改密。已有有效登录可继续使用，密码重置与登录凭据维持各自的用途。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [重置令牌决策](../../postiz-v2.26.0-wayfinder/issues/02-reset-token.md#answer) · [既有专项回归记录](../../postiz-v2.26.0-wayfinder/../password-reset-token-fix/review.md)

- [x] 保留本地的重置专用签名和用途校验。用隔离邮箱走通新链接改密，并用升级前签发的有效历史格式样本走通同一流程，以实际密码登录结果验证。
- [x] 对新旧格式分别固定时间，覆盖到期前、到期瞬间和到期后。20 分钟有效期内可改密，到期或其他无效提交返回失败且原密码仍有效。
- [x] 用现有认证回归验证请求头和兼容 Cookie 两条路径。无论重置链接是否到期，普通会话及原管理员身份查询均拒绝历史格式和现行格式的重置凭据。
- [x] 用升级前的正常会话访问受保护页面，核对所获用户、组织和原有权限。记录候选修订的运行结果。

## Answer

2026-11-20，实现分支以 `--no-ff` 合入 `postiz-v2.26.0-integration`，无冲突。**无需产品修复**：合入后的重置/会话代码与 fork 修复提交 `c446dba40` 逐字节一致，候选版新增的 hunk 仅来自票 03 的 `showorg` 响应头及“请求头优先于 Cookie”顺序，均不触及重置令牌或会话校验；本次净变更仅为测试（+318/−9）。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-04-password-reset` |
| 实现提交 | `2650cd44e` |
| 合入前集成分支 | `f3438a782` |
| 合并提交 | `fe33ebbc69acaa97d881dbb086b8119bb0499dc8`，父提交 `f3438a782` 与 `2650cd44e` |
| 祖先校验 | `2650cd44e`、`f3438a782` 的 `merge-base --is-ancestor HEAD` 均为真 |
| 冲突 | 0 个未合并路径（`git ls-files -u` 为空）；无冲突标记；`git diff --check` 通过 |

### 新增的 21 个用例

- **新链接契约**：专用派生密钥（`postiz:user-auth:v1:password-reset`）、固定 `HS256`、`iss/aud/purpose/sub/exp` 齐全；通用 `JWT_SECRET` 无法验证。
- **20 分钟边界矩阵**：新旧两种格式各自固定时钟覆盖 T+19:59 / T+20:00 / T+20:01；仅到期前成功改密，到期瞬间与到期后返回 `{reset:false}` 且不调用 `updatePassword`。
- **bcrypt 登录结果**：新链接与历史链接改密后旧密码被拒、新密码可登录；失败提交后原密码仍可登录。
- **会话隔离**：请求头与兼容 Cookie 两条路径上，新/过期新/历史 −60/0/+20 分钟/带完整用户声明的重置凭据，在中间件均 `403` 且不查用户，在 `getRequestUserId`/`POST /user/switch` 均 `400` 且不切换；原管理员身份查询拒绝重置凭据。
- **既有会话**：升级前完整 User 会话可解析数据库用户、组织与角色；OAuth 完成签发的会话可被 `verifySessionJWT` 验证，且重置令牌不能冒充会话。

用例文件合计 67 个（`tests/password-reset-token.test.ts` 63、`tests/oauth-session-roundtrip.test.ts` 4）。

### 合入后门禁

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 回归 | `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **62 文件 / 642 用例全通过**（合入前 62/621，+21） |
| 类型 | `pnpm typecheck` | 通过：frontend（先 `next typegen`）、backend、orchestrator，exit 0 |

### 未验证

- 未启动真实后端 HTTP 服务与 Postgres/Redis；验证停留在真实模块接缝（`AuthService`、`AuthController`、`AuthMiddleware`、`UsersController`、真实 jsonwebtoken/crypto/bcrypt）与 DB/邮件/Provider 替身。
- 无真实外发邮件，未证明实际投递与邮箱可达性；重置邮件仍使用与既有回归相同的替身。
- 未推送、未部署；未改动实现工作树与 `.scratch/postiz-v2.26.0-wayfinder/`。
