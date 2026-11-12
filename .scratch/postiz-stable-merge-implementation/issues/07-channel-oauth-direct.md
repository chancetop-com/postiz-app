# 07: 六渠道入口与直接 OAuth 回调可用

**What to build:** 商户只看到约定的六个添加渠道入口，并能在 iframe 中通过携带当前会话的弹窗完成直接 OAuth 绑定，回到正确商户和组织刷新渠道；独立窗口继续当前窗口导航。

**Blocked by:** 05 — [保留组织切换、会话及普通登录流程](05-session-organization-login.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“六项渠道与完整授权回传”；同时遵守[共同执行约束](../README.md#执行约束)。本票完成公共链路及三个直接回调 provider，多步单选由 08 完成。

- [x] 所有社交、文章、新版添加及选择界面仅显示 youtube、linkedin、tiktok、facebook、instagram、instagram-standalone 六个精确 identifier；两种 Instagram 入口保持区分，不放入 linkedin-page、tiktok-business、tumblr 或其它同家族 provider。
- [x] 其它 provider 的注册、代码、接口及已有绑定保留，不以隐藏入口为由新增后端禁用或删除记录。
- [x] iframe 添加经过 popup、URL hash 会话、channel-relay 写入弹窗 sessionStorage、外部 OAuth、callback、opener 刷新及关闭的完整链路；auth/showorg/impersonate 均传入并用于正确组织的实际请求。
- [x] LinkedIn 个人账号、既有 TikTok、Instagram Standalone 分别在外部授权替身和真实内部 API/数据库下完成绑定，页面刷新显示实际结果；普通窗口添加继续当前窗口导航。
- [x] CHANNEL_UPDATED 保持 type/provider 字段及既定刷新、关闭顺序；200/201、412、406 等按契约处理，消息发出或窗口关闭不能单独作为绑定成功证据。
- [x] 纳入上游兼容的 402 拒绝后停止解析和授权，以及用户时区处理；保留账号/密钥重连、Web3 编码与扩展兼容相关代码，不因入口限制裁剪其它能力。
- [x] 验证拒绝、取消、其它错误、弹窗阻止、opener 丢失、关闭失败、relay 缺参数、重复操作及遗留 flag；按基线和最终完整流程断言，不预设取消必定对应一个状态码。
- [x] 不自行增加回退页、重试、清理或更改 targetOrigin、消息来源及 redirect 校验策略；记录现有边界，不将本地授权模拟表述为安全性或真实平台配置已验证。
- [x] 留存六入口核对与三个直接授权流程的浏览器、HTTP、绑定数据和平台替身结果；真实六渠道 OAuth 联调状态留待最终报告逐项列明。

## Answer

2026-11-11，`codex/ticket-07-channel-oauth` 完成。合并前端已有实现未删除任何 provider；本票把“六入口 identifier 契约”和“popup 会话/回传协议”抽成两个共享模块，用 8 个新测试文件（49 个用例）锁定入口集合与完整回传链路，并纳入 402 早退、用户时区、账号/密钥重连、Web3 编码与扩展兼容的既有上游行为。

### 改动

| 文件 | 改动 |
| --- | --- |
| `apps/frontend/src/components/launches/allowed.channels.ts`（新增） | `ALLOWED_ADD_CHANNEL_IDENTIFIERS` 六个精确 identifier 与 `isAllowedAddChannel`；`add.provider.component.tsx` 的原内联数组改为引用它。 |
| `apps/frontend/src/components/launches/channel.popup.ts`（新增） | relay URL（`redirect` + `auth/showorg/impersonate` hash）、`channelUpdatedMessage`/`isChannelUpdatedMessage`、`isEmbeddedInIframe`、`isChannelPopup`、`markChannelPopup`、`notifyChannelPopupOpener`、`subscribeToChannelUpdates`。只集中常量与顺序，未改 targetOrigin(`*`)、接收端只查 `type`、relay redirect 不校验的既有边界。 |
| `add.provider.component.tsx` | iframe 分支改用 `isEmbeddedInIframe()` + `buildChannelRelayUrl()`；普通窗口仍 `window.location.href = url`；弹窗被阻止时不重试。 |
| `continue.integration.tsx` | popup 分支改用 `isChannelPopup()` + `notifyChannelPopupOpener()`；顺序保持“先 postMessage，再 `window.close()`”，412/406 同样回传。 |
| `launches.component.tsx` | 消息监听改用 `subscribeToChannelUpdates(() => mutateRef.current())`，即只重新拉取绑定列表。 |
| `app/(app)/channel-relay/page.tsx` | 改用共享 session key 与 `markChannelPopup()`；仍只覆盖父页真实传入的非空值，未做清理（保留 05 记录的 stale `impersonate` 基线）。 |
| `k8s/**` | 由 `./k8s/prepare-build-context.sh` 生成，未手工编辑。 |

### 六入口 identifier 证据（逐项）

同一份 `/integrations` payload（精简）同时包含 `linkedin`(LinkedIn)、`linkedin-page`(LinkedIn Page)、`facebook`(Facebook Page)、`instagram`(Instagram\n(Facebook Business))、`instagram-standalone`(Instagram\n(Standalone))、`youtube`(YouTube)、`tiktok`(Tiktok)、`tiktok-business`(TikTok)、`tumblr`(Tumblr)、`x`、`devto`、`bluesky`(customFields)、`mastodon`(external)。断言渲染出的 6 个图标：

```
linkedin.png, facebook.png, instagram.png, instagram-standalone.png, youtube.svg, tiktok.png
```

| identifier | 入口 | 断言 |
| --- | --- | --- |
| `youtube` | YouTube | `youtube.svg` 存在 |
| `linkedin` | LinkedIn（个人） | `linkedin.png` 存在，与 `linkedin-page.png` 区分 |
| `tiktok` | 既有 TikTok | `tiktok.png` 存在；`tiktok-business.png` 不存在，页面中 “TikTok/Tiktok” 文本只出现 1 次 |
| `facebook` | Facebook Page | `facebook.png` 存在 |
| `instagram` | Instagram (Facebook Business) | `instagram.png` 存在，文案含 “Facebook Business” |
| `instagram-standalone` | Instagram (Standalone) | `instagram-standalone.png` 存在，文案含 “Standalone” |

- 桌面 modal、`invite=true`、`isMobile`（移动抽屉/onboarding 复用同一组件）三种渲染的图标集合完全一致；`article` 传入 devto/medium 也不产生入口。
- 入口顺序跟随 `GET /integrations` 返回顺序，不额外重排。
- 所有添加入口（`useAddProvider`/`AddProviderButton`/`onboarding.modal`/`new-layout/mobile.integration`/`calendar`）都汇入 `AddProviderComponent`；`PickPlatforms`、`SelectChannels`、`IntegrationListRow` 只渲染已绑定渠道，未过滤，符合“存量渠道继续管理”。
- 保留证据：`socialIntegrationList` 仍含六个 + `linkedin-page` + `tiktok-business` + `tumblr` + 其它；`getAllowedSocialsIntegrations()` 等于全部注册项（`POST /integrations/social-connect` 未被收窄）；`getAllIntegrations()` 仍返回 `linkedin-page`/`tiktok-business`/`tumblr`/`bluesky`/`x`；`.env.example` 中 `HIDDEN_PROVIDERS` 只有注释示例；`show.all.providers.tsx` 仍保留三者。

### 链路证据（逐跳，jsdom + fetch 替身）

1. **iframe 添加**：点击 `youtube` → `window.open('/channel-relay?redirect=<encoded OAuth URL>#auth=…&showorg=…&impersonate=…', '_blank', 'popup,width=600,height=700')`；iframe 自身 `location.href` 不变，添加 modal 关闭。
2. **relay**：把组件刚生成的 relay URL 原样交给 `channel-relay` 页面（清空 sessionStorage 模拟新窗口）→ `auth/showorg/impersonate` 写入 popup sessionStorage，`channel_popup_mode='true'`，随后 `location.href = <OAuth URL>`；缺 `redirect` 或 `auth` 时保持惰性（05 测试）。
3. **callback**：popup 模式 200 → opener 收到 `{type:'CHANNEL_UPDATED', provider:'instagram-standalone'}`，然后 `window.close()`，事件顺序 `['message','close']`，不 `router.push`；用 identifier 而非显示名。
4. **普通窗口**：200 → `push('/launches?added=tiktok&msg=Channel Updated')`，不发消息、不关闭；412 → `push('/launches?precondition=true')`；406 → `push('/launches?msg=<msg>')`；带 `returnURL` 时改为 `push(<returnURL>?<params>)`。
5. **消息不等于成功**：412、406 同样回传并关闭；其它 4xx/5xx 不回传、不关闭、页面显示错误；opener 为 null 或 `closed` 时仍关闭且不抛错；`subscribeToChannelUpdates` 只触发刷新。用真实 `useIntegrationList` + SWR 的组合证明：412 式消息到达而绑定列表未变时页面不新增渠道；列表返回新绑定后才显示 `instagram-standalone`。
6. **弹窗被阻止**：`window.open` 返回 null 时不重试、不导航、modal 照旧关闭（记录基线）。
7. **402**：普通窗口与 iframe 均在 `response.json()` 之前返回；源码契约测试断言 add 对话框 4 个连接请求（普通 OAuth、Web3、扩展、账号/密钥）的 402 判断都排在 `response.json()` 之前，且都不打开授权页。
8. **用户时区**：`localStorage.timezoneName='Asia/Tokyo'` 时 connect POST body `timezone` 为 `'540'`（不是浏览器偏移），`code`/`state` 原样转发。
9. **上游保留**：Web3 `encodeURIComponent(code)`、`typeof chrome === 'undefined'` 守卫、`chrome.runtime.lastError` 处理、`tiktok-business` 的 `auth_code` 转换、`tumblr`/`tiktok-business`/`linkedin-page` 显示名映射均仍在。
10. **多步不提前通知**：`inBetweenSteps` 的 YouTube 响应只渲染 “Configure Your Channel”，不发消息、不关闭（保存细节归 08）。

### 命令与结果

| 命令 | 结果 |
| --- | --- |
| `git log -1` | 起点 `c69bbb0c`（集成 tip）；`git merge codex/postiz-stable-merge` 完成后仍为 up-to-date（集成分支未移动） |
| `pnpm install --frozen-lockfile` | 成功（Node 22.23.4 / pnpm 10.6.1 / Prisma 6.5.0） |
| `pnpm run typecheck` | 通过（frontend `next typegen` + tsc，backend，orchestrator） |
| `pnpm run lint` | 0 errors，713 warnings |
| `pnpm run test` | 38 files / 333 tests 通过（本票新增 8 files / 49 tests；此前 30 files / 284 tests）；连续两次运行均通过 |
| `pnpm run build` | 通过（Next 前端、Nest backend、orchestrator） |
| `./k8s/prepare-build-context.sh --allow-dirty` → `--check` | 生成 968 个文件；`--check` 显示 in sync |

### 未证明 / 边界

- **真实平台 OAuth 未验证**：LinkedIn 个人、既有 TikTok、Instagram (Standalone) 均以 fetch/消息替身验证，未取得真实同意页、重定向、拒绝/取消返回；无平台 App 凭据与真实 iframe 父页 origin，无法证明跨站 cookie/popup 策略。
- **真实内部 API/数据库绑定未验证**：本工作树未启动 backend/Postgres，绑定与刷新仅经前端替身；容器级验证留给 13/18。
- **取消语义**：未假设取消对应单一状态码；替身只覆盖“错误响应不回传”的基线。
- **重复操作、遗留 `channel_popup_mode` flag、关闭失败**：无专门处理，保持基线；未新增清理/重试/回退页。
- **relay 缺参数**：沿用 05 的惰性行为；缺失的 `impersonate` 仍可能保留弹窗内旧值（05 记录的基线，本票未改会话契约）。
- **安全边界未变**：`targetOrigin='*'`、接收端只校验 `type`、relay 不校验 `redirect`。本次仅做静态/替身验证，不构成安全性结论。
- 分析页 `platform-analytics/render.analytics.tsx` 的重连仍为“当前窗口 + 无账号/密钥表单”，与主列表不同；属 09 范围，未改动。

### 交接

- **08**：继续复用 `navigateOrShow`（popup 内仅消息+关闭）与 `isChannelPopup()`；二步保存成功前不得回传。`continueProviderList` 现有 `instagram`/`facebook`/`youtube`/`linkedin-page`/`gmb`/`tumblr`，选择 UI 在 `ContinueIntegration` 内联渲染。
- **09**：重连保持当前窗口（`launches.component.refreshChannel`、`render.analytics.tsx`），账号/密钥分支依赖后端 `isCustomFields`/`customFields`；不要把重连改走 popup，也不要因六入口过滤影响存量非白名单渠道。
