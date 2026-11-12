# 08: 完成 YouTube 与 Meta 的多步单选授权

**What to build:** 商户在 YouTube、Facebook Page 和 Instagram Business 授权后选择一个账号或页面并保存；绑定完成后原页面刷新，弹窗按既定顺序关闭，中途失败不会被误报为连接成功。

**Blocked by:** 07 — [六渠道入口与直接 OAuth 回调可用](07-channel-oauth-direct.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的多步选择与授权结果契约；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] youtube、facebook、instagram 分别完成添加入口、会话 relay、外部授权、候选列表、单选保存、绑定写入及原页面刷新；普通窗口仍沿用当前窗口流程。
- [x] 需要中间选择时保留单选与显式保存，不扩展为批量绑定，不在完成保存前通知关闭；用户选定的账号或页面与最终 Integration 归属一致。
- [x] 覆盖零个、一个、多个可选项及已有绑定；以平台替身返回的明确身份与实际数据库结果证明选择生效，不能只断言候选列表渲染。
- [x] 覆盖初始回调成功、二步保存成功/失败、412、406、402 和其它错误，保留 CHANNEL_UPDATED 的字段与触发顺序；刷新通知不当作绑定成功。
- [x] 拒绝授权、中途取消、选择后失败、重复提交、opener 丢失和关闭失败均按基线与完整流程核对，不自行新增恢复页、自动重试或清理协议。
- [x] 验证 iframe 弹窗内 auth/showorg/impersonate 在候选查询和保存时仍属于原商户及组织，另一标签页或组织不会被错误刷新或写入。
- [x] 为三个 provider 分别保留从页面到真实内部 API/数据写入的证据；真实账号权限、同意页和平台回调未测时明确列为外部缺口，不让本地替身结果代替。

## Answer

2026-11-12 于 `codex/ticket-08-channel-selection`（起点 `f0e11bd0`，完成后合并 `codex/postiz-stable-merge`，该分支当时仍为 `f0e11bd0`，无冲突）完成。本票**只修一处真实缺陷**，其余是给既有二步单选流程补可执行回归：07 合入后回调与会话链路已可用，但二步保存失败时错误被选择器遮住，商户既看不到失败也看不到弹窗关闭，属于静默失败。

### 实际改动的文件

- `apps/frontend/src/components/launches/continue.integration.tsx`（唯一生产代码改动）：
  - 新增 `twoStepError`，二步保存的非 2xx 响应把平台 `message` 留在选择步骤内（`role="alert"`），不再写入被 `twoStepState && Provider` 渲染顺序遮蔽的全局 `error`。选择仍保留，可重选后再次保存。
  - 保存请求本身抛错（网络中断）按同一种“未写入”结果处理，展示通用错误而不是 unhandled rejection；按钮在 `finally` 中恢复可用。
  - 成功路径不变：仍只经 `channel.popup.ts` 的 `navigateOrShow`（`notifyChannelPopupOpener` + `window.close`）通知，且 catch 只包住请求本身，**成功后的关闭/跳转异常不会落进“保存失败”分支**，避免把已写入的绑定误报为失败。
  - 未新增页面、重试、清理协议、批量绑定，也未改动 `allowed.channels.ts`、`channel.popup.ts`、relay 或 `launches.component.tsx` 的接收端。
- `k8s/apps/frontend/src/components/launches/continue.integration.tsx`：由 `./k8s/prepare-build-context.sh --allow-dirty` 重新生成（969 个生成文件），未手改。
- 新增 `tests/channel-multistep-selection.test.tsx`（17 用例）、`tests/channel-multistep-binding.test.ts`（11 用例），共 28 个新用例。其余渠道用例未删除、未跳过、未放宽。

### 验证方式与结果

