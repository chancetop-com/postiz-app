# 能力门控与 API 降级语义

Type: grilling
Status: resolved
Blocked by: 02, 03, 04, 05

## Question

定下跨 provider 的统一行为：

1. 前端：渠道或媒体类型不支持时，隐藏还是禁用？是否附一行原因？
2. 后端：API 调用方传入不支持的字段（Standalone 带 location、Story 带 location、TikTok 图片带 location 等），静默剥离、忽略、还是返回校验错误？
3. 与 handoff 第 5 节第 7 条「UI 不能静默丢弃」如何统一：UI 保证不显示，API 是否也要可发现？
4. 这些校验放 `checkValidity` 还是 provider 构造 payload 时处理？
5. 输出一份 provider × 媒体类型的最终支持矩阵，作为实现者的唯一事实来源。

## Answer

**定案（2026-11-23）：把 handoff §5.7 收窄为「可见 ⇒ 一定发送」。不适用组合一律隐藏控件、保留已选值、provider 在构造 payload 时省略；不新增 400，也不新增 warnings 通道。TikTok Business UPLOAD 的 Location 从“显示但丢弃”修正为隐藏。**

### 1. 前端：隐藏，不禁用，不加提示

- 不适用场景沿用现有 `invisible h-0 overflow-hidden`：控件保持挂载、`register()` 保留值，只是不可见；切回可用模式后原值和控件恢复。
- **不**改为 `disabled`，**不**附 “not supported” 之类的原因行。理由：与 TikTok Business UPLOAD 现有范式一致；隐藏控件不计入“静默丢弃”，因为用户从未看到它。
- 这是对 handoff §5.7 的**规则收窄**，不是例外：规则只约束可见控件。`05` 里 IG Story 的 AI、TikTok 视频 UPLOAD 的 AI 已按此隐藏；`04` 里 IG Story 的 Location 同理。
- 本轮额外修正一处现状偏差：**TikTok Business 的 Location 在 `content_posting_method=UPLOAD` 下也要隐藏**（现在控件可见，但 provider 把它放在 `post_info` 的非 draft 分支里，实际被丢弃）。
- 隐藏判定只看“该 provider + 媒体类型 + 模式”是否支持，不做能力探测；搜索失败仍统一显示 `No location found`（04 已定）。

### 2. 后端：省略、不报错

- API 调用方传入不支持组合（Standalone 带 location、Story 带 location、TikTok legacy 带 location、TikTok 视频 UPLOAD 带 AI、TikTok Business UPLOAD 带 AI/location 等）时，provider **直接不把字段写进 payload**，请求继续成功。
- DTO 继续接收这些字段（`ValidationPipe` 未开 `whitelist`，未知字段本来也不会 400）。不新增 `checkValidity()` 拒绝规则。
- 可发现性放在文档层：DTO 的 `@JSONSchema` 描述 + provider 的 `@Rules` 写明“该组合会被忽略”，不新增响应 warnings。
- 理由：这些是可选增强，不应让整条发布失败；且 UI 隐藏后仍保留值，若 `checkValidity()` 报错，“选了地点后切 Story”会直接无法保存，与 04 的门控冲突。

### 3. 能力判断的位置

- **payload 构造处是唯一执行关口**：provider 在拼请求体时用 `isStory` / `isVideo` / UPLOAD / identifier 判断是否带上字段。定时任务执行时不走 `checkValidity()`，draft 也可能绕过校验，只有 payload 构造每次都会执行。
- UI 的隐藏是体验层，不承担安全职责；**不**抽跨前后端共享能力助手（前端拿不到 provider 实例，规则天然分两处）。
- `checkValidity()` 保持只做结构性校验（媒体数量、尺寸、Story 不能配 audio 等），不新增 AI / location 规则。

### 4. 错误映射

- `instagram.provider.ts` 的 `handleErrors()` 新增一条已知字符串映射：
  - `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` → `bad-body`，提示“所选 Page 没有有效地点数据，请重新选择”，**不重试**。
- 这是按 TikTok Business「已知错误码 → 可读 `bad-body`」的现有范式补缺；不扩展 `#100` / `#200` 等共享错误码，避免误伤其他场景。
- 搜索侧错误语义不变：`refresh-token` 抛 `RefreshToken`，其余返回 `[]`，UI 显示 `No location found`（04）。

### 5. 最终支持矩阵（实现者唯一事实来源）

