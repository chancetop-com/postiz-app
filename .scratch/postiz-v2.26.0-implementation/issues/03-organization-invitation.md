# 03: 通过普通登录接受组织邀请

**What to build:** 受邀用户打开组织邀请链接，可用密码、标准 OAuth 或当前标签页已有的 Postiz 会话接受邀请；完成后以邀请指定的角色进入该组织。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [邀请和公开链接的验收决定](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [x] 从实际签发的邀请链接分别走密码登录、标准 OAuth 登录和仅有 sessionStorage 的已有会话。每种方式都从组织成员记录核对用户、受邀组织、角色及新增数量。
- [x] 首次加入时，服务端验证邀请，接受邀请的标签页收到 `showorg` 并在下一次请求使用受邀组织。另一个已打开的标签页仍访问原组织。
- [x] 重复接受同一邀请保持单条成员关系。无效或过期邀请保持原归属，未激活账户继续受激活流程约束。
- [x] 无邀请时跑通邮箱注册、激活、密码及标准 OAuth 登录，核对原默认组织和 OAuth 的 provider、state、时效校验。兼容上游可选注册归因。

## Answer

2026-11-20，实现分支以 `--no-ff` 合入 `postiz-v2.26.0-integration`，无冲突；类型检查与回归全通过。邀请改为**标签页作用域**（sessionStorage + 请求头），服务端签名、角色与时效校验未放宽。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-03-organization-invitation` |
| 实现提交 | `a4318b8a5` |
| 合入前集成分支 | `f620bb089` |
| 合并提交 | `b8f1545e34293acf4b843894a4e6a4d8399403d3`，父提交 `f620bb089` 与 `a4318b8a5` |
| 祖先校验 | `git merge-base --is-ancestor codex/ticket-03-organization-invitation HEAD` 为真 |
| 冲突 | 0 个未合并路径（`git ls-files -u` 为空）；无 `<<<<<<<`/`>>>>>>>` 标记；`git diff --check` 通过 |

### 设计：标签页作用域的签名邀请

| 环节 | 行为 |
| --- | --- |
| 邀请链接 | `/?org=<签名 JWT>` |
| Next 代理 | 不再调用 `/user/join-org`（服务端读不到本分支的 sessionStorage 会话），仅把签名 token 与其余查询参数转发到 `/auth/login?org=<token>`；不写 `org`/`showorg` cookie |
| 客户端存储 | 新增 `apps/frontend/src/components/auth/org.invite.ts`：token 存本标签页 `sessionStorage` 的 `org-invite`，与 `auth`/`showorg`/`impersonate` 同级；以 `org-invite` 请求头发送 |
| 密码登录 | `POST /auth/login` 携带该头，成功即清除 |
| 标准 OAuth | `POST /auth/oauth/:provider/exists` 携带该头；既有 `oauth-state-token` 证明与时效校验不变；既有用户交换成功即清除，新账户保留给注册表单 |
| 已有会话 | 标签页已有 `auth` 时在登录页直接 `POST /user/join-org`（带本标签页 `auth`/`showorg` 头） |
| 服务端校验 | `AuthController.getOrgInvite` 接受签名头或历史 httpOnly `org` cookie；`AuthService.getOrgFromCookie` 在使用 orgId 前校验签名、`orgId`、角色（`USER`/`ADMIN`）与 `timeLimit`；浏览器从不发送未签名 org id |
| 换组织信号 | `UsersController.joinOrg` 仅在 `addUserToOrg` 返回新成员关系时回 `showorg`；`LayoutContext` 把该响应头写入 sessionStorage，只有接受邀请的标签页切换；重复接受返回 `{id:null}` 且无 `showorg` |
| 中间件 | `AuthMiddleware` 优先取标签页 `showorg` 头，其次才是遗留共享 cookie，旧会话仍可用 |
| CORS | 后端允许头新增 `org-invite` |

这是本票有意的契约变更：代理侧 `?org` 入组（01 保留的流程）改为客户端转交，因为代理无法读取 sessionStorage；入组校验仍全部在服务端完成，未引入未签名 org id 通道。

### 验证矩阵

运行时证据为实现者在隔离栈记录（Postgres `postiz-ticket-03`、Redis DB /3、后端 `:3103`、前端 `:4303`，仅合成用户/组织）；OAuth 行来自受控控制器 + 真实 `AuthService` 边界测试（桩 provider），不是真实外部交换。

| 路径 | 结果 |
| --- | --- |
| 密码 + 有效邀请 | `200`，`auth` + `showorg=org-A`，成员关系恰好 1 条，角色 `ADMIN` |
| 密码 + 重复邀请 | `200`，`auth`，无 `showorg`，成员关系仍 1 条 |
| 密码 + 过期/无效邀请 | `200` 普通登录，无 `showorg`，成员关系不变 |
| 密码 + 无邀请 | `200`，无 `showorg`；默认组织选择不变 |
| 密码 + 未激活 + 邀请 | `400 "User is not activated"`，无 `auth`/`showorg`；成员关系已记录（1 条），随后激活端点成功 |
| 已有会话 + 有效邀请 | `POST /user/join-org` `200 {id:org-A}` + `showorg`，成员关系 1 条，角色 `USER` |
| 已有会话 + 重复邀请 | `200 {id:null}`，无 `showorg`，计数仍为 1 |
| 已有会话 + 过期/无效/未签名 org id | `200 {id:null}`，无 `showorg`，成员关系不变 |
| 接受标签页的下一请求 | `GET /user/self` 带 `showorg=org-A` → `orgId=org-A`，角色 `USER` |
| 另一已开标签页 | 同一 `auth` 带 `showorg=home` → `orgId=home`，角色 `SUPERADMIN`；未写 cookie/Set-Cookie |
| 邀请落地页 | 真实 Next 服务：`GET /?org=<token>` → `307 /auth/login?org=<token>`；`/auth/login?org=…` 渲染 `200` |
| 标准 OAuth + 有效邀请 | 状态证明通过后只新增 1 条成员关系并回 `showorg`（受控边界） |
| 标准 OAuth + 重复邀请 | 不新增，无 `showorg`（受控边界） |
| 标准 OAuth + 过期/无效邀请 | 不新增成员关系（受控边界） |
| 标准 OAuth 无/错证明 | 在 `getToken` 之前拒绝；真实后端无证明时 `400 Invalid state` |
| 标准 OAuth 端点 | `/auth/oauth/GITHUB` 返回 `oauth-state`、`oauth-state-token`、`Cache-Control: no-store` |

回归用例覆盖同一契约：`tests/session-org-invite.test.tsx`（接受标签页写 `showorg`、无 cookie、重复/过期/无效保持原组织、无会话不入组、密码登录带签名头）、`tests/session-org-flow.test.ts`（标签页头优先于遗留 cookie、邀请后 1 条成员关系/角色、重复接受无 `showorg`）、`tests/auth-standard-routes.test.ts`（密码与 OAuth 入组、角色、过期/无效、未激活、无邀请默认组织、历史 cookie、注册/激活）、`tests/oauth-register-session.test.tsx`（OAuth 带邀请、新账户保留/既有账户清除、state 拒绝）、`tests/sso-cookie-gate.test.ts`（代理只转发不自行入组，其他代理契约不变）。

### 合入后门禁

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | 通过：frontend（先 `next typegen`）、backend、orchestrator，exit 0 |
| 回归 | `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **58 文件 / 576 用例全通过**（合入前 57/545；+1 文件、+31 用例） |
| 冲突/格式 | `git ls-files -u`、`git grep -nE '^(<<<<<<<|>>>>>>>)( \|$)'`、`git diff --check` | 0、无匹配、exit 0 |

直接执行 `pnpm test` 出现 5 个与本票无关的失败：`optional-services-copilot` 的 CORS 断言受本地 `.env` 的 `NOT_SECURED=true` 影响，`media-api-upload`/`preview-*`/`session-copilot-headers` 在并行负载下 5–10 秒超时；清空该变量并串行重跑即全通过，未修改任何断言。

### 未验证

以下**均未在本票执行，不宣称通过**：

- 真实 GitHub / Google 外部 OAuth 交换（无 provider 凭据、未使用外网）；邀请入组仅由受控控制器 + 服务边界用例覆盖。
- 浏览器 UI 与真实第二浏览器标签页（桌面浏览器工具报 `[browser.disconnected]`，未附加）；标签页隔离由 jsdom 用例与双请求头 HTTP 检查覆盖。
- `next dev` 提示 Next.js 16.4.2 安全公告建议升级；不属于本票范围，未处理。

未推送、未部署、未发布；未改动实现工作树与 `.scratch/postiz-v2.26.0-wayfinder/`。
