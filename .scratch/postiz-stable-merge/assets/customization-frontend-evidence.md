# 前端逐项定制与三方证据

Date: 2026-11-11（Asia/Shanghai）
Scope: 两个定制提交涉及的全部 `apps/frontend` 路径；只读调查，不作保留/删除批准，不解决冲突，不宣称运行通过。

## 固定版本与证据方法

| 标记 | 对象 |
| --- | --- |
| B | `0b554e684483932d394e703208fe21648e7acd6f`，定制前共同基线 |
| C1 | `f042c177c1a378edacd54790614bdd9f709a2480`，首个定制提交 |
| C2 / C | `6fdf7cb53543fa28a470ad63e7619e8b98bcee43`，第二个提交及定制合并状态 |
| S | `a5affe62c74e39c1e7ac960d50d8418b807d532c`，锁定稳定版 |
| 当前源码 | `501e87dbfb2ca6e44662baec308afa468a922b38`；C 后仅代理文档/ignore，无前端产品改动，因此下列 C 行号亦适用于当前主工作区 |

先经 CodeGraph 定位当前文件/符号，再完整阅读 `git show C1 -- apps/frontend`、`git show C2 -- apps/frontend` 的所有 hunks；用 `git diff --no-renames B C`、`git ls-tree` 与 `git diff B S` 核对范围及稳定版变化。S 正文来自父任务准备的隔离副本 `/private/tmp/postiz-wayfinder-three-way-n90eeeum/repo`，始终以明确的 S 引用读取，未把试合并工作树当成 S。

初次主工作区 `git diff B S` 的重命名检测尝试自动取缺失 promisor blob，因 DNS 失败；后续全部历史读取使用 `GIT_NO_LAZY_FETCH=1`。父任务补齐隔离副本对象后，以下 S 内容均已读取，未保留“缺对象故未核实”的结论。本子任务没有安装、构建、运行应用、部署、网络研究、checkout、merge 或冲突修改。

父任务在隔离副本完成诊断 merge；本子任务只读取 `git diff --cc` 与 stage 0。原始记录见 [diagnostic-merge.log](diagnostic-merge.log)。本文的“自动合并”仅指 Git 文本结果，运行及产品契约仍未验收。

## 路径覆盖（25/25）

`B→C` 为 20 个修改文件、5 个新增文件（含 1 个 PNG）。C1 涉及 10 个路径，C2 涉及 18 个路径，交集为 add.provider、launches、top.menu 三个文件。S 对其中 16 个既有文件另有修改；4 个既有文件保持 B 的 blob；5 个新增文件在 S 不存在。没有定制路径被 S 整文件删除。下表省略路径前缀 `apps/frontend/`；所有行号均以 C 为准，除非标明 S。

### 会话、入口与 SSO（10 个路径）

