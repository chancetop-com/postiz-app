# v2.26.0 的版本边界与定制重叠

官方 v2.25.3 到 v2.26.0 有 **152 个可达提交、130 个变更文件**。以上次已吸收的官方版本为共同内容基线，与当前 fork 交叉比较后，有 **17 个路径双方都改过，8 个产生文本冲突**。邀请加入组织与公开 Connect Link 都跨越多个文件，合并验收需要观察最终组织归属、页面去向和渠道记录。[官方固定提交比较][delta] · [定制基线][fork]

## 三个固定版本

| 角色 | 完整提交 | 用途 |
| --- | --- | --- |
| B，官方 v2.25.3 | `a5affe62c74e39c1e7ac960d50d8418b807d532c` | 上次吸收的快照，也是本次两个差异的共同起点。[官方标签引用][base-tag] |
| F，当前定制版 | `838843077adfa0fbffb58ecef82c9324412533aa` | `postiz-stable-merge` 的产品树为 `3c922cd90acb22f1f6be07700a15142a036f789d`，与先前审查的 `76e29072` 树相同。[定制提交][fork] |
| U，官方 v2.26.0 | `132859f32d854830ce44b509da87409c3ec10a77` | GitHub 正式发布于 **2026-11-13 18:28:23 UTC**，即北京时间 11 月 14 日 02:28:23。该时间取自 Release 的 `published_at`，`draft` 和 `prerelease` 均为 false。[官方发布元数据][release-api] · [目标提交][target] |

F 只有一个父提交 `6fdf7cb53543fa28a470ad63e7619e8b98bcee43`。上次 squash 保留了产品树，F 与 U 的 Git 共同祖先仍为 `0b554e684483932d394e703208fe21648e7acd6f`，B 是 U 的祖先。直接以 F 和 U 的普通 merge-base 计算会再计入已吸收的改动。应以 B→U 度量上游增量、B→F 识别定制，以 F→候选核对实际升级结果。用户确认本次实施保留上游历史，待全部实现完成后再按另行指示 squash。[定制提交][fork] · [官方固定提交比较][delta]

在仅供研究的临时 bare 仓库可复核以下读数。三方预演只生成临时 Git 对象。

```bash
B=a5affe62c74e39c1e7ac960d50d8418b807d532c
F=838843077adfa0fbffb58ecef82c9324412533aa
U=132859f32d854830ce44b509da87409c3ec10a77
git rev-list --count "$B..$U"
git diff --shortstat "$B" "$U"
git diff --name-status "$B" "$U"
LC_ALL=C comm -12 <(git diff --name-only "$B" "$F" | LC_ALL=C sort) \
         <(git diff --name-only "$B" "$U" | LC_ALL=C sort)
git merge-base "$F" "$U"
git merge-tree --write-tree --name-only --merge-base="$B" "$F" "$U"
```

上游 130 个文件由 21 个新增、109 个修改构成，共增加 5,245 行、删除 1,062 行。B→F 有 1,529 个变更路径，其中 `k8s/` 占 990 个、`.scratch/` 占 389 个。B→U 没有改动 `k8s/`。下表按仓库根路径统计。构建副本应在后续打包时从最终根源码核对。[官方固定提交比较][delta] · [定制树][fork-tree] · [既有构建约定][spec]

## 17 个共同路径

带“冲突”的 8 项是上述 `merge-tree` 明确报告的内容冲突（退出码 1）。“自动合并”表示 Git 能拼合两端文本。业务观察项来自相应固定树或既有产品规格，本轮未运行候选代码。[上游变更][delta] · [定制树][fork-tree] · [既有产品规格][spec]

