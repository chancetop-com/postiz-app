# 定制清单证据：认证、用户接口与共享工具

日期：2026-11-11。性质：只读事实调查；未决定保留/替换方案，未解决合并冲突，未运行构建或业务回归。

## 比较口径与覆盖

- B：`0b554e684483932d394e703208fe21648e7acd6f`。
- 第一次定制：`f042c177c1a378edacd54790614bdd9f709a2480`；第二次定制暨 C：`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`。
- 锁定 stable S：`a5affe62c74e39c1e7ac960d50d8418b807d532c`。
- 当前 H：`501e87dbfb2ca6e44662baec308afa468a922b38`。本报告 17 个定制文件在 C/H 完全相同；以下 `C:行` 可直接映射当前工作区。
- 当前源码先用 CodeGraph 查读；历史行为用两次 `git show` 全量逐 hunk 审核，stable 用 B→S diff 和 S 的指定文件源码核对。
- 两个提交在本范围共修改 17 个根路径：第一次 14 个文件、31 个默认 `-U3` diff hunk；第二次新增 3 个文件、3 个 hunk。所有 hunk 均列入下表。`k8s/` 副本由部署调查负责。
- 主仓库最初缺少 S 的部分 promisor blobs；一次普通 `git diff` 曾触发自动懒取并因 DNS 失败。此后读取均关闭 lazy fetch。父调查在隔离副本 `/private/tmp/postiz-wayfinder-three-way-n90eeeum/repo` 补齐 S 后，本报告完成了完整的本范围 stable 源码比较；没有以缺失对象冒充无差异。
- 三方文本结果来自父调查在上述隔离副本执行的 H/S 诊断合并，base 为 B；这里只读取结果。`M:行` 表示该未解决诊断合并的文件行号，不是可部署产物。

## 每个文件与每个定制 hunk

`f042 -n` 是第一次提交 diff 的旧侧 hunk 起始行；第二次新增文件用 `6fdf +1`。目的栏中“文档”仅证明作者意图；实现仍以源码为准。