| ID / 路径 / 提交 | B→C 的完整定制效果及代码证据 | B→S / 三方关系 | 后续票 |
| --- | --- | --- | --- |
| FE01 `next.config.js` / C1 | `nextConfig:6` 增加 `output: 'standalone'`。没有改其它 Next 配置。 | S blob 与 B 完全相同；此配置是本地独有，诊断结果保留。不能仅凭这行认定某个 Docker 入口正确。 | [决定源码构建与部署运行时的升级方式](../issues/07-build-runtime-strategy.md) |
| FE02 `src/app/(app)/auth/sso/page.tsx` / C2 新增 | `SsoRedirectPage:3–16` 将旧 `?token=<string>` 编码后重定向 `/sso?auth_code=...`，无 token 则 `/sso`；不传其它 query。`searchParams` 被声明并读取为同步对象。 | B/S 无此路径；新增文件自动保留，但需要在目标 Next 版本验证该页面的 searchParams 契约。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md) |
| FE03 `src/app/(app)/sso/page.tsx` / C2 新增 | `SsoLoginPage:15–33` 优先 URL `auth_code`；只有无 URL code 时注册 message handler，允许 origin 为 `NEXT_PUBLIC_SSO_PARENT_ORIGINS.split(',').filter(Boolean)` 的精确成员；接收 `{type:'SSO_TOKEN', auth_code}`。`:35–55` 用 `useFetch` POST `/auth/sso`，JSON `{auth_code}`；任意 `res.ok` 写一年 `mode=light` cookie，再 `router.replace(isGeneral ? '/launches' : '/analytics')`。失败显示原始响应 text/异常 message，并提供普通登录链接；等待时 `return null`。使用 `useState<string>`、catch `any`，不解析成功响应体。 | B/S 无此路径；自动保留。是否可进入页面还取决于 proxy 冲突和后端/统一 fetch 兼容，不是新增文件存在即可工作。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE04 `src/app/(app)/sso/layout.tsx` / C2 新增 | `SsoLayout:3–9` 为 children 添加 `light min-h-screen bg-white flex items-center justify-center` 容器。 | B/S 无此路径；自动保留。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE05 `src/components/layout/layout.context.tsx` / C1 | 新增 `clearSessionAuth:25–30` 清除 auth/showorg/impersonate。`LayoutContextInner:34,44–72` 去掉 isSecured 条件，三个非空响应头写 sessionStorage，logout 清会话并到 `/auth/login`；`:90–98` reload 从整页 reload 改跳 launches/analytics，401 也清会话跳登录。保留 return URL 优先、onboarding 分流、402/406 处理、预览/provider 路径提前返回。`setCookie` 导出仍存在。 | S 仍是 cookie/isSecured/reload 原方式；只修改 406 文案和 402 `response.clone().json().catch`。文本自动合并把 C 会话流程与 S 的这两项改进拼合；不是 S 原生支持 sessionStorage。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md) |
| FE06 `src/components/layout/logout.component.tsx` / C1 | `LogoutComponent:9–31` 移除 isSecured 分支和 `/user/logout` POST；确认后仅清 auth/showorg/impersonate sessionStorage，跳 `/auth/login`。未删除原 useFetch/setCookie 导入及 fetch 局部变量。 | S blob 与 B 相同；本地退出行为自动保留。现存 cookie 的后端兼容需与后端证据一并决定，不能称“服务端登出”。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md) |
| FE07 `src/components/new-layout/layout.component.tsx` / C1 | 增加 useEffect 导入及一空行；`load:59–63` 对任意非 2xx 返回 null；`:72–76` 当 user 严格等于 null 时跳 `/auth/login`；仍在 falsy user 时渲染 null。`CopilotKit:86–89` 加 sessionStorage auth/showorg headers（没有 impersonate）。 | S 新增本地字体、移动菜单/useState、用户时区初始化、Sentry 身份、Invoices、TrialTracker、Copilot `useSingleEndpoint`。冲突在 React import、两个 user effect；C load 容错、headers 与 S UI 大部分已自动拼合。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE08 `src/components/agents/agent.chat.tsx` / C1 | `AgentChat:53–56` 的 CopilotKit 新增 sessionStorage auth/showorg headers；没有 impersonate。 | S 同处新增 `useSingleEndpoint`，另更换公开类型 import、支持新消息格式/加载竞态、媒体扩展名判断、fromUtc、可选 picture 等。自动结果同时有 C headers 与 S single endpoint。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE09 `src/proxy.ts` / C1 | `proxy:13` 删除 auth cookie/header/loggedAuth 读取、未登录 `/modal/` 门禁、普通页→auth 登录重定向（含 provider 推断）、已登录 auth→根跳转、未登录 org 邀请 cookie 保存分支。`:51–61` 保留旧 auth cookie 清除路径，但去掉 secure/httpOnly/sameSite 条件属性；`:74–88` join-org 仅非 `/auth` 执行，仍由服务器 internalFetch 请求，showorg cookie 只保留 15 分钟 expires。保留语言、公共资源/回调放行、禁止注册、根路由分流、异常去 `/auth/logout`；另有对象缩写/注释/EOF 换行整理。 | S 保留旧 cookie 门禁，新增 `/oauth/authorize` 放行（S:53），org 邀请 cookie 延长到 2 天（S:128）、showorg 到 1 年（S:158）。冲突为被 C 删除的 auth/org 分支与 showorg 属性/寿命；不能脱离外部已自动删除的 authCookie/url 定义单独选择某个冲突块。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md) |
| FE10 `src/app/(app)/channel-relay/page.tsx` / C2 新增 | `ChannelRelayPage:7–30` 声明 `JSX.Element \| null`；effect 从 query 读 redirect、hash 读 auth/showorg/impersonate；缺 redirect 或 auth 返回空白；写 popup sessionStorage（可选值仅有值才写），设 `channel_popup_mode=true`，`location.href=redirect`。无 redirect 校验、清空 hash、结束状态或错误 UI。 | B/S 无此路径；新增文件自动保留。C1 已引用该路由，C2 才加入页面。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md) |

### 渠道流程（3 个路径）