| Provider | 媒体 / 模式 | AI 披露 | Location |
|---|---|---|---|
| Instagram（FB Login） | 单图 | 显示；容器 `is_ai_generated=true` | 显示；容器 `location_id` |
| Instagram（FB Login） | 单视频 / Reel | 显示；同上 | 显示；同上 |
| Instagram（FB Login） | Carousel | 显示；仅父容器 | 显示；仅父容器 |
| Instagram（FB Login） | Story | 隐藏；不发 | 隐藏；不发 |
| Instagram（Standalone） | 单图 / 视频 / Reel / Carousel | 显示；发送 | 隐藏；不发 |
| Instagram（Standalone） | Story | 隐藏；不发 | 隐藏；不发 |
| TikTok legacy | 视频 DIRECT | 显示；`post_info.is_aigc=true` | 无字段；隐藏 |
| TikTok legacy | 视频 UPLOAD | 隐藏；不发 | 隐藏 |
| TikTok legacy | 图片 DIRECT / MEDIA_UPLOAD | 显示；顶层 `is_aigc=true` | 隐藏 |
| TikTok Business | 视频 DIRECT | 显示；`post_info.is_ai_generated=true` | 显示；`location_id` + `location_name` |
| TikTok Business | 视频 UPLOAD | 隐藏；不发 | 隐藏；不发（修正现状） |
| TikTok Business | 图片 DIRECT | 显示；顶层 `is_ai_generated=true` | 显示；`location_id` + `location_name` |
| TikTok Business | 图片 UPLOAD / draft | 显示；顶层 `is_ai_generated=true`（🧪 实测项） | 隐藏；不发（`is_draft` 忽略 `post_info`） |

统一取值：仅 `true` 时发送；`false` / 未设置一律省略（05）。Carousel 子项既不发 AI 也不发 location（02）。IG Story 的 AI 先隐藏，待 03 的实测结论再决定是否单开票放开。

### 6. 验收 / 实测清单

**依赖真实账号的实测不阻塞 coding。** 已单独立项为 [真账号发布验证](07-real-account-verification.md)：实现先按本票矩阵落地，用可离线验证的路径（payload 断言、UI 显隐、DTO 校验）验收；真账号结果若推翻矩阵，再按 fallback 改行为并回写本票。缺账号只在 07 记录缺口，不拖住实现。

当前（2026-11-23）缺 **Instagram（FB Login）** 与 **TikTok Business** 的真实账号；对应矩阵格子在 07 标记为等待账号，coding 仍按本票矩阵推进。

1. IG 单图同时带 `location_id` + `is_ai_generated`，两个字段都生效。
2. IG Carousel 两个字段只出现在父容器；子项不带，也不报错。
3. IG Story：两个控件隐藏；即使 settings 里保留值，payload 也不带。
4. IG Standalone：AI 生效；Location 控件全程不出现，payload 不带。
5. TikTok legacy 视频 UPLOAD：AI 控件隐藏，payload 无 `post_info`；图片 UPLOAD：顶层 `is_aigc` 是否生效（🧪 失败则隐藏控件并改矩阵）。
6. TikTok Business 视频 UPLOAD：AI + Location 都隐藏，payload 的 `post_info` 只有 `upload_to_draft`；图片 UPLOAD：顶层 `is_ai_generated` 是否生效（🧪 失败则隐藏控件并改矩阵），`post_info` 只有 `is_draft` + title/caption。
7. 用一个没有 location 数据的 Page ID 建 IG 容器：报 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`，前端显示可读 `bad-body`，不重试。
8. UI 回归：选了 Location / 勾了 AI 后切到不适用模式再切回，值仍在且控件恢复。

### 7. 实现落点（供实现者）

- 前端：`instagram.collaborators.tsx`（AI + Location 控件与 Story 隐藏）、`tiktok.provider.tsx`（AI 控件按媒体/UPLOAD 隐藏；Business Location 在 UPLOAD 隐藏）。
- 后端：`instagram.provider.ts` / `instagram.standalone.provider.ts`（AI + location + Story guard + `handleErrors`）、`tiktok.provider.ts`（`post_info.is_aigc` / 顶层 `is_aigc`）、`tiktok.business.provider.ts`（`post_info.is_ai_generated` / 顶层 `is_ai_generated`，并确保 UPLOAD 不带 location）。
- DTO：按 05 统一 `is_ai_generated`，删除 `video_made_with_ai`；Instagram 增加 `location`；同步 `@JSONSchema` 的“何时被忽略”描述。
- `@Rules`：TikTok 两个 provider 改为说明 `is_ai_generated` 对图片/视频的路径与 UPLOAD 隐藏语义；Instagram 补 location 的 Story / Standalone 忽略说明。