| 编号 / 路径 | 全部定制 hunk | C 的最终行为、证据与目的 | S 的重叠 / 替代判断 | 三方文本结果 |
| --- | --- | --- | --- | --- |
| A01 `apps/backend/src/api/api.module.ts` | f042 -43、-96 | C:46、100 导入并注册 `SsoService`，供 `AuthService` DI 使用；该服务也通过 providers getter 导出。目的：接入 SSO（文档）。 | S 新增 Apple、Payment、Admin、media/clipping widget，增加 `MCP_ONLY` 控制器列表；未提供此商户 SSO 服务。S:84 的 MCP_ONLY 分支没有 AuthController，若启用会没有 `/auth/sso`。 | **冲突**：C 的 SsoService import 与 S 移动到同处的 StripeController import；SsoService provider 增量本身已在结果中。 |
| A02 `apps/backend/src/api/routes/auth.controller.ts` | f042 -16、-69、-134、-231、-284 | SsoLoginDto import；移除 cookie helper import。register C:72/75、login C:109/112、activate C:178、oauthExists C:216 改为无条件 `auth` / 可选 `showorg` 响应头，移除原 auth/showorg cookie 写入及 NOT_SECURED 分支；保留 activation/onboarding/reload 分支。C:224 新增公开 `POST /auth/sso`，取 `auth_code`，签 JWT，返回 auth、可选 showorg、`{login:true}`；异常 400 + message。SSO 不设置 reload/onboarding。目的：iframe 的 sessionStorage 会话（文档）。 | S 保持原 cookie 登录传递，新增 oauth_state cookie、JSON content-type 校验、state 参数、Apple redirect 和 Farcaster signer 路由。无此商户 SSO 替代。S:227 写 cookie、:356 读 cookie 是新的语义依赖。 | **自动合并，但有确定源码缺陷**：M:172 调用 `getCookieUrlFromDomain`，整个 stage-0 文件没有该 import 或定义。未编译，不能称构建实测失败；静态未解析标识符已证实。 |
| A03 `apps/backend/src/api/routes/users.controller.ts` | f042 -120、-217（后者包含 change-org 与 logout） | C:123 impersonate 改为响应头；C:206 change-org 改为 showorg 响应头；C:212 logout 仅 logout 响应头+200，删除三种会话 cookie 清理。原 superadmin 检查仍在。目的：同一会话传递迁移（文档）。 | S 增加账户删除、凭据交换、时区、支付抽象和组织输出收窄；删除账户调用同一个 logout（S:366）。C 迁移会一并影响新删除流程的退出效果。S 未替代 header 迁移。 | 自动合并。 |
| A04 `apps/backend/src/api/routes/copilot.controller.ts` | f042 -43、-69 | `/chat` C:46 与 `/agent` C:72 在 OPENAI_API_KEY undefined/空字符串时返回 503 JSON `{error:'AI not configured'}`，替换无响应的 return。目的：可选 AI 缺配置时明确失败（推断）。不等于全部 AI 路由均被禁用。 | S 仍为裸 return；另加 copilotCors，agent 改 Node HTTP handler、forwardedProps 及 clipping credits。S 没有等价 503 替代。 | 自动合并，M:55/82 保留 503，M:60/106 保留 S 的 CORS，M:67/113 保留 Node handler。 |
| A05 `apps/backend/src/main.ts` | f042 -9、-36、-47 | C:12 注册全局 unhandledRejection 日志监听器；C:39–47 无条件 expose auth/showorg/impersonate/logout；C:57 不 await startMcp，catch 日志后主 API 继续启动。目的：header 可读为文档；MCP/异步失败不阻塞主 API 为推断。 | S 新增 x-postiz-* 请求头、CANVA_APP_ORIGIN、PostValidationExceptionFilter，并把 Express 路径改 `/copilot/{*splat}`；仍 await startMcp，未替代两项容错。 | 自动合并；M:12/69 保留 C，M:77 保留新路由语法。不能据此保证 MCP 已就绪。 |
| A06 `apps/backend/src/services/auth/auth.service.ts` | f042 -6、-19、-69、-87、-106、-256、-273、-302 | 导入/注入 SsoService；全部旧 `jwt()` 调用改 `signJwt()`，并由 private 改 public（C:313）。C:320–348 实现商户验证、按 GENERIC+merchantId 查用户、既有用户选 orgs[0]、不存在则创建用户+组织。详见下一节。目的：SSO 自动开户为源码事实，与部分文档相反。 | S 去掉 NotificationService 注入、改同步邮件接口、加强邀请 token 形状校验、增加 OAuth state 校验。仍叫 private jwt；没有商户 SSO 实现。 | **冲突**：M:75–84，C 的 `signJwt` 与 S 的 `sendEmailSync` 同 hunk。不是只能二选一的业务冲突；尚未解决。 |
| A07 `apps/backend/src/services/auth/sso.service.ts` | 6fdf +1（40 行） | C:10–38 读取完整 SSO_SERVER_URL，POST JSON `{auth_code:token}`；非 2xx 报 invalid/expired；JSON 中 merchant_id / merchant_name 只做 truthy 校验并映射。没有路径拼接、请求超时、重试、签名校验、本地重放记录。目的：商户认证兑换（文档）。 | B/S 同路径不存在；S 的 GENERIC OAuth 协议不等价。 | C 新增文件保留，无 add/add 冲突。 |
| A08 `libraries/nestjs-libraries/src/dtos/auth/sso.login.dto.ts` | 6fdf +1（7 行） | C:3–6 `auth_code` IsNotEmpty + IsString；用于 AuthController，受全局 ValidationPipe 控制。 | B/S 无此文件。 | C 新增文件保留。 |
| A09 `libraries/nestjs-libraries/src/dtos/auth/sso.create-account.dto.ts` | 6fdf +1（7 行） | C:3–6 仅 `token` IsNotEmpty + IsString。没有实际调用的 create-account API，也没有 optional company 字段。目的：历史设计残留（推断）；不能记为已实现注册接口。 | B/S 无此文件。 | C 新增文件保留，但保留文件不证明功能。 |
| A10 `libraries/helpers/src/utils/custom.fetch.func.ts` | f042 -10、-19、-60 | 移除 secured 第四参数；C:21–34 每次请求读 sessionStorage auth/showorg/impersonate；C:36 不再默认 credentials include；C:39–57 注入 header。显式 auth 优先于 sessionAuth，并覆盖 options.headers.auth / loggedAuth；options.headers.showorg 可覆盖前面组织选择。SSR 无 window 时只用显式值/传入 headers。目的：第三方 cookie 限制下的会话传递（文档）。 | **S=B**，无上游等价替代。删除默认 credentials 不等于所有请求禁止 cookie：调用者可传 include，fetch 默认仍有 same-origin 行为。与 S 新 OAuth state-cookie 契约产生行为重叠。 | 自动合并；跨文件语义风险见下节。 |
| A11 `libraries/helpers/src/utils/custom.fetch.tsx` | f042 -28 | C:30–34 FetchWrapperComponent 不再读取 isSecured，也不传第四参数；useVariables import 仍残留。目的：统一 header 传递（文档/源码）。 | **S=B**。 | 自动合并。 |
| A12 `libraries/react-shared-libraries/src/helpers/uppy.upload.ts` | f042 -98 | C:101–109 仅 local XHRUpload 增加动态 auth/showorg headers；保留 withCredentials:true；**未加入 impersonate**。cloudflare 辅助请求继续使用传入 fetch。目的：补齐绕过统一 fetch 的上传鉴权（推断/交接文档）。 | S 增加 WaitForMediaProcessing 轮询、新 helper 非 2xx 检查；local 上传仍无 header 回调（S:204–210），没有替代本定制。 | 自动合并，M:210–218 保留 header，S 处理轮询/错误检查亦保留。 |
| A13 `libraries/react-shared-libraries/src/helpers/use.track.tsx` | f042 -30 | C:33 将 `window.fbq` 的存在性判断改 `(window as any).fbq`。运行时表达式相同；原 credentials include 保留 C:19。目的：TypeScript 类型兼容（推断）。 | **S=B**；不能当作停用 tracking 或去 cookie 行为。 | 自动合并。 |
| A14 `libraries/nestjs-libraries/src/database/prisma/autopost/autopost.service.ts` | f042 -171 | C:174 messages 默认函数加 `:any[]`，运行时仍返回 []。目的：类型兼容（推断）。 | S:179 仍无标注；另改工作流 USE_EXISTING/await/catch、图片模型、createPost 的 AUTOPOST 来源。类型修补不替代这些新行为。 | 自动合并。 |
| A15 `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts` | f042 -88 | C:91 count 查询 `deletedAt:null` 加 `as null`；运行时不变。目的：类型推断修补（推断）。 | S:138–140 在同处加 `status:{not:'processing'}`，并给列表同样过滤、增加处理状态 API/createdAt。本定制不是媒体处理逻辑替代。 | **冲突**：M:138–145，类型断言与 status 过滤同 hunk；不可为保留断言而丢弃上游过滤。未解决。 |
| A16 `libraries/nestjs-libraries/src/emails/empty.provider.ts` | f042 -2 | C:5 validateEnvKeys 加 `string[]` 类型，运行时仍 []；未新增 email provider。目的：类型兼容（推断）。 | **S=B**。 | 自动合并。 |
| A17 `libraries/nestjs-libraries/src/short-linking/providers/empty.ts` | f042 -3 | C:6 linksStatistics 返回值加 Promise<any[]> 类型，运行时仍 []；未新增短链能力。目的：类型兼容（推断）。 | **S=B**。 | 自动合并。 |