| ID / 路径 / 提交 | B→C 的完整定制效果及代码证据 | B→S / 三方关系 | 后续票 |
| --- | --- | --- | --- |
| FE11 `src/components/launches/add.provider.component.tsx` / C1+C2 | C1 的 `AddProviderComponent.gotoIntegration:501–526` 在 invite/mobile 分支之后检测 iframe，读取三个 sessionStorage 值，编码到 relay URL hash，调用 `window.open(...,'_blank','popup,width=600,height=700')`，关 modal 并 return；普通窗口仍 `location.href=url`。C2 的 `social.filter:687–703` 新增精确六 identifier 白名单 `youtube, linkedin, tiktok, facebook, instagram, instagram-standalone`，再执行既有 invite 限制。 | S 新增多路径 402 早退、customFields hint 类型/tooltip、Web3 code 编码、chrome 不存在判断、移动样式。自动合并保留 C popup 和六值过滤，也保留 S 上述改进。S 新 provider `tiktok-business` 与 `tumblr` 不在精确白名单，不能自动视作允许。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md) |
| FE12 `src/components/launches/continue.integration.tsx` / C1 | `ContinueIntegration.navigateOrShow:43–73` 在原 returnURL/logged/inline 逻辑之前：若 channel_popup_mode 为 true，则向未关闭 opener `postMessage({type:'CHANNEL_UPDATED',provider}, '*')`；吞发送异常后尝试 close、return。没有清 popup 标志、ack、失败通知或 opener 丢失的页面回退。 | S 添加 tiktok-business `auth_code→code`（S:74）、newDayjs 时区（S:107）、扩展 lastError 处理（S:186）、tumblr/tiktok-business 显示名称。自动结果同时保留 C popup 分支及 S 回调适配。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md) |
| FE13 `src/components/launches/launches.component.tsx` / C1+C2 | C1 增 useRef import；`LaunchesComponent:365–380` 以 ref 保存最新 mutate，监听任意 message，只检查 `data.type==='CHANNEL_UPDATED'` 即 revalidate 渠道列表，卸载时移除 listener。C2 `:363` mode 默认 dark→light。 | S 新增 CustomVariables import、分组改名、custom-fields 重连、移动 channelsOpen 面板、ChannelsAfterPayment、HubspotInstalled。两处冲突为 import 和 mode/channelsOpen 相邻块；message listener 本体已自动保留。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |

### 品牌、主题、隐藏入口与容错（12 个路径）

