# 05: 从仪表盘完成六种渠道的绑定与重连

**What to build:** 商户可以从仪表盘选择开放的六种渠道，在 iframe 弹窗或独立窗口完成授权、必要的账号选择和重连，随后在原组织看到正确的绑定。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [已确认的渠道入口与回调](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [x] 枚举所有仪表盘添加列表，核对精确标识为 `youtube`、`linkedin`、`tiktok`、`facebook`、`instagram` 和 `instagram-standalone`。已有其他渠道仍可管理。
- [x] 六种渠道分别在禁用第三方 Cookie 的 iframe 与独立窗口运行。核对弹窗 relay 传递当前会话、独立窗口当前页导航，以及返回后的组织和渠道 ID。
- [x] YouTube、Facebook Page、Instagram（Facebook Business）完成单选并保存后，才通知原窗口刷新和关闭弹窗。其余渠道核对单步回调的实际绑定。
- [x] 覆盖拒绝、取消、弹窗异常和二步保存失败。把授权结果和刷新后的渠道记录对照，记录能否重试。核对普通 OAuth 和既有扩展渠道各自的重连入口。

## Answer

2026-11-20 合入集成分支。六种渠道在禁用第三方 Cookie 的 iframe 中完成本地端到端验收，独立窗口以 LinkedIn 验证共用导航分支；真实平台授权、扩展 Cookie 刷新与 Safari 跨站行为仍未证明。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-05-dashboard-channel-binding` |
| 功能提交 | `8224badeaa84a249d2fe3290f6523e055fd9ca27`（`feat(channels): bind dashboard channels across frames`） |
| 实现分支 HEAD | `cc57bf2a3f18c205a95a7292c984abd260614655`（含向集成 `1f0a1b42b` 的前向合并） |
| 集成合并提交 | `0288174a07de7362270ef9638ce3c50990943ac2`，父提交 `6d335281a`（集成分支）与 `cc57bf2a3`（实现分支） |
| 合并冲突 | 无；`ort` 自动合并，10 个文件 +298/−47（含同时改过的 `channel-multistep-selection.test.tsx`，两侧用例均在） |
| 端到端证据 | `_reports/ticket-05-e2e.json`（run `793327`）及 `_reports/assets/ticket-05/` 截图 |
| 运行时 | 前端 :4305、后端 :3105、PostgreSQL、Temporal；Playwright 系统 Chrome，`TrackingProtection3pcd` |

### 六渠道白名单

`allowed.channels.ts` 的精确标识仍为 `youtube`、`linkedin`、`tiktok`、`facebook`、`instagram`、`instagram-standalone`（顺序即代码顺序）。iframe 内 `document.cookie === ''` 时，添加弹窗实际渲染 6 个图标：`linkedin.png`、`instagram.png`、`instagram-standalone.png`、`facebook.png`、`youtube.svg`、`tiktok.png`，`count: 6`、`exact: true`；Tumblr、LinkedIn Page、TikTok Business、Bluesky 名称均不出现。桌面、移动、邀请与 onboarding 变体由同一白名单与结构测试覆盖。

已有非六渠道仍可管理：种子渠道 `int_t05_x` / `Existing X channel` 留在渠道列表；Tumblr、Bluesky 的 provider API 仍返回授权 URL；X 因本地无 `X_CLIENT_ID` 返回 HTTP 200 `{"err":true}`，但既有绑定可继续管理。`x`、`tumblr`、`bluesky` 不进入添加弹窗。

### iframe relay 与弹窗异常

- 添加与重连共用 `openChannelOAuth`。iframe 内打开 `/channel-relay?redirect=…oauth…`，URL hash 携带本标签页的 `auth` / `showorg` / `impersonate`；弹窗 relay 将其写入自己的 sessionStorage（证据：`auth: true`、`showorg: org_t05_demo`、`channel_popup_mode: true`），回调 POST 的 `auth`/`showorg` 头来自弹窗会话而非 opener，7 次 relay 请求均如此。
- **重连修复**：普通 OAuth 重连此前固定 `window.location.href`，会把父 iframe 导航到 provider 而无法完成；现走同一 helper。点击 `refreshNeeded` 的 LinkedIn 行发出 `GET /integrations/social/linkedin?refresh=li-1002`（带本标签页会话），relay 弹窗完成回调后行改名为 `Reconnected LinkedIn`、清除 `refreshNeeded`、刷新列表，且不新增绑定。
- **失败弹窗不再跳转**：`continue.integration.tsx` 仅在 `!isChannelPopup()` 时渲染 `/launches` 的 3 秒重定向，弹窗内失败停在错误页。
- **取消/错误文案保留**：400 响应体只读取一次并保留给错误分支，`access_denied` / `invalid_grant` 显示平台原因而非通用 “Could not add provider”；失败时不发 `CHANNEL_UPDATED`、不关闭弹窗。
- 弹窗被拦截（`window.open` 返回 null）时 iframe 不导航、不重试，`channel-add-flow` 用例覆盖。

### 多步成功、失败与重试

| 事件 | 结果 |
| --- | --- |
| YouTube 多步 | 选择器列出 `First channel` / `Second channel`；Save 体 `{state, code, id:"channel-2"}`；保存一次后通知并关闭，opener 刷新出 `Runtime YouTube` |
| Facebook 保存失败 | 第 1 次 Save 返回 500 `Channel has no permission`；弹窗停在选择器，无通知、无新行；第 2 次 Save 成功（共 2 次保存），出现 `Runtime Facebook Page` |
| Instagram 多步 | Save 体 `{state, code, id:"ig-2", pageId:"page-2"}`；一次保存后通知、关闭、刷新 |
| 平台取消 | 回调 `error=access_denied`；弹窗留在回调 URL 显示原因，无消息、无新行、无 `/launches` 跳转 |
| 取消后重试 | 重新发起 TikTok 添加，单步回调绑定 `Runtime TikTok` 并刷新 opener |
| 单步渠道 | LinkedIn、TikTok、Instagram Standalone 无选择器、无 save 请求，回调后通知一次 |

### 独立窗口

独立窗口中 `openChannelOAuth` 走 `embedded: false`，当前页导航而非开弹窗。LinkedIn 添加实测 `newPopup: false`：同窗到本地 OAuth double，再到 `/integrations/social/linkedin?state=…&code=…`，最终 `/launches?added=linkedin&msg=Channel%20Updated`，新绑定可见。重连与添加使用同一分支，独立窗口保持原导航语义。

### Playwright 证据

`_reports/ticket-05-e2e.json`（run `793327`，org `org_t05_demo`）记录：添加列表 `count: 6 / exact: true`、第三方 Cookie 为空；7 条 relay、8 条 OAuth double、8 条回调、4 次保存（YouTube 1、Facebook 2、Instagram 1）；Facebook 失败重试、TikTok 取消后重试、LinkedIn 独立窗口、iframe 重连均有断言。截图：`ticket-05-add-list.png`、`ticket-05-youtube-bound.png`、`ticket-05-standalone-linkedin.png`、`ticket-05-cancel.png`、`ticket-05-facebook-save-error.png`、`ticket-05-extension-notice.png`。

### 命令与计数

```
pnpm typecheck                    # exit 0（frontend next typegen + backend + orchestrator）
NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000
                                  # 62 files, 661 passed, 0 failed
```

合并前集成 HEAD 为 62 文件 / 653 用例；本票净增 8 个用例，分布在 6 个测试文件（添加列表与添加流程、弹窗契约、多步取消/错误、凭据与上游保留守卫），合并后 62 / 661。合并后又单独跑过一次 typecheck 与全量测试，均为 exit 0；无跳过、删除或弱化既有用例。

### 未证明

- **真实平台 OAuth**：六渠道均使用本地 OAuth double（`127.0.0.1:4505`）与双份 `/integrations/social-connect` / save 响应；真实同意页、令牌交换与真实账号/页面列表未跑。二步绑定本身由真实 `saveProviderPage` 套件覆盖（`channel-multistep-binding`，11 用例）。
- **扩展渠道 Cookie 刷新**：自动化浏览器未装扩展，`skool` 重连只验证到 “Extension Not Found”；`PING`/`GET_COOKIES`/`refresh` 参数契约由 hook 测试覆盖，真实 Cookie 提取未跑。
- **Safari 与真实父应用**：仅 Chromium + `TrackingProtection3pcd`；iframe 无 Cookie、依赖 sessionStorage 是本地记录条件，真实父应用嵌入与 Safari 跨站行为未验证。
- 本票未推送、未部署；X 的授权 URL 因本地缺 `X_CLIENT_ID` 未能生成。