第一次提交已引用第二次才加入根目录的 SsoService / SsoLoginDto。不得把 `f042c177` 单独当作独立可构建版本验收；未在本次运行构建来证明任何提交可构建。

## 身份和会话的实际契约

1. **自动开户与组织关联。** `AuthService.ssoLogin` C:320 不经过 `canRegister`、`routeAuth` 或 OAuth ProviderManager。验证成功后，以 `(Provider.GENERIC, merchantId)` 查找用户；不存在时 company=merchantName，email=`merchantId@sso.merchant`，password=''，providerId=merchantId，ip='sso-auto'，agent='sso-client'。沿 AuthService → OrganizationService C:18 → OrganizationRepository C:260 创建，仍遵守 Service/Repository 分层。非 LOCAL 自动 activated，组织成员 role=SUPERADMIN，**不是**全局 `User.isSuperAdmin=true`（schema C:86 默认 false）。再次登录不会更新商户名称，也不会给已有用户创建缺失组织。
2. **选择第一个组织并不代表商户与组织一对一的持久映射。** OrganizationRepository.getOrgsByUserId C:167 的查询没有 orderBy；ssoLogin 不过滤 disabled 成员，直接 orgs[0]。实际业务请求的 AuthMiddleware 另行过滤 disabled、验证组织；无组织或全部不可用时，SSO 接口可以先返回 login:true 而后业务请求失败。此为静态路径推断，未实际构造数据库记录测试。
3. **GENERIC 命名空间共享。** 现有 OauthProvider C:6 已注册 GENERIC，标准 OAuth 的 userinfo 取 `sub` 作为 id（C:91）；SSO 直接把 merchantId 放进同一个 providerId。UsersRepository C:78 为 findFirst(providerId,providerName)。schema C:117 / S:122 唯一约束为 email+providerName，**没有** providerId+providerName 唯一约束。若两个外部身份源的 id 重合，查找可命中同一现有用户；是否实际有旧 GENERIC 用户未知。新用户并发登录是先读再建，没有 SSO 专用 upsert/retry；同 email 唯一约束可能令一个并发创建返回错误，未运行验证。
4. **服务端验证边界。** SsoUserInfo 的 TypeScript string 声明不验证外部响应 JSON 的实际类型；merchant_id/name 仅 truthy 检查。auth_code 的到期、一次性、签发者由远端兑换接口决定；本源码没有独立验证证据。完整 SSO_SERVER_URL 直接作为 fetch URL，不能依据旧文档追加 `/api/sso/verify`。没有读部署 secret，也没有调用真实认证服务。
5. **JWT 与 cookie 仍并存。** signJwt 只是把旧方法公开重命名；helper `libraries/helpers/src/auth/auth.service.ts` C:42 调用 sign(value,JWT_SECRET)，这次定制未增加 expiresIn。AuthMiddleware C:34 仍接受 header 或 cookie auth；C:40/50 的 showorg、impersonate 是 cookie 优先。UsersController C:73 也 cookie 优先。注册/登录仍读邀请 org cookie（AuthController C:51/97），tracking 仍设 cookie（UsersController C:238），Uppy 与 useTrack 仍显式携带 credentials。这不是彻底移除 cookie 的实现。
6. **本地上传身份缺口。** local Uppy 新 header 回调只传 auth/showorg，不传 impersonate。统一 fetch 会传 impersonate；上传保留 withCredentials，可能又读到旧 cookie。管理员模拟场景的上传和普通 API 是否进入同一用户/组织需要验收，不能从“上传已加 auth header”推出一致。