| ID / 路径 / 提交 | B→C 的完整定制效果及代码证据 | B→S / 三方关系 | 后续票 |
| --- | --- | --- | --- |
| FE14 `public/logo-postiz.png` / C2 新增 | 新增 4,410 bytes PNG，163×144 RGBA；blob `9698d8db63bf8d5927c264e31864fb8e06837ae7`。 | S 无此文件；自动保留。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE15 `src/components/new-layout/logo.tsx` / C2 | `Logo:3–12` 将 60×60 inline SVG（mt8/min-w60/min-h60）替换为 `/logo-postiz.png` 的普通 img、alt Logo、mx-auto，inline width32/height32/marginTop20。原图不是正方形但这里固定 32×32。 | S 文件与 B 相同；本地组件自动保留。S 主布局另外用居中容器包 Logo，移动侧栏改变，需要检验最终出现位置/尺寸。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE16 `src/app/(app)/layout.tsx` / C2 | `AppLayout:54` body 默认 class dark→light，仅此一行。 | S 更换本地字体、移除 PHProvider、加入 GTM/CHATBASE/Apple/recaptcha/mediaProcessing 等上下文；自动结果 body 仍 light，同时保留 S 新上下文。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)、[决定源码构建与部署运行时的升级方式](../issues/07-build-runtime-strategy.md) |
| FE17 `src/app/(app)/auth/layout.tsx` / C2 | `AuthLayout:17–21` 三处样式：外层硬编码黑色/白字改 bg-primary/text-textColor；卡片黑底改 bg-secondary、白字改 text-textColor；内部白字同改。 | S 在原深色 JSX 外加 MantineWrapper/Toaster，并重排缩进；诊断产生整块 JSX 冲突。主题改变和基础 wrapper 都需分别判断。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE18 `src/components/layout/mode.component.tsx` / C2 | `ModeComponent:10` useCookie mode 默认 dark→light；`:12–20` 原切换 dark/light、修改 body class 逻辑未变，按钮仍存在。 | S 文件与 B 相同；本地默认自动保留。此定制不是强制禁用深色模式。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE19 `src/components/analytics/chart-social.tsx` / C2 | `ChartSocial:24` mode 默认 dark→light，影响既有 tooltip/hover 色彩。 | S 相邻位置新增空行，并改少量数据点处理（不足7不合并，单点复制两份显示线）；产生 mode/空行冲突，数据点逻辑在冲突外已进入结果。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE20 `src/components/billing/embedded.billing.tsx` / C2 | `EmbeddedBilling:27` mode 默认 dark→light，既有 modeEmitter 保留。 | S 仅将相关日期格式化 dayjs→newDayjs；自动合并保留两侧变化。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE21 `src/components/ui/icons/index.tsx` / C2 | `NoMediaIcon:773` mode 默认 dark→light；既有事件监听/两套 SVG 未改。 | S 新增 SettingsOutline/Eye/Filter/Pencil 图标；NoMediaIcon 默认仍 dark。自动结果新增图标及本地 light 均保留（合并 stage0:871）。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE22 `src/components/layout/top.menu.tsx` / C1+C2 | `useMenuItem` C1 为 Settings 加 hide true（C:284）；C2 为 Agent（:61）、Plugs（:122）、Integrations（:144）加 hide true；不删路由/服务。 | S 删除菜单中的 Plugs、Integrations、UGC 及 handleAgentMediaClick；Agent/Settings 仍可见；菜单间距改变。Plugs/Integrations 删除与本地 hide 修改发生冲突；Agent/Settings hide 已在其余部分自动保留。S 的旧 plugs/third-party 路由分别重定向 `/settings?tab=plugs`、`/settings?tab=integrations`（各:6）；Settings 增加集成/Plugs/Apps tabs（S settings.component:109–111），不是功能被上游禁用。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE23 `src/components/media/media.component.tsx` / C2 | `MultiMediaComponent:841–865` 仅加注释包围工具区域，实际隐藏 Design Media、**ThirdPartyMedia**、AiImage、AiVideo；保留 Insert Media、工具栏、媒体设置及原函数/import。单媒体 `MediaComponent:990` Editor 按钮未被此次定制隐藏。 | S 重写此工具区域为移动滚动/底部工具栏，增加 toolBarEnd/toolsClassName/toolsStyle/insertInContent 类型与行为；Design Media 仅 mobile:hidden，AI 和 ThirdPartyMedia 各有新条件。冲突覆盖注释起止及被重排的 JSX。S 同文件还有媒体库移动布局、批删、静态图片类型、上传提示等，不能整文件用 C 替代。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE24 `src/app/(app)/(preview)/p/[id]/page.tsx` / C2 | `Auth:37–46` post 改为 `any[]=[]`；fetch/JSON try-catch，只有 Array.isArray 才赋值，失败/非数组进入原“Post not found”分支。未检查 HTTP ok；未覆盖后续每个 post 的 JSON.parse 等渲染错误。 | S 重做预览/评论布局、引入 PreviewCommentsProvider/PostContentClient、sanitizePostContent、CreationMethodBadge，仍保留 Logo 与 max-w1346，取数仍直接 .json（S:41）。自动合并已同时保留 C 容错与 S 新结构/内容处理。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |
| FE25 `src/components/preview/preview.wrapper.tsx` / C2 | `PreviewWrapper.load:14–18` `/user/self` 非2xx返回 null，再对成功响应 .json；没有 catch 网络或 JSON 异常；没有新增登录跳转。此文件无固定宽度/logo删除。 | S 加 ToolTip 和 Copilot useSingleEndpoint；自动合并同时保留 C res.ok 判断与 S 新内容。这里的 CopilotKit 仍只配置 credentials，无 C 新增 auth/showorg headers；不能把其它两处 Copilot 定制当作已覆盖这里。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) |

## 必须分开的实际行为与意图

以下是进一步阅读调用路径后得到的契约问题，不是本任务批准的修复方案。

