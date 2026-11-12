# 找回密码令牌修复与 Code Review

日期：2026-11-13。基线：`8055cc2ce7232d2e6ab2c266c8edb5a132f24352` 加已有 sessionStorage/OAuth 未提交改动。实现范围为本目录 `spec.md`。

## 修复

- 新找回密码链接使用从 `JWT_SECRET` 派生的独立 HMAC 密钥，固定 HS256、issuer、audience、purpose，标准 `exp` 有效期 20 分钟。
- 登录验证只接受原有完整 User 形式的登录凭证，拒绝含找回密码、邀请或其他用途标记的凭证。新旧重置令牌无论过期与否，都不能通过 `auth` 请求头或旧 Cookie 兼容入口登录。
- 重置接口严格校验用途和有效期。无效、过期、其他用途凭证返回 `{reset:false}`，不调用密码更新。部署前已发出的旧链接在原有效期内继续可用。
- 管理员原身份查询和 middleware 使用同一个会话验证入口。用户是否激活、管理员权限和组织成员资格继续从数据库读取。

## 兼容范围

继续使用 sessionStorage → `auth`/`showorg`/`impersonate` 请求头，以及响应头写回机制。本次没有改动前端、父应用接口、SSO 兑换、postMessage、channel relay、退出登录、组织选择规则、渠道凭证或 UI。

`f042c177` 和 `6fdf7cb5` 都签发去除 password 的 User 对象。本次保留这一登录凭证格式、签名密钥和既有会话，加入旧格式的验证边界。四个已有测试文件中的 `{id}` 人造会话改为历史实际使用的 User 形式，原行为断言保留。

参考 [上游 PR #2382](https://github.com/gitroomhq/postiz-app/pull/2382)（`37a4c129012d2baa62dd74d0ff55462d67508d40`）的密钥用途隔离方案。没有引入该 PR 的新数据库表、强制旧登录失效、会话撤销或激活流程重构。仍保留重置链接在有效期内可重复使用的旧行为，本次不宣称加入了一次性重置链接或密码修改后的会话撤销。

## Standards 独立审查

0 项硬性规范问题，0 项需要处理的结构问题。凭证校验保留在共享认证 helper，业务调用遵循现有 Service → Repository。未发现新增正确性或安全缺陷。

## Spec 独立审查

0 项问题。审查者独立验证了重置令牌隔离、旧会话兼容、SSO/OAuth、组织选择和代入身份要求，并独立运行 3 个文件共 64 项测试通过。四个产品源码文件与 k8s 生成副本一致。

## 验证记录

- 修复前的新增回归：34 项中 20 项失败，复现重置令牌认证绕过及相关有效期/用途缺陷，日志 `/private/tmp/postiz-reset-before.log`。
- 修复后的专项回归：3 文件、64 项通过，其中新增重置令牌测试 42 项，日志 `/private/tmp/postiz-reset-targeted.log`。
- `pnpm run typecheck`：frontend、backend、orchestrator 全部通过，日志 `/private/tmp/postiz-reset-typecheck.log`。
- `pnpm run lint`：0 错误、709 项原有警告，日志 `/private/tmp/postiz-reset-lint.log`。
- 首轮完整测试：539 通过、3 失败；preview-auth 首项及 startup-sync 用例超时，preview-auth 后续用例出现重复 DOM。类型检查/lint 结束后执行 `pnpm test --maxWorkers=2`：**57 个文件、542 项全部通过**，未修改测试超时或断言；日志 `/private/tmp/postiz-reset-all-tests-verified.log`。
- k8s 生成和 `--check` 一致性检查通过；`git diff --check` 通过。

测试使用真实 JWT helper、AuthService、AuthController 和 middleware，数据库、邮件与第三方身份服务为隔离替身；没有访问生产账号，也没有完成真实父应用/Safari/OAuth 提供商联调。改动未提交、推送或部署。
