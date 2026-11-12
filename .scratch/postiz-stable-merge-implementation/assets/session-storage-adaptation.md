# 新版认证 Cookie 的 sessionStorage 适配

日期：2026-11-13。基于 `postiz-stable-merge` / `8055cc2ce7232d2e6ab2c266c8edb5a132f24352`，本记录对应其上的未提交本地修改。

## 范围

沿用 `f042c177`、`6fdf7cb5` 和旧交接文档第三节的认证存储方案：`auth`、`showorg`、`impersonate` 通过响应头进入当前标签页的 sessionStorage，再通过请求头发送。补齐合并版本新增的认证 Cookie 依赖；主题、语言、日历偏好、第三方统计以及原有后端兼容读取保持原样。本次没有将“认证不依赖 Cookie”扩展成全站删除 Cookie。

## 已修改的行为

- `/oauth/authorize` 在客户端根据 sessionStorage 呈现授权/拒绝按钮，不再通过服务端 `cookies.auth` 判断登录；匿名访问的登录和 self-hosted 入口保留。实际授权仍由后端认证。
- `/integrations/social/[provider]` 不再读取 auth Cookie。成功跳转、多步账号保存端点以及错误返回判断使用当前标签页的认证状态；匿名公开回调、returnURL 和 iframe 弹窗通知/关闭分支保留。
- 标准 OAuth 登录不再签发或依赖 `oauth_state` Cookie。初始响应返回随机 state 和单独的签名凭证；公共请求封装将凭证保存到 `oauth_state:<PROVIDER>`，仅向对应的 `/auth/oauth/:provider/exists` 发送 `oauth-state-token` 请求头，成功后从 sessionStorage 移除。
- 后端检查凭证签名、`purpose=oauth-state`、provider、state 和 JWT `exp`，有效期为 10 分钟。凭证不进入授权 URL。缺失、错配、过期或其他用途的凭证均在兑换 code 前拒绝；HTTP 开发模式同样检查。原有 native `redirect_uri` 分支保留。
- CORS 放行请求头 `oauth-state-token`，暴露响应头 `oauth-state`、`oauth-state-token`；状态响应禁止缓存。
- Google 的共享 YouTube 回调路径、GitHub/GENERIC 的 settings 回调路径，仅在 `login-` state 时转交客户端登录兑换；渠道绑定回调不走该分支。钱包回调携带初始响应返回的 state。登录回调失败/拒绝显示重新登录入口，React StrictMode 不重复兑换 code。

## 验证

- `pnpm test`：审查前 56 个文件、498 个测试通过；修复审查发现的配置分支并补充用例后，56 个文件、500 个测试全部通过。包含授权/拒绝、匿名 self-hosted、真实渠道页面回调、完整客户端封装→控制器→认证服务的模拟 OAuth 往返、状态异常、已有 SSO/组织/上传/多步绑定回归。数据库、邮件和外部平台使用隔离替身，不涉及真实账户授权。
- `pnpm run typecheck`：frontend、backend、orchestrator 全部通过。
- `pnpm run lint`：0 errors，709 warnings。
- `git diff --check`：通过。
- `bash k8s/prepare-build-context.sh --allow-dirty`：从根源码更新生成副本；随后执行 `--check` 核对一致性。构建清单将工作区标记为 dirty，不将这些未提交修改冒充原 HEAD 内容。
- 首次测试在沙箱中遇到本机监听端口 EPERM；允许本地隔离测试监听后，完整套件通过。

日志：`/tmp/postiz-session-adaptation-all-tests.log`、`/tmp/postiz-session-adaptation-typecheck.log`、`/tmp/postiz-session-adaptation-lint.log`、`/tmp/postiz-session-adaptation-context.log`。

## 证明边界与未解决项

- 未进行真实父应用、真实第三方平台 OAuth 或 Safari 联调；未重新构建镜像、推送、提交或部署。
- 原有认证 Cookie 的后端兼容读取、主题/语言/统计 Cookie 仍存在；新版页面和上述标准 OAuth 登录流程不再以它们为前提。
- 前次审查发现的“找回密码令牌被普通认证中间件接受”是独立的令牌用途校验漏洞，本次没有修改相关中间件或重置令牌，仍待修复。不能据本次适配宣称整个稳定版合并已全面验收。

## Code review 后续核对

详见 [本次审查与上游核查记录](session-storage-code-review.md)。需求审查发现的非 General 模式下 GitHub 回调误判为 GENERIC 问题已修复，独立审查者复测通过。上游最新稳定版及锁定的 main 均仍可复现重置令牌被接受为登录凭证的问题。