| 主题 | 已确认实现事实 | 需要交给后续票的明确决定/场景 |
| --- | --- | --- |
| SSO 父页接口 | URL code 优先，存在 URL code 时不安装 message listener。message origin 按逗号精确分隔但不 trim；没有 event.source 校验、单次消费/并发保护。页面未向父页发送 SSO 成功/失败消息，也没有 needsCreation/create-account 分支。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)：父应用实际采用哪个既有入口，是否仍需旧入口；无父应用修改约束下的来源约定、重复消息/错误恢复；文档里的父页消息和手动开户究竟过时还是未实现需求。 |
| 商户身份 | 依据 [local-audit-2026-11-11.md](local-audit-2026-11-11.md) 的服务端证据：完整 SSO_SERVER_URL 接收 `{auth_code}`，以 Provider.GENERIC/providerId=merchantId 查找，复用用户及第一个组织，首次自动开户。前端只检查 res.ok，未实现开户选择。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)：身份/组织复用和自动开户逐项决定，不能把旧文档当现有前端流程；完整验证 URL 不可按过时文档自动追加路径。服务端详细证据由对应审计负责。 |
| 会话范围 | auth/showorg/impersonate 改 sessionStorage，但 UI mode 仍 cookie，proxy 还写旧 auth/showorg cookie；响应头仅真值覆盖 storage，没有空值清除分支。普通退出不请求后台登出；/auth/logout proxy 只清 legacy auth cookie，不清 sessionStorage。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)：同标签页换商户、切组织、impersonation、退出/401、旧 cookie 共存、打开/关闭新标签页的具体预期。不能笼统称“彻底去 cookie”。 |
| `/user/self` 降级 | 主布局任意非2xx→null→登录；网络拒绝和成功状态的 JSON 解析异常没有本地 catch，SWR error 没有对应显示，不能归入同一“跳登录”保证。预览 wrapper 非2xx只返回 null，不跳转。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)：401、5xx、离线、非JSON、空 JSON 用户对象分别应做什么；哪些已有回退保留，哪些需单独适配。 |
| Copilot 旁路 | C 只给 AgentChat 与主 Layout 的 CopilotKit 加 auth/showorg；不包含 impersonate；PreviewWrapper 未加这些 headers。S 三处均新增 useSingleEndpoint。 | [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)：隐藏 Agent 与实际 Copilot 调用范围不同；按主布局/预览/Agent 各自验证会话传递，不能靠统一 fetch 验收代替。 |
| popup 覆盖范围 | C popup 插入点只在 AddProvider 的 gotoIntegration，且在 invite/mobile 早退之后。C `LaunchesComponent.refreshChannel:456–474` 仍取 refresh URL 后直接 `window.location.href=url`；web3/customFields/extension 有各自分支。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)：添加、重连、多步选择、invite、mobile、浏览器扩展是否都属于 iframe 必保范围；不能把添加成功扩展为所有渠道操作已修复。 |
| popup 完成信号 | `navigateOrShow` 不只在成功连接/保存调用：C `continue.integration:137–150` 的 412 precondition 和 406 NotAcceptable 也调用，因此也会发送 CHANNEL_UPDATED 并尝试 close。其它非200/201路径设置错误状态，不发此消息。2026-11-11 修正：2步保存失败未清 twoStepState，选择 UI 的渲染优先于 error，错误可能被遮住；不能笼统说留错误页，见 [渠道兼容讨论事实补充](channel-oauth-discussion-evidence.md)。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)：明确 CHANNEL_UPDATED 是“需要刷新”还是“成功”，拒绝/取消/失败如何向 opener 呈现；mock 应覆盖 200/201/412/406/其它失败与2步保存。 |
| popup 生命周期与信任 | window.open 返回值未检查；relay 缺值空白；opener 不存在也 close；close 失败后无替代页面；popup flag 未清。发送 targetOrigin `*`，接收不查 origin/source，redirect 未校验。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)：弹窗拦截、opener 丢失、回调失败、重复连接/旧 flag、来源/redirect 约束逐项定案，且不默认要求父应用变化。 |
| 注释与实现差异 | AddProvider 注释 C:503–505 写“localStorage、JWT user ID 作为 key”，源码实际使用 sessionStorage relay + postMessage，无该 localStorage 完成通知。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)：清单/验收以实际路径为准，不能为配合注释假定已有另一条通知机制。 |
| 六 identifier 范围 | 只过滤 AddProviderComponent 的 social 列表；article 列表和后端 provider 没有由这段代码禁用，已连接渠道列表也不在这个过滤器中。精确值不含 linkedin-page、tiktok-business。 | [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)：限制是“允许六个 identifier”还是六个平台家族；稳定版新增 tiktok-business/tumblr、旧多步 provider 和存量非白名单渠道分别如何处理。 |
| 浅色与品牌 | 默认 light 与 SSO 成功写 light cookie 不等于禁止用户改 dark；主布局 ModeComponent 仍呈现。Logo 只替换 new-layout Logo，预览仍显示 postiz.svg/文字 SVG，auth 仍是 LogoTextComponent。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)：明确默认主题、SSO重置主题、用户切换和每个 logo 出现位置；不要用“全站替换 logo/强制浅色”描述现状。 |
| 功能隐藏边界 | 菜单 hide 没有 route/API guard；媒体注释隐藏范围多包含 ThirdPartyMedia，但保留单媒体 Editor。S 把 Plugs/Integrations 移入 Settings，并新增认证/删账户等设置内容。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)：确认需隐藏的是哪些入口/路由/服务；新版移动入口、设置页和媒体库第三方入口分别适用什么契约。 |
| 预览文档修正 | 两定制提交只改取数容错，未移除宽度或 logo。C 与 S 均有 preview logo/max width；S 还新增可编辑内容/评论联动与内容净化。 | [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)：预览宽度/logo的“已完成”旧描述不能转为已实施定制，也不能暗增为本次升级新需求。 |