## 即使文本干净也不能略过的 stable 交互

| 编号 | 已观察证据 | 影响性质 / 下游处理问题 |
| --- | --- | --- |
| S01 | 自动合并 AuthController M:172 调用不存在的 getCookieUrlFromDomain；C 删除 import，S 新 oauth_state 写入重新依赖该函数。 | **确定静态缺陷**。文本无冲突不等于有效源码；后续修复需要恢复正确依赖，不能只检查 conflict markers。 |
| S02 | S AuthController:227/356 写读 oauth_state cookie；S AuthService:307–312 在 secured、无 redirect_uri 的 web flow 校验 state；A10 去掉默认 credentials include。 | **条件行为风险**：跨 origin API 请求若未携 cookie，state 无法匹配；iframe 第三方 cookie 限制也仍存在。same-origin 或显式 credentials 的情况不同，未做浏览器运行验证。需要确定仍支持哪些本地/标准 OAuth 入口及部署 origin，再设计兼容；没有授权把上游 state 校验删掉。 |
| S03 | S AuthMiddleware:43–50 验签后按 id 重新查 DB；S UsersRepository:104/166 排除 deletedAt 用户。C SSO 签的是确有数据库 id 的用户。 | 新验证路径静态可容纳 SSO token，不需要回退到旧 JWT 里携带的 isSuperAdmin/activated。禁用/删除即时生效是上游语义，不能把旧 middleware 当作 SSO 定制保留。还需实际回归。 |
| S04 | S UsersController:332–366 增加删账户；S UsersRepository:176–209 会清洗 email/providerId、设 deletedAt，getUserByProvider:166 只查未删除用户；C ssoLogin 未命中就创建。 | **组合行为推断**：同 merchant 再取得有效 code，可新建账户/组织；不是恢复原组织/历史数据。需要确认删除后的重新进入策略。新增管理员 switch 凭据还会交换 providerId（S users.repository:24–74），可改变商户映射到哪个 user/data。 |
| S05 | S AuthMiddleware:99–102 无显式组织时优先有 subscription 的组织；C SSO 明确发 orgs[0] showorg；S OrganizationRepository:249 排除软删除组织。 | C 默认选择会覆盖新“订阅组织优先”回退；且仍未过滤 disabled。需要确定 SSO 商户多组织时的目标规则。没有数据证明用户只有一个组织。 |
| S06 | S ApiModule:84–104 新增 MCP_ONLY 控制器模式；C startMcp 改为未等待，且捕获失败。 | MCP_ONLY 模式根本不注册登录控制器；如果实际部署采用该模式，API server 的 SSO 保留方案不能直接沿用。MCP non-fatal 策略与 readiness/监控是独立于 SSO 的运维选择。 |
| S07 | S CopilotController 新 runtime CORS 和 Node handler；C 503 正常保留。S Uppy 新轮询使用传入 fetch；C upload headers 正常保留。 | 均未发现等价上游替代；升级回归仍需验证 header 到达、CORS 响应可读、上传完成后的 status 轮询，不应只验首次上传。 |
| S08 | S schema 保持 GENERIC、email+providerName 唯一约束，并添加 APPLE、User.deletedAt/timezoneName。S OauthProvider 只新增 state 参数。 | S 没有独立 merchant provider 或 `/auth/sso` 兑换协议可直接替代 C；身份冲突风险未被上游 schema 自动修复。 |
| S09 | A13–A17 的 TypeScript 标注均无运行时新增功能；S 改了这些模块的邻近行为。 | 只能在锁定新依赖/编译器后判断标注是否仍需要；不能把“类型修补”列成独立业务保留需求，也不能因为修补小而整文件覆盖 S。 |