| 根路径 | 静态结果 | 后续核对 |
| --- | --- | --- |
| `apps/backend/src/api/routes/auth.controller.ts` | 冲突 | 邀请、OAuth 凭据验证、响应头和注册归因 |
| `apps/backend/src/services/auth/auth.service.ts` | 冲突 | 既有用户登录加入组织、签名会话、商户 SSO 与注册归因 |
| `apps/frontend/src/app/(app)/auth/layout.tsx` | 冲突 | 定制主题、登录返回地址与新增归因组件 |
| `apps/frontend/src/components/launches/continue.integration.tsx` | 冲突 | 匿名/已登录回调、带查询参数的返回地址、跨组织二步保存及 iframe 弹窗回传 |
| `apps/frontend/src/components/launches/launches.component.tsx` | 冲突 | 弹窗消息刷新列表、YouTube 标识与扩展重连 |
| `apps/frontend/src/components/layout/layout.context.tsx` | 冲突 | header→sessionStorage、401、reload、普通成员 402 和试用期 406 的不同交互 |
| `apps/frontend/src/proxy.ts` | 冲突 | 公开同意页、登录 OAuth 分流及组织邀请入口 |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` | 冲突 | 批量刷新遇失败继续，合入官方首次标记才通知的处理。该服务同时新增 Connect Link |
| `.env.example` | 自动合并 | 可选配置及部署默认值 |
| `apps/backend/src/main.ts` | 自动合并 | 负载均衡空闲超时和 fork 为浏览器暴露的认证响应头 |
| `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx` | 自动合并 | 公开预览取数回退和新平台图标 |
| `apps/frontend/src/components/auth/register.tsx` | 自动合并 | 客户端 OAuth 交换与注册归因字段 |
| `apps/frontend/src/components/launches/add.provider.component.tsx` | 自动合并 | 六种可见添加入口、iframe relay、YouTube 图标与扩展渠道 |
| `apps/frontend/src/components/layout/impersonate.tsx` | 自动合并 | 管理员代入会话及退款失败、争议款反馈 |
| `apps/orchestrator/src/activities/integrations.activity.ts` | 自动合并 | 定制刷新 activity 注册及官方解密调用 |
| `package.json`、`pnpm-lock.yaml` | 自动合并，共两项 | 成对校验依赖解析与源码镜像输入 |

## 邀请已有用户加入组织

1. 实际邀请是 `/?org=<签名邀请>`，包含组织、角色、邀请 ID 和有效期。官方代理在未登录时把邀请暂存在 `org` cookie。新版对已有密码用户在密码验证成功后写成员关系，未激活者仍须激活才能登录。已有 OAuth 用户则在 `/auth/oauth/:provider/exists` 完成身份交换后加入邀请组织。已是成员时仓储返回 false，避免重复插入。因此控制器也不会仅凭一次重复邀请返回新的 `showorg`。[邀请签发][invite-issue] · [官方代理][up-proxy] · [密码登录][up-login] · [OAuth 登录][up-oauth] · [重复邀请][up-membership]
2. 定制代理见到根路径 `?org` 会先调用 `internalFetch('/user/join-org')`。这个服务端 helper 从 Cookie 读 `auth/showorg`，拿不到浏览器标签页中的 sessionStorage。定制的密码端点仍从 `req.cookies.org` 解析邀请，OAuth 控制器则消费 `oauth-state-token` 头并直接回 `auth/reload`。由此可见，单合入官方服务层的入组逻辑无法覆盖未登录或仅有标签页会话的邀请入口。[定制代理][fork-proxy] · [内部取数][internal-fetch] · [定制密码端点][fork-login] · [定制 OAuth 交换][fork-oauth]
3. 候选版应从真实邀请 URL 进入，分别走密码、OAuth 和仅有 sessionStorage 的已有会话。检查新成员记录和角色、登录后当前组织、重复点击、过期邀请、未激活用户。邀请凭据继续由服务端验证，浏览器 OAuth 使用定制的有时效且绑定 provider/state 的证明，成功新增成员后通过响应头更新 `showorg`。普通登录与商户 SSO 原有选组规则分别验收。[邀请校验][up-invite-validation] · [定制 OAuth 状态校验][fork-state] · [定制会话写入][fork-layout] · [定制组织选择][fork-org]

## 公开 Connect Link 与既有渠道回调

- **创建和访问。** 组织授权的 `POST /public/v1/integrations/connect` 或 `integrationConnectTool` 为指定平台创建一小时有效的链接。收件人可以匿名打开 `/integrations/connect/[token]`。页面 GET 读取平台、可选返回站点。点击继续才 POST，服务端按链接归属再查组织和渠道配额，生成平台 OAuth state。链接可在有效期内重新发起，单次平台回调各用自己的 state。无需输入 Postiz 账户凭据。[公开 API][public-create] · [MCP 工具][mcp-connect] · [链接生命周期][connect-service] · [匿名入口及配额][public-connect] · [访客同意页][connect-ui]
- **回调与归属。** 上游复用 `/integrations/social/[provider]` 和 `POST /integrations/social-connect/:integration`，绑定目标来自发起链接时记录的组织。无自定义返回地址时，匿名用户在当前页看到结果，已登录用户去日历。有 `redirectUrl` 时保留原查询串再追加结果。需选择账号的渠道，用户可能当前登录组织 B、链接由 A 签发。上游先试当前组织的保存端点，遇 404 用同一 state 走公开保存，最后按 A 和 integration ID 查记录。候选版应断言绑定只出现在 A，并保留定制的二步失败可重试及单选行为。[官方回调][up-callback] · [404 分支][up-save] · [按 state 保存][public-save] · [按组织查渠道][save-org] · [定制二步保存][fork-save]
- **iframe 和独立窗口。** 既有添加界面在 iframe 中打开 `/channel-relay` 弹窗，跨窗口传递本标签页会话。回调按专用标记通知 opener 刷新并关闭，`CHANNEL_UPDATED` 本身不代表成功。独立窗口走原窗口导航。新同意页直接用 `window.location.href` 跳平台，官方社交渠道回调页还从服务端 cookie 判断已登录。需分别验证匿名分享链接、已有其他组织会话和从商户 iframe 主动发起的操作。匿名者不能依赖需要 `auth` 的旧 relay，已登录者在禁用第三方 Cookie 时仍须能完成二步选择。[定制 relay 契约][fork-popup] · [定制回调][fork-callback] · [官方同意动作][connect-ui] · [官方回调页][up-callback-page]
- **可见范围与外观。** fork 六个可见添加项按精确标识限制。API/MCP 上游以 provider 能力决定是否可发链接，排除隐藏、需实例地址、定制字段、Web3 或扩展的渠道。公开同意页没有平台选择器，但能展示别人发来的单一平台，使用固定深色和 Postiz 图案。用户确认仪表盘的六项限制继续生效，API／MCP 可为六项之外符合上游条件的平台生成链接。定制公开页使用我们的 Logo 和默认浅色，并保留平台图标、权限说明与授权按钮。原规格保留其他 provider 的注册、API 及历史绑定，32×32 PNG 品牌图案的既有约定针对主布局。[既有产品规格][spec] · [六项精确标识][six] · [可发链接范围][linkable] · [同意页视觉][connect-look] · [定制主布局图案][fork-logo]

## 其他受影响的界面与权限

多渠道帖子可按渠道勾选保存草稿、立即发布、更新排程或删除。同批未勾选渠道及跨组织帖子是两个独立验收条件。新版还在账单路由增加管理员权限，普通成员的 402 交互提示联系管理员。注册增加可选归因，YouTube 更新品牌标识，已有扩展渠道增加专用重连流程。这些改动要与隐藏的添加入口、可用的历史绑定、公开预览、日历及既有明暗主题一起检查。索引、加密和 Temporal 升级另见本轮数据票。[官方发布说明][release] · [多渠道编辑][channels-check] · [帖子归属校验][post-org] · [账单权限][billing] · [账单前端][billing-ui] · [注册归因][attribution] · [数据票](../issues/03-upgrade-data.md)

[base-tag]: https://api.github.com/repos/gitroomhq/postiz-app/git/ref/tags/v2.25.3
[target]: https://github.com/gitroomhq/postiz-app/commit/132859f32d854830ce44b509da87409c3ec10a77
[delta]: https://github.com/gitroomhq/postiz-app/compare/a5affe62c74e39c1e7ac960d50d8418b807d532c...132859f32d854830ce44b509da87409c3ec10a77
[fork]: https://github.com/chancetop-com/postiz-app/commit/838843077adfa0fbffb58ecef82c9324412533aa
[fork-tree]: https://github.com/chancetop-com/postiz-app/tree/838843077adfa0fbffb58ecef82c9324412533aa
[release-api]: https://api.github.com/repos/gitroomhq/postiz-app/releases/tags/v2.26.0
[release]: https://github.com/gitroomhq/postiz-app/releases/tag/v2.26.0
[spec]: ../../postiz-stable-merge/spec.md
[invite-issue]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/libraries/nestjs-libraries/src/database/prisma/organizations/organization.service.ts#L103-L115
[up-proxy]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/proxy.ts#L97-L138
[up-login]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts#L88-L113
[up-oauth]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/api/routes/auth.controller.ts#L361-L418
[up-membership]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts#L407-L433
[up-invite-validation]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts#L135-L160
[fork-proxy]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/proxy.ts#L35-L116
[internal-fetch]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/libraries/helpers/src/utils/internal.fetch.ts#L4-L11
[fork-login]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/backend/src/api/routes/auth.controller.ts#L93-L122
[fork-oauth]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/backend/src/api/routes/auth.controller.ts#L261-L292
[fork-state]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/backend/src/services/auth/auth.service.ts#L296-L335
[fork-layout]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/components/layout/layout.context.tsx#L44-L97
[fork-org]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/backend/src/services/auth/auth.middleware.ts#L90-L100
[public-create]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/public-api/routes/v1/public.integrations.controller.ts#L409-L431
[mcp-connect]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/chat/tools/integration.connect.tool.ts#L16-L74
[connect-service]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#L474-L594
[public-connect]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/api/routes/no.auth.integrations.controller.ts#L373-L410
[connect-ui]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/launches/connect.link.tsx#L17-L95
[up-callback]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/launches/continue.integration.tsx#L41-L58
[up-save]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/launches/continue.integration.tsx#L225-L266
[public-save]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/api/routes/no.auth.integrations.controller.ts#L357-L370
[save-org]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#L425-L467
[fork-save]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/components/launches/continue.integration.tsx#L229-L286
[fork-popup]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/components/launches/channel.popup.ts#L1-L103
[fork-callback]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/components/launches/continue.integration.tsx#L45-L68
[up-callback-page]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/app/%28app%29/integrations/social/%5Bprovider%5D/page.tsx#L14-L23
[six]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/components/launches/allowed.channels.ts#L1-L21
[linkable]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/integrations/integration.manager.ts#L246-L260
[connect-look]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/launches/connect.link.tsx#L146-L190
[fork-logo]: https://github.com/chancetop-com/postiz-app/blob/838843077adfa0fbffb58ecef82c9324412533aa/apps/frontend/src/components/new-layout/logo.tsx#L3-L11
[channels-check]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/new-launch/manage.modal.tsx#L418-L505
[post-org]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#L1158-L1174
[billing]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/api/routes/billing.controller.ts#L54-L102
[billing-ui]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/layout/layout.context.tsx#L93-L126
[attribution]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/auth/attribution.component.tsx#L37-L73