## 三方诊断结果与未被文本冲突暴露的差异

前端实际冲突 **7 个文件、11 个冲突块**。范围内另 18 个文件存在 stage 0 结果，其中 9 个是 S/C 都改过但文本自动合并的文件，另外 9 个为 S 与 B 相同或本地新增。

| 冲突文件（相对 apps/frontend） | 冲突块数与实质 | 不应从冲突外遗失的内容 |
| --- | --- | --- |
| `src/app/(app)/auth/layout.tsx` | 1：C 主题 class 与 S wrapper/Toaster 重排 | ReturnUrl、LogoText、testimonial；只选择整侧不能表达两种独立意图 |
| `src/components/analytics/chart-social.tsx` | 1：C light 与 S 同行附近空行 | S 单点/少点图表处理在冲突外 |
| `src/components/launches/launches.component.tsx` | 2：useRef vs CustomVariables import；light vs channelsOpen | C mutateRef/message effect；S custom-fields重连、分组改名、移动面板、支付/Hubspot 组件 |
| `src/components/layout/top.menu.tsx` | 1：C hidden Plugs/Integrations vs S 删除菜单条目 | S 功能已移入 Settings；C Agent/Settings hide 在其它位置 |
| `src/components/media/media.component.tsx` | 2：注释起止与 S 重排工具 JSX | S insertInContent/移动工具/媒体库行为；C 注释含 ThirdPartyMedia |
| `src/components/new-layout/layout.component.tsx` | 2：React imports；user=null重定向 vs Sentry effect | C headers/res.ok guard；S timezone/onSuccess、single endpoint、移动菜单和发票入口 |
| `src/proxy.ts` | 2：删除 auth/org 分支 vs S 延长邀请期；showorg cookie 属性和寿命 | C 已在其它位置删除 authCookie/url 定义和门禁；S oauth/authorize 公共例外；必须全函数核对 |

已读取下列自动合并 stage 0 标记，确认“文本仍在”，但没有运行验证：

| 自动合并文件 | 观察到的两侧内容 | 仍需验收的关系 |
| --- | --- | --- |
| app layout | light body + S 本地字体/新配置上下文/GTM | 新配置、可选服务与本地主题/嵌入场景 |
| preview page | C Array.isArray/try-catch + S 内容净化/PreviewCommentsProvider/PostContentClient | 空数据与新评论、可编辑内容路径；不能用 C 整页覆盖 S |
| agent.chat | C headers + S useSingleEndpoint/消息适配 | 新 Copilot 协议是否仍经预期 header 鉴权 |
| add.provider | C popup/白名单 + S 402 guards/hint/chrome/Web3/移动样式 | 新 identifier、计费拒绝、浏览器弹窗行为 |
| continue.integration | C popup return + S tiktok-business/时区/扩展处理 | 弹窗与不同回调结果、多步连接完成语义 |
| layout.context | C sessionStorage/跳转 + S 402 clone/406文案 | 与 S 后端 cookie、OAuth/普通登录、返回 URL 一致性 |
| embedded.billing | C light + S newDayjs | 主题与用户时区显示 |
| preview.wrapper | C res.ok guard + S ToolTip/useSingleEndpoint | 匿名预览/登录状态及 Copilot header 范围 |
| ui/icons | C NoMediaIcon light + S 新 icons | 空媒体视觉及主题切换 |

上述检查只覆盖前端定制所在位置及必要调用上下文。后端/共享库鉴权、CORS、上传 headers、可选服务降级、部署和数据迁移由对应审计给出，不能由本表推断已通过。[决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md)、[决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md)、[决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md)的具体争议项仍为开放决定；本文件没有批准缺陷原样保留，也没有授权重构。