## 文档与实现不一致

- `docs/sso-migration-plan.md:596,718,1020,1050,1123`、交接 `handoff-project-customizations.md:55` 声称独立 `/auth/sso/create-account`；实际 AuthController C 只有 `/sso`，且自动创建。DTO 存在不等于路由存在。
- `docs/sso-migration-plan.md:656,823,1022,1053,1147` 写“未找到用户则 needsCreation / needsAccountCreation、父应用建号”；实际 C:332 直接创建并返回 login:true。
- `docs/sso-migration-plan.md:614,857`、交接 `:67` 要追加 `/api/sso/verify`；实际 SsoService C:17 使用完整 URL。该旧段落不能转化为升级实现要求。
- `docs/sso-migration-plan.md:1021,1052` 称 SsoCreateAccountDto 含 optional company；实际 7 行文件只有 token。
- 文档对第三方 cookie/Safari 的解决声明只能视为意图，源码尚保留 cookie 读写与 withCredentials，且本次未进行浏览器兼容实测。

父调查追加的评论 API 文档核验：`doc/social-platform-comments-api.md:14,22,37` 宣称 fetchComments/replyToComment 与 YouTube 已实现，:342–343 列出 social-comments.controller 与 comments.service。B/C/S 三个 Git tree 都不存在这两个路径；YouTube provider 在 B=C，B/C/S 均没有上述两个方法、commentThreads.list 或 comments.insert；接口 C:84 只有 post 与 optional comment（用于已有发帖/线程流程）。该文档在第二个定制提交加入，不能据此把“收取/回复 YouTube 社交评论”计入已实现的定制功能。本次未审计所链接的外部平台文档或其时效。

## 需要下游明确的业务决策（本报告未代答）

1. 商户认证的最小承诺：继续以一个 merchantId 对应一个共享 Postiz 用户并首次自动开户，还是父平台另有个人用户/预建账户契约。当前文档与代码相反，不能默认按文档新增端点。
2. 多组织与成员状态：商户再次登录目标是既有第一个组织、订阅组织、明确绑定的商户组织，还是让用户选择；无组织/已禁用成员要返回什么。首次 org SUPERADMIN 的角色是否仍为合同要求。
3. 身份命名空间：是否存在标准 GENERIC OAuth 用户或将启用该入口；若存在，merchantId 与 OAuth sub 的碰撞、已有数据归属、管理员 switch 对映射的影响必须有明确规则。不要用无证据的数据库迁移替用户决定。
4. S 的账户删除进入产品后，同商户有效 code 再登录是否允许创建全新账户；若不允许，哪一方提供禁用/删除状态。现有 code 兑换响应仅有 merchant_id/name。
5. 支持的登录范围和部署 origin：商户 SSO 之外是否必须保留普通登录/激活/标准 OAuth、iframe 与独立窗口是否都支持。由此决定如何同时满足 sessionStorage 传递及 S 新 state-cookie 校验，而不是直接放弃其中一边。
6. 可选服务策略：只要求缺 OpenAI key 返回明确错误、MCP 失败不挡核心 API，还是要求所有 unhandledRejection 都不退出；是否实际使用 MCP_ONLY。后者是更广的运行策略，不能仅凭 SSO 目标推定。
7. 管理员模拟功能是否属于保留范围；若是，本地上传与普通 API 的 impersonate/组织一致性是具体验收项。

上游安全校验、确定缺失 import、纯类型修补、普通冲突组合属于后续技术工作，不应全部包装成要求用户选择实现细节的问题。尚需决定的上述业务边界与运行实测分开跟踪。

## 本报告未声称完成的验证

未安装依赖、未生成 Prisma Client、未跑 TypeScript/Nest/前端构建、未启动服务、未连接 DB/SSO/浏览器/集群、未验证任何真实 token、未迁移数据。文本冲突、静态未解析标识符、调用关系、Git tree 存在性为已观察事实；浏览器 cookie 行为、并发开户、删除后再登录、多组织、MCP readiness 与上传模拟用户的结果均为据源码得出的待验证推断。
