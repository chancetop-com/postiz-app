# 真账号发布验证（IG / TikTok）

Type: task
Status: open
Blocked by: —

## Question

在真实账号上验证 06 矩阵中无法离线确认的格子。

**本票不阻塞 coding。** 实现先按 06 的矩阵落地，用可离线验证的路径（payload 断言、UI 显隐、DTO 校验）验收；本票只负责真实平台行为。若实测推翻矩阵，按 06 的 fallback 改行为并回写矩阵，不要回头阻塞实现。

### 账号现状（2026-11-23）

- ⛔ **缺 Instagram（FB Login）**：T1–T8、T11 等待账号。
- ⛔ **缺 TikTok Business**：T10 以及 Business UPLOAD/draft 的 Location 行为等待账号。
- ✅ 可先做：`T9`（TikTok legacy 图片 MEDIA_UPLOAD）；若手上有 Instagram Standalone，可顺带验证 AI 路径（它没有 Location）。
- 缺账号不阻塞 coding；实现按 06 矩阵推进，账号到位后补测。

### 需要的账号 / 环境

- Instagram（Facebook Login）+ 至少一个带 location 数据的 Facebook Page；最好再有一个**非本人管理**的 Page，用于验证 Pages Search 权限。
- Instagram（Standalone）。
- TikTok legacy：一个可 DIRECT_POST 的测试账号，以及一个只能走 UPLOAD 的场景。
- TikTok Business：DIRECT 与 UPLOAD / draft 各一。
- 如果缺少账号：在本票 `## Comments` 记录缺口即可，不阻塞实现；拿到账号后补测。

### 验证项

| # | 验证 | 方法 | 失败时 |
|---|---|---|---|
| T1 | IG 单图 `location_id` | 建容器 → publish → 客户端确认 location | 检查 Page 是否有 location 数据 |
| T2 | IG Carousel 父容器 `location_id` | 父容器带 `location_id` + children → publish | 退化为“多图帖不提供 Location”，绝不下放子项 |
| T3 | IG 单图 `location_id` + `is_ai_generated=true` 同请求 | 建容器 → publish | 重新评估；容器只能建一次 |
| T4 | IG Carousel 父容器同时带两字段 | 同上 | AI 优先，Location 退化 |
| T5 | IG Story `location_id` | 建 Story 容器带参数 | 若意外成功，再单开票决定是否放开 |
| T6 | IG Carousel 子项 `location_id` | 子容器带参数 | 无论如何都不发 |
| T7 | IG Story `is_ai_generated=true` | 建 Story 容器，不发布，看返回 id 还是 error | 继续隐藏 AI 开关 |
| T8 | IG Reel / 单视频 `is_ai_generated=true` | 建 `media_type=REELS` 容器 | 若报错则退回省略 |
| T9 | TikTok legacy 图片 MEDIA_UPLOAD 的顶层 `is_aigc` | 上传草稿 → App 内完成发布 → 看 AI 标签 | 隐藏图片 UPLOAD 的 AI 开关 |
| T10 | TikTok Business 图片 draft 的顶层 `is_ai_generated` | 同上 | 隐藏图片 UPLOAD/draft 的 AI 开关 |
| T11 | IG 无地点数据的 Page 建容器 | 用无 location 的 Page ID 建容器 | 确认 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` 的完整响应与可读提示 |

### 产出

- 每条记录：账号类型、请求（脱敏）、响应（脱敏）、客户端截图/结果。
- 失败的项：在 `## Answer` 写明实际行为 + 对 06 矩阵的影响；必要时更新 06 的矩阵与实现落点。
- 不改生产代码；需要改代码的结论回到 06 的 fallback 流程。

## Comments

- 2026-11-23：当前缺 Instagram（FB Login）与 TikTok Business 真实账号。IG 的 T1–T8/T11 与 Business 的 T10 等待账号；先做 TikTok legacy 的 T9（若账号可用）。此缺口不阻塞实现。
- 2026-11-23（ticket 13）：实现与发布前验证（全量测试、typecheck、lint、离线矩阵审计）已完成，但没有真实账号，T1–T8、T10、T11 仍未验证。它们需要真实的 Instagram（Facebook Login，且至少一个带 location 数据的 Facebook Page）和 TikTok Business 账号；T9 仍需要可用的 TikTok legacy 账号。本票继续保持 open，待账号到位后按上表补测；若实测推翻矩阵，按 06 的 fallback 回写矩阵与实现。
