# sessionStorage 改动 Code Review 与上游核查

> 后续状态（同日）：用户已授权并完成问题 2 的本地修复，见 [重置令牌修复及审查](../../password-reset-token-fix/review.md)。本文下方“仍未修复”和复现表记录的是修复前状态，不代表当前工作区。上游已有未合并的 [PR #2382](https://github.com/gitroomhq/postiz-app/pull/2382)，本地修复参考其用途隔离方案并保留旧会话兼容性。

核查日期：2026-11-13（Asia/Shanghai）。审查范围为 `8055cc2ce7232d2e6ab2c266c8edb5a132f24352` 之上的未提交改动，以及新增测试。按 code-review 技能分别进行 Standards 和 Spec 独立审查；k8s 生成副本不重复计为独立实现。

## Standards

未发现新的硬性规范违反或值得处理的代码结构问题。请求沿用 useFetch，后端沿用 Controller → Service → Repository；没有新增过时颜色变量、组件依赖或 hook 规则屏蔽。

## Spec

发现并修复 1 项 P2：当 `IS_GENERAL` 为空而 `POSTIZ_GENERIC_OAUTH` 非空时，界面提供 GitHub 登录，新增 proxy 却将 `/settings` 登录回调转给 GENERIC，导致 sessionStorage 中的 GitHub state 凭证未被发往正确 provider。此配置不是示例默认值，但属于原有非 General 分支。

修复：`apps/frontend/src/proxy.ts` 的判断与界面保持一致，只有 `IS_GENERAL && POSTIZ_GENERIC_OAUTH` 才选 GENERIC。新增两个环境组合用例。独立审查者用实际 NextRequest/proxy 的失败复现重测，1 项测试通过；当前没有未解决的本次新增 Spec finding。

## 之前两个问题的状态

1. **普通 OAuth 登录转接与 Cookie state 依赖：本地实现已修复。** Google 的 `/integrations/social/youtube` 登录回调转入 `/auth?provider=GOOGLE`；GitHub/GENERIC 的 `/settings` 登录回调按界面配置选择 provider。渠道绑定回调继续走原渠道流程。浏览器临时 state 凭证放在 sessionStorage，以专用请求头往返；CORS 已暴露/放行相应头，不再依赖跨 origin Cookie 或 `credentials: include`。这表示代码及本地隔离回归通过，不代表已完成真实平台授权、父应用和 Safari 联调。
2. **过期找回密码令牌作为登录凭证：仍未修复。** 本次再次执行实际 `forgot()`、JWT 签验和认证 middleware，数据库与邮件使用合成替身，2020 年签发的重置令牌在当前工作区仍被接受。

## 上游最新状态与来源

通过 GitHub 官方 API 直接锁定：

- 最新稳定发布版：[v2.25.3](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3)，发布日期 2026-10-24，提交 `a5affe62c74e39c1e7ac960d50d8418b807d532c`。
- 当前 main：[4823080b413b9d3dc625d466939eb43b9657c66c](https://github.com/gitroomhq/postiz-app/commit/4823080b413b9d3dc625d466939eb43b9657c66c)，提交日期 2026-11-12，说明 `feat: connect tool`。
- 行为改变来源：[23696d2973510ae1f3f48bfa41a6bfbbf9827b05](https://github.com/gitroomhq/postiz-app/commit/23696d2973510ae1f3f48bfa41a6bfbbf9827b05)，2026-05-22，`feat: security fixes`。它将 token 中的用户字段改为按 `payload.id` 从数据库重读，再检查数据库的 activated；重置 token 同样含 id，因此也能匹配激活用户。
- 后来的 [a5affe62 / fix: jwt bypass](https://github.com/gitroomhq/postiz-app/commit/a5affe62c74e39c1e7ac960d50d8418b807d532c) 在此 middleware 中只追加 id 必须为 string 的检查，没有解决 token 用途混用。

分别下载锁定 main 和发布版的实际服务、JWT helper、中间件，在本机编译执行，仅替换数据库/邮件/时钟。结果：

| 版本 | 过期重置 token 用于普通认证 | 新鲜重置 token 用于普通认证 | 正常会话 token |
| --- | --- | --- | --- |
| 升级前 fork `6fdf7cb5` | 403 拒绝 | 403 拒绝 | 通过 |
| 当前工作区 | 错误放行 | 错误放行 | 通过 |
| 上游 v2.25.3 | 错误放行 | 错误放行 | 通过 |
| 上游 main `4823080b` | 错误放行 | 错误放行 | 通过 |

上游当前 [forgot()](https://github.com/gitroomhq/postiz-app/blob/4823080b413b9d3dc625d466939eb43b9657c66c/apps/backend/src/services/auth/auth.service.ts#L247) 仍签发 `{id, expires}`；该自定义 expires 只由找回密码接口解释。普通认证 [AuthMiddleware](https://github.com/gitroomhq/postiz-app/blob/4823080b413b9d3dc625d466939eb43b9657c66c/apps/backend/src/services/auth/auth.middleware.ts#L43) 不区分用途，也不验证此 expires。因而上游最新版尚无可直接沿用的修复。

修复方向（本次未实施）：分离会话/密码重置 token 的用途；认证 middleware 拒绝重置 token，包括存量旧重置 token；重置 token 使用标准 JWT exp。保留数据库重读权限状态，并设计旧正常会话 token 的兼容处理，不能简单回退上游权限修复或强制使所有旧登录失效。

## 验证和证据

- `pnpm test`：56 个文件、500 项通过；日志 `/tmp/postiz-post-review-all-tests.log`。
- 修复后的重点回归：3 个文件、29 项通过；日志 `/tmp/postiz-post-review-targeted.log`。
- 前端类型检查、修改文件 lint、`git diff --check` 通过。后端和 orchestrator 自上一次全量类型检查后未发生新增产品修改。
- 上游 API 元数据及复现输出保存在本目录的 `upstream-auth-metadata.json` 和 `upstream-reset-token-results.json`。
- 复现程序：`/private/tmp/postiz-upstream-auth-review/reproduce.cjs`；下载的两组原始公开源码在同目录 `main/`、`release/`。程序未调用真实用户、邮件或外部平台接口。
- 根源码重新生成 k8s 副本后执行一致性检查。所有产品修改仍为本地未提交状态，未推送或部署。

审查计数：Standards 0 项；Spec 1 项 P2，已修复并独立复验。独立于本次新增改动的重置令牌 P1 仍然存在。
