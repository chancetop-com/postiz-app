# Instagram/TikTok 发布选项（AI 披露 + Location）决策图

Labels: wayfinder:map
Status: resolved
Created: 2026-11-23
Resolved: 2026-11-23

## Destination

确定 Instagram（Facebook Business / Standalone）与 TikTok（legacy / Business）发布时 AI 披露与 Location 的最终契约：字段位置、媒体类型支持范围、前端门控、API 降级行为。实现者拿到这张图后，不再需要查平台文档或再做产品取舍即可落地。

## Notes

- 本轮只产出决策，不改生产代码，也不另写 spec。地图的 Decisions so far 就是任务文本。
- 范围只含 AI 披露 + Location。hashtag 校验（≤30 个 / ≤2200 字符）和 Instagram Standalone collaborators 复核明确不在本轮。
- 用户 2026-11-23 更正的能力输入：TikTok 与 TikTok Business 的视频和图片都支持 AI 标识；Instagram (Facebook Business) 与 Instagram (Standalone) 都支持 AI；Instagram (Facebook Business) 支持 Location。
- 用户已确认的 Instagram (Facebook Business) Location 覆盖：单图 ✅、单视频/Reel ✅、Carousel 父容器 ✅（02 定案）；Story 文档未明确（倾向不支持）；Standalone ❌。
- 当前代码事实：Instagram 两个 provider 均无 `is_ai_generated` 与 `location`；TikTok 图片缺 `is_aigc`（`buildTikokPostInfoBody` / `buildTikokSourceInfoBody`）；TikTok Business 图片缺顶层 `is_ai_generated`，其 `location_id` + `location_name` 已在视频/图片实现，前端 `tiktok.location.tsx` 可复用。
- 仓库事实：设置组件可通过 `useIntegration().value[0].image` 读取媒体数组，按图片/视频/数量门控不需要新管道。
- 上一轮的完整调研、字段行号与官方链接见 handoff；本图只补齐这次提出的增量与未决项。
- 02 留了一份 T1–T6 实测清单（Carousel 父容器、Story、Location+AI 组合等），实施阶段应按清单验收；见 `research/02-instagram-location-media-matrix.md`。
- 06 已收口：不适用场景一律 `invisible h-0 overflow-hidden`（隐藏、保留值、不发送），不加提示也不禁用；handoff「UI 不能静默丢弃」收窄为「可见控件 ⇒ 一定发送」。
- 实施规格已出：[spec.md](spec.md)（Status: ready-for-agent）；矩阵与门控语义以规格和 06 为准。
- 真实账号现状（2026-11-23）：缺 Instagram（FB Login）与 TikTok Business。对应实测在 [真账号发布验证](issues/07-real-account-verification.md) 标记为等待账号，**不阻塞 coding**。
- 平台事实（2026-11-23 核实）：TikTok Business 的 `location_id` 来自 TikTok **全局地点标签库**（`/business/publish/location/?business_id=&search_query=`，单次最多 20 条，`location_name` 必填），不是企业自有地点；Instagram 的 `location_id` 是带地点数据的 **Facebook Page**，Pages Search 返回 Page 而非 place，覆盖与原生 picker 不完全一致。
- 按 [Wayfinding operations](../../docs/agents/issue-tracker.md) 管理。调研票可并行；grilling 票一次只解决一张。

## Decisions so far

- [Instagram Location 的 location_id 从哪来](issues/01-instagram-location-source.md#answer) — 来源是带 `location` 数据的 Facebook Page ID；官方搜索走 Pages Search API（生产可用性需实测），最小方案是「手填 Page ID + 建容器兜底校验」；Standalone 不可用；发布后不能回读 location。
- [Instagram Location 在哪些媒体类型上生效](issues/02-instagram-location-media-matrix.md#answer) — 单图/单视频/Reel/Carousel 父容器发送；Story 与 Carousel 子项不发送；父容器官方语法明确含 `location_id`，`location_id` 与 `is_ai_generated` 可同级共存。
- [AI 披露字段在四个 provider 上的位置与生效条件](issues/03-ai-disclosure-matrix.md#answer) — IG 只设容器、carousel 只设父容器（子项会报错）；TikTok 视频 `post_info.is_aigc`、图片顶层 `is_aigc`；Business 视频 `post_info.is_ai_generated`、图片顶层只接受 `true`；统一「仅 true 时发送」；两个 UPLOAD/draft 图片场景仍需实测。
- [Instagram Location 的取数 UX 与 DTO 形状](issues/04-instagram-location-ux.md#answer) — 只做搜索（复刻原生 picker）：IG 走 Pages Search（user token、过滤无 location 的 Page、最多 20 条），TikTok Business 沿用现有地点标签库；DTO 统一 `{id,name,address?}`；Story 隐藏+保留+不发送、搜索失败统一显示 `No location found`（均对齐 TikTok Business）。
- [AI 披露的 DTO 与 UI 契约](issues/05-ai-disclosure-contract.md#answer) — 四 provider 统一 `is_ai_generated` 并删除 `video_made_with_ai`（无兼容迁移，旧帖丢标注、public API 静默忽略）；单个 “Made with AI”；IG Story 与 TikTok 视频 UPLOAD 隐藏，图片 UPLOAD/draft 照发；provider 内联 `assetBoolean`。
- [能力门控与 API 降级语义](issues/06-capability-gating-degradation.md#answer) — 「可见 ⇒ 一定发送」；不适用一律隐藏 + 保留值 + 省略不报错；payload 构造是唯一执行关口；补 IG `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` → `bad-body` 映射；矩阵定稿（TikTok Business UPLOAD 的 Location 修正为隐藏）。

## Not yet specified

决策图已完成：06 已收口，无剩余决策。[真账号发布验证](issues/07-real-account-verification.md) 作为不阻塞实现的后续任务保持 open，待 Instagram（FB Login）与 TikTok Business 账号到位后执行。

## Out of scope

- hashtag 数量/长度校验（用户明确先不管）。
- Instagram Standalone collaborators 是否真被 API 排除（用户明确先不管）。
- TikTok legacy 的 Location（Content Posting API 没有字段）。
- 其他平台（Facebook、Threads、X、YouTube、VK 等）。
- Postiz 接入 SAU（social-auto-upload）channel；public API / SDK / CLI 的字段对齐。
- 本轮实现、提交、发布。