| 场景 | 入口 | 断言 |
| --- | --- | --- |
| 零个候选 | 真实 `ContinueIntegration` + 真实 `withContinueProvider`，仅替身 `fetch` | 显示 provider 空态文案；无 Save；不发保存请求；无 CHANNEL_UPDATED、不关闭、不跳转 |
| 一个候选 | 同上 | 仍显示选择器并**必须显式 Save**；保存前无消息、无关闭；保存体只含该账号 |
| 多个候选 | 同上 | 选中项决定保存体：youtube `{id}`、facebook `{page}`、instagram `{id,pageId}`；选中第二个不会被第一个替代 |
| 未保存 | 同上（popup 模式） | 选中后 `window.opener.postMessage`、`window.close`、`router.push` 均未发生 |
| 保存成功（popup） | 同上 | 恰好一次 `{type:'CHANNEL_UPDATED', provider}`（`*`），随后关闭，顺序 message→close，不 push |
| 保存失败 500 / 412 | 同上 | 平台 `message` 可见，popup 保持打开、选择仍在，无消息、无关闭、不跳转 |
| 请求抛错 | 同上 | 通用错误可见，无消息、无关闭（`isSaving` 恢复，无 unhandled rejection） |
| 重复提交 | 同上 | 连续两次点击 Save 只发一次保存请求、只回传一次 |
| opener 丢失 | 同上 | 仍关闭且不伪造消息，不出现“保存失败”文案 |
| popup 会话归属 | 同上（popup session 有 `auth/showorg/impersonate`） | 保存 POST 头正是 `auth: jwt-popup`、`showorg: org-42`、`impersonate: user-7`（共享 `customFetch` 从 popup sessionStorage 取值） |
| 普通窗口二步保存 | 同上（非 popup） | 保存成功后 `push('/launches?added=facebook&msg=Channel Added')`；无 postMessage、无 close |
| 单步 Provider | `instagram-standalone` 回调 200 | 不出现选择器与 Save，直接走回传并关闭 |
| 初始回调 402 | 同上 | 停在错误视图，不出现选择器、不通知、不关闭 |
| YouTube 绑定 | 真实 `YoutubeProvider.fetchPageInformation`（`googleapis` 为平台替身）+ 真实 `IntegrationService`/`IntegrationRepository`，Prisma model 为内存替身 | 用回调 token 调 `channels.list({id:[选中 id]})`；行变为 `internalId/name/profile/picture` = 选中频道、`token` = OAuth token、`inBetweenSteps=false` |
| Facebook 绑定 | 真实 `FacebookProvider.fetchPageInformation`（仅替身 `fetch` 到 Graph）+ 真实 service/repository | `/me/accounts` 用用户 token 列出两页；选中页决定行 `internalId/name/profile/picture`，`token` 为该页 `access_token` |
| Instagram 绑定 | 真实 `InstagramProvider.fetchPageInformation`（仅替身 Graph HTTP） | 请求 `/page-2` 与 `/ig-2`；行 `internalId/name/profile/picture` 为 IG 账号，`token = page-2-token___user-token`（选中页的页 token + 用户 token） |
| 已有绑定 | 同上（预置另一页/同一页/另一组织） | 绑定不同页时既有页不变（token、`deletedAt` 保持）；重复绑同一页复用原行 id 且只留一条有效记录；另一组织行完全不变 |
| 拒绝路径 | 真实 service/repository | 跨组织 id → `HttpException` 且不调平台、`inBetweenSteps` 仍为 true；已绑定 → `Invalid request`；未知 id → `Integration not found`；无 `fetchPageInformation` 的 provider → `Provider does not support page selection`；平台报“无页面权限” → 错误抛出且行不变 |
| 回调 412/406、初始成功、`CHANNEL_UPDATED` 字段与顺序 | 07 既有 `tests/channel-connect-callback.test.tsx`、`tests/channel-popup-contract.test.tsx` 等 8 个 suite | 未改动、全部通过；单候选的“不提前通知”仍由 07 用例钉住 |

命令与结果（Node 22.23.4，pnpm 10.6.1，Prisma 6.5.0；全部在 `~/Desktop/Web/postiz-worktrees/08` 执行）：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run typecheck` | 通过（frontend typegen + tsc、backend、orchestrator） |
| `pnpm run lint` | 通过：0 errors / 713 warnings（无新增错误） |
| `pnpm run test`（改动前后各两次） | 改动前 368 passed / 44 files；改动后连续两次 396 passed / 46 files |
| `pnpm exec vitest run tests/channel-multistep-*` | 28 passed |
| `pnpm run build` | 通过（frontend/backend/orchestrator） |
| `./k8s/prepare-build-context.sh --check` | `build context is in sync with f0e11bd0` |

### 明确未改动的边界与解释

- **单候选不自动保存**：`instagram-standalone` 等单步 Provider 回调即完成绑定、不出现选择器（已测）。二步 Provider 即使只返回一个候选，仍保留选择 + 显式 Save：决策 04 要求“保留现有中间选择页、单选及保存流程”，且 07 的 `channel-connect-callback` 用例以单候选钉住“保存前不得通知”。因此“单账号直接保存”只适用于无需中间选择的 Provider；若要求单候选自动写入，需要连该用例一起改，属产品决定，未自行改动。
- **错误只在选择步骤内呈现**：按决策 04 “不自行新增恢复页/自动重试”，失败后停留在原选择器（基线行为）并补上被遮蔽的错误文案，不新增回退页、自动重试、flag 清理或新的通知协议。
- **opener/关闭异常**：opener 丢失仍按基线关闭且不发消息；`window.close()` 抛错与弹窗被拦截按基线不加处理，成功后的这类异常也不会被误报成保存失败。未新增处理策略。
- **既有 targetOrigin=`*`、接收端只校验 type、relay redirect 不校验** 保持原样，本票不作为安全结论。

### 未验证（外部缺口）

- 真实 YouTube / Facebook / Instagram 同意页、真实账号权限（YouTube 频道权限、Business Manager 页角色、IG 商业账号绑定）、真实平台回调与拒绝/取消状态：平台调用全部为本地替身，未使用真实账号或真实平台应用配置。
- 真实父应用 iframe、真实 origin、浏览器弹窗拦截、真实 popup 被关闭/`close` 失败：本票只在 jsdom 中驱动真实组件与真实 header 逻辑，未在真实浏览器与真实父页验证。
- 单候选自动保存的产品取舍（见上）尚无用户答复。

### 交接给 09 与 15

- 09（存量渠道刷新/重连）：`continue.integration.tsx` 现在只在选择步骤内新增 `twoStepError`，`refresh` 参数与 `navigateOrShow` 语义未变；重连仍走当前窗口，不经过选择器。`IntegrationService.saveProviderPage` 的写入语义（复用既有行、软删旧行、保留 rootInternalId/refreshToken）已被本票用例固定，重连改动需保持这些断言。
- 15（旧排程接续）：绑定写入的 `internalId` 现在有逐 provider 证据（YouTube 频道 id、Facebook 页 id、Instagram 账号 id + 页 token）。若后续改动涉及 `Integration.internalId`/`rootInternalId` 的更新，可直接复用 `tests/channel-multistep-binding.test.ts` 的内存 Prisma model 作为回归入口。
