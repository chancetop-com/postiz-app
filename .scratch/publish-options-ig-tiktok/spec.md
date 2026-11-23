# Instagram / TikTok 发布选项：AI 披露与 Location

Status: ready-for-agent
Created: 2026-11-23

## Problem Statement

内容运营者在 Postiz 里排程 Instagram 和 TikTok 时，AI 披露与地点本应是发布器的常规选项，但四个渠道的现状不一致：Instagram 两个 provider 都没有 AI 标记和地点；TikTok 图片没有 AI 标记；TikTok Business 图片没有顶层 AI 标记；TikTok Business 的地点在 UPLOAD 模式下仍然显示，却被 provider 丢弃。用户无法从界面判断哪些选项会被真正发送，API 调用方也缺少统一字段和可预测的降级语义。

## Solution

把四个 provider 的 AI 披露统一为 `is_ai_generated`，为 Instagram（Facebook Login）增加 Location，并用一张 provider × 媒体类型的矩阵固定每个字段的发送位置和生效条件。

前端遵循「可见 ⇒ 一定发送」：不支持的组合隐藏控件但保留已选值，切回可用模式后恢复；后端在构造 payload 时省略不支持的字段，不返回 400，也不新增 warnings 通道。平台因地点数据无效而拒绝时，返回可读的 `bad-body`，不重试。公开 API 的旧字段 `video_made_with_ai` 不再发送，但不会导致请求失败；已排程的旧帖子仍可发布，只是失去 AI 标注，release note 必须标注这是 breaking behavior change。

## User Stories

1. 作为发布 Instagram 单图的创作者，我希望勾选一次「Made with AI」，以便平台把这张图标为 AI 生成。
2. 作为发布 Instagram 单视频或 Reel 的创作者，我希望同一个 AI 勾选对视频生效，以便不需要维护第二个控件。
3. 作为发布 Instagram Carousel 的创作者，我希望只有一个 AI 勾选并作用于整个父容器，以便子项不会被错误配置。
4. 作为发布 Instagram Story 的创作者，我不希望看到一个可能被平台忽略的 AI 勾选，以便不会勾选一个最终不生效的选项。
5. 作为使用 Instagram Standalone 的创作者，我希望 AI 标记与 Facebook Login 版一样可用，同时地点不出现，以便不会选择一个没有数据来源的地点。
6. 作为直接发布 TikTok 视频的创作者，我希望 AI 标记写入视频的 `post_info`，以便平台显示 AI 标签。
7. 作为把 TikTok 视频上传到收件箱的创作者，我不希望看到 AI 勾选，以免被一个无法发送的字段误导。
8. 作为直接发布 TikTok 图片的创作者，我希望 AI 标记写入请求体顶层，并且图片和视频共用一个勾选，以便界面保持一致。
9. 作为把 TikTok 图片上传到收件箱的创作者，我希望 AI 标记仍然发送；如果真实测试证明平台不保留，我希望控件随后隐藏，以便界面不继续误导我。
10. 作为直接发布 TikTok Business 视频的创作者，我希望 AI 标记写入 `post_info`、地点写入 `location_id` 和 `location_name`，以便两个选项都真正生效。
11. 作为把 TikTok Business 视频上传到草稿的创作者，我不希望看到 AI 或地点控件，以免设置一个会被整体忽略的 `post_info` 字段。
12. 作为直接发布 TikTok Business 图片的创作者，我希望 AI 标记写入请求体顶层、地点正常发送，以便图片帖也能带 AI 标签和地点。
13. 作为把 TikTok Business 图片上传到草稿的创作者，我希望 AI 标记仍然发送、地点不出现；如果真实测试证明顶层 AI 不生效，我希望 AI 控件也隐藏，以便界面与平台行为一致。
14. 作为在 Post、Story、Carousel 之间切换的创作者，我希望已经选好的 AI 值在控件隐藏时不被清空，以便切回可用模式后不用重选。
15. 作为在 Post 和 Story 之间切换的创作者，我希望已经选好的地点在 Story 下隐藏但不被清空，以便切回 Post 后恢复。
16. 作为在 Instagram Post 与 Story 之间、或 TikTok Business DIRECT_POST 与 UPLOAD 之间切换的创作者，我希望地点控件在不可用模式下消失但不阻止保存，以便我能继续发布。
17. 作为内容运营者，我不希望看到 disabled 的控件和一段解释文字；不适用时直接隐藏即可，以便移动端设置面板不被挤满。
18. 作为使用公开 API 的开发者，我希望四个 provider 都接受同一个 `is_ai_generated` 布尔字段，以便不必记两套字段名。
19. 作为仍在使用 `video_made_with_ai` 的旧客户端，我不希望升级后收到 400；这个旧字段应被忽略而发布继续成功，以便升级不破坏现有集成。
20. 作为已经排程了旧帖子的用户，我希望部署后这些帖子仍能发布，以便字段变化不会让队列里的内容失败。
21. 作为维护者，我希望 release note 明确说明旧帖会失去 AI 标注、旧字段会从 Swagger 消失，以便用户理解这是有意的 breaking behavior change。
22. 作为 Instagram（Facebook Login）用户，我希望按关键词搜索地点而不是手填 Page ID，以便不需要了解 Graph API 的内部标识。
23. 作为 Instagram 用户，我希望搜索结果只包含带 location 数据的 Page，以免选出一个必然失败的 `location_id`。
24. 作为 Instagram 用户，我希望最多看到 20 条结果，并在无结果或搜索失败时看到统一的 `No location found`，以便体验与 TikTok Business 一致。
25. 作为 Instagram 用户，我希望地点可用于单图、单视频/Reel 和 Carousel，而 Story 不显示地点，以便清楚知道它会在哪些媒体上生效。
26. 作为 Instagram Standalone 用户，我希望地点控件完全不出现，以免寻找一个该接入方式无法访问的数据来源。
27. 作为 TikTok Business 用户，我希望地点可用于 DIRECT_POST 的视频和图片，并在发布时同时发送 `location_id` 与 `location_name`，以便地点真正出现在帖子上。
28. 作为 TikTok Business 用户，我希望 UPLOAD/draft 模式下不显示地点，以免出现“显示但被静默丢弃”的情况。
29. 作为 TikTok legacy 用户，我不希望看到地点控件，以免期待一个 Content Posting API 根本不存在的字段。
30. 作为 API 调用方，我传入不支持的组合时，希望帖子继续发布、该字段被省略，以便一个不适用字段不会让整条请求失败。
31. 作为发布者，如果我选的 Page 没有地点数据，我希望看到可读错误而不是 `Unknown Error`，且系统不自动重试，以便我能重新选择。
32. 作为使用 AI 助手的用户，我希望 provider 的 `@Rules` 和 Swagger 描述说明哪些媒体/模式会忽略字段，以免助手建议一个不会生效的选项。
33. 作为维护者，我希望能力判断集中在 provider 构造 payload 的地方，以便定时发布和草稿即使绕过保存校验也不会发出错误字段。
34. 作为维护者，我希望 `checkValidity` 继续只做结构性校验，以免隐藏控件里保留的值导致保存被拒绝。
35. 作为没有 Instagram（FB Login）和 TikTok Business 真实账号的开发者，我希望编码不被真机测试阻塞，以便验证可以随后补上。
36. 作为审阅者，我希望有一张唯一的 provider × 媒体类型矩阵，以便直接判断某个字段该不该显示、该不该发送、发到哪里。
37. 作为测试维护者，我希望用现有测试结构验证实际发出的 URL/body 和设置组件可见性，而不是测试内部 helper，以便测试不随实现细节漂移。

## Implementation Decisions

### 统一 DTO 与公开 API

- `InstagramDto` 增加：
  - `location?: InstagramLocation`，形状为 `{ id: string; name: string; address?: string }`；`id` 是带 location 数据的 Facebook Page ID。
  - `is_ai_generated?: boolean`。
- `TikTokDto`（legacy 与 Business 共用）删除 `video_made_with_ai`，增加 `is_ai_generated?: boolean`。
- 取值约定：**仅在值为 `true` 时发送**；`false` 与 `undefined` 在发送层都等同于「省略」。不引入三态，不默认发送 `false`。
- 公开 API 的旧字段 `video_made_with_ai` 不会 400（全局校验没有开启 whitelist），但 provider 不再读取它。旧帖子仍能发布，只是失去 AI 标注；release note 必须写明这是 breaking behavior change，Swagger 中旧字段消失。
- 不做数据迁移，不重写历史 `Post.settings`。

### 最终支持矩阵

| Provider | 媒体 / 模式 | AI 披露 | Location |
|---|---|---|---|
| Instagram（Facebook Login） | 单图 | 显示；容器 `is_ai_generated=true` | 显示；容器 `location_id` |
| Instagram（Facebook Login） | 单视频 / Reel | 显示；同上 | 显示；同上 |
| Instagram（Facebook Login） | Carousel | 显示；仅父容器 | 显示；仅父容器 |
| Instagram（Facebook Login） | Story | 隐藏；不发 | 隐藏；不发 |
| Instagram（Standalone） | 单图 / 视频 / Reel / Carousel | 显示；发送 | 隐藏；不发 |
| Instagram（Standalone） | Story | 隐藏；不发 | 隐藏；不发 |
| TikTok legacy | 视频 DIRECT_POST | 显示；`post_info.is_aigc=true` | 无字段；隐藏 |
| TikTok legacy | 视频 UPLOAD | 隐藏；不发 | 隐藏 |
| TikTok legacy | 图片 DIRECT_POST / MEDIA_UPLOAD | 显示；顶层 `is_aigc=true` | 隐藏 |
| TikTok Business | 视频 DIRECT_POST | 显示；`post_info.is_ai_generated=true` | 显示；`location_id` + `location_name` |
| TikTok Business | 视频 UPLOAD | 隐藏；不发 | 隐藏；不发（修正现状） |
| TikTok Business | 图片 DIRECT_POST | 显示；顶层 `is_ai_generated=true` | 显示；`location_id` + `location_name` |
| TikTok Business | 图片 UPLOAD / draft | 显示；顶层 `is_ai_generated=true`（待真机确认） | 隐藏；不发（`is_draft` 忽略 `post_info`） |

- Carousel 子项既不发 AI 也不发 location；IG 的 AI 与 location 都只加在父容器那一次请求。
- IG Story 的 AI 先隐藏；等真机确认平台是否接受后，再决定是否另开票放开。
- TikTok legacy 图片 UPLOAD 与 TikTok Business 图片 draft 的 AI 先按「发送」实现；如果真机确认平台不保留，按同一矩阵把控件改为隐藏，并回写本规格。

### 前端门控

- 不适用场景一律沿用 `invisible h-0 overflow-hidden`：控件保持挂载、`register()` 保留值，只是不可见；切回可用模式后原值和控件恢复。
- 不改为 `disabled`，不附原因行。handoff 的「UI 不能静默丢弃」收窄为「可见控件 ⇒ 一定发送」；隐藏控件不计入丢弃，因为用户从未看到它。
- Instagram 设置：在 Post Type 之后、Collaborators 之前加入唯一的 AI 勾选；Location 使用搜索选择器。Story 下两个控件都隐藏；`instagram-standalone` 下 Location 永不渲染；Carousel 只有一个 AI 勾选和一个 Location 选择，值只作用于父容器。
- TikTok 设置：移除 Video features 区域里的旧「Video made with AI」；在媒体类型无关的位置放唯一的 `is_ai_generated` 勾选。视频 DIRECT_POST 与图片 DIRECT_POST 显示；视频 UPLOAD 隐藏；图片 UPLOAD 显示。TikTok Business 的 Location 在 UPLOAD 下隐藏（当前是显示但被 provider 丢弃）。
- 文案 key 改为 `made_with_ai`，文案 `Made with AI`；从各 locale 删除旧的 `video_made_with_ai` key。`i18n.lock` 交给现有同步工具重建，不手改。

### 后端行为与校验位置

- **payload 构造处是唯一执行关口**：provider 在拼请求体时按 `post_type` / 媒体扩展名 / `content_posting_method` / Graph host 判断是否带上字段。定时发布执行时不走 `checkValidity()`，草稿也可能绕过保存校验，只有 payload 构造每次都会执行。
- `checkValidity()` 保持结构性校验，不新增 AI / location 规则。API 调用方传入不支持组合时，provider 省略字段，请求继续成功；不新增 400，也不新增 warnings 通道。
- Instagram 的 Story 判定使用 `post_type === 'story'`，不能用 `postType`（单条 Story 的 `postType` 是 `single`）。Instagram Standalone 通过委托复用 Facebook Login 的实现，因此 location 守卫必须按 Graph host（`graph.instagram.com`）判断，不能假设 identifier 一定是 `instagram`。
- Instagram 发送位置：单媒体加到容器创建请求；Carousel 加到父容器创建请求，`location_id` 与 `is_ai_generated` 可以同级共存；Story、Carousel 子项、Standalone 永不发送 location。
- TikTok legacy：视频 DIRECT_POST 用 `post_info.is_aigc`；图片两种模式都用请求体顶层 `is_aigc`；视频 UPLOAD 没有 `post_info`，不发送。
- TikTok Business：视频 DIRECT_POST 用 `post_info.is_ai_generated` 与 `post_info.location_id/location_name`；图片 DIRECT_POST 用顶层 `is_ai_generated` 与 `post_info.location_id/location_name`；视频 UPLOAD 的 `post_info` 只保留 `upload_to_draft`；图片 UPLOAD 的 `post_info` 只保留 `is_draft` + title/caption，顶层 AI 仍发送，location 不发送。
- 可发现性放在 DTO 的 `@JSONSchema` 描述和 provider 的 `@Rules`：写明哪些媒体/模式会忽略字段，以及 UPLOAD/draft 的语义。

### Instagram Location 取数与错误

- 只做搜索，不做手填 Page ID，不做「我的 Page」快捷区，不调用 `/me/accounts`。
- Instagram provider 新增 `locationSearch`：使用 user token 调用 Pages Search，`fields=id,name,location,link`；过滤掉没有 location 数据的 Page；`id` 转 string；`address` 由 street/city/state/country 拼接；最多展示 20 条，不假设分页。
- 搜索错误语义对齐 TikTok Business：`refresh-token` 照常抛 `RefreshToken`；其余错误返回空数组，前端统一显示 `No location found`。
- 复用现有地点搜索选择器的交互（防抖、Loading、结果列表、已选卡片、移除按钮），但 DTO 与 provider 专属描述保持独立。
- TikTok Business 继续使用现有地点标签库搜索，不改变其搜索协议；本规格只修正 UPLOAD 下控件的可见性。
- `handleErrors()` 增加已知字符串映射：`INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` → `bad-body`，提示所选 Page 没有有效地点数据、需要重选，不重试。不扩展 `#100` / `#200` 等共享错误码，避免误伤其他场景。

### 真实账号验证

- 依赖真实账号的验证不阻塞 coding。实现先按矩阵落地，用可离线验证的 payload 断言、UI 显隐、DTO 校验验收。
- 缺少 Instagram（FB Login）与 TikTok Business 账号时，只在独立的真账号验证票里记录缺口；账号到位后补测。
- 若真机结果推翻矩阵，按本规格的 fallback 改行为并回写矩阵，不回头阻塞实现。

## Testing Decisions

- 好的测试只断言外部可观察行为：provider 实际发出的 URL / body、`checkValidity()` 的返回值、`handleErrors()` 的分类，以及设置组件在用户可见层面的显示/隐藏和值保留。不断言内部 helper 的名字、调用次数或 Tailwind 类名的完整字符串。
- **主接缝：provider → 平台 HTTP 边界。** 实例化真实 provider，替换 `provider.fetch` 或全局 `fetch`，记录 host / path / search / method / body，逐格验证支持矩阵。现有 provider 凭证矩阵测试已经使用这个模式。覆盖：
  - IG Facebook Login 单图、单视频/Reel、Carousel 父容器、Story、Standalone。
  - TikTok legacy 视频 DIRECT/UPLOAD、图片 DIRECT/MEDIA_UPLOAD。
  - TikTok Business 视频 DIRECT/UPLOAD、图片 DIRECT/draft。
  - 仅 `true` 发送、`false`/`undefined` 省略。
  - Story/Standalone/Carousel 子项不发 location。
  - `checkValidity()` 对 Story + location、Standalone + location、UPLOAD + AI 仍返回 `true`。
  - `handleErrors()` 对 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` 返回 `bad-body`，且不重试。
- **UI 接缝：设置组件元数据。** 用 `getProviderSettingsMeta(...).SettingsComponent` 单独渲染，外面套真实的 `FormProvider`，mock `useIntegration` / `useT`。这是生产代码已经用于预览和移动端设置页的入口，不是新造管道。现有 jsdom 组件测试已经使用 mock hook + Testing Library 的模式。覆盖：
  - 各 provider/媒体/模式下控件的显示与隐藏。
  - 控件隐藏后值仍在，切回可用模式后恢复。
  - Story、Standalone、TikTok 视频 UPLOAD、TikTok Business UPLOAD 的隐藏组合。
  - Carousel 只有一个 AI 勾选和一个 Location 选择。
- **DTO 校验**作为 provider 测试的准备步骤，用 `plainToInstance` + `validate` 覆盖 `is_ai_generated`、`location` 的接受，以及旧 `video_made_with_ai` 不导致校验失败；不单独新开一层。
- 测试模块：Instagram provider（含 Standalone 委托）、TikTok legacy provider、TikTok Business provider、两个 Instagram/TikTok 设置组件、相关 DTO。优先扩展现有的 provider 凭证矩阵和 jsdom 组件测试，不新建端到端栈。
- 不调用真实 Instagram / TikTok 平台；平台响应全部用本地替身。真实账号行为由独立的真账号验证票记录。

## Out of Scope

- hashtag 数量 / 长度校验。
- Instagram Standalone collaborators 是否真被 API 排除。
- TikTok legacy 的 Location（Content Posting API 没有字段）。
- 其他平台（Facebook、Threads、X、YouTube、VK 等）。
- Postiz 接入 SAU（social-auto-upload）channel。
- SDK / CLI 的显式字段封装与示例更新；DTO 变化会反映到生成的 schema，但 SDK/CLI 的独立适配另开票。
- 新增 warnings 通道、对不支持组合返回 400、或强制拒绝保存。
- 迁移旧 `video_made_with_ai` 帖子、回填历史 `Post.settings`。
- 在真实测试确认前放开 Instagram Story 的 AI 或 Location。
- 生产部署、提交、发布。

## Further Notes

- 本规格是 [Instagram/TikTok 发布选项决策图](map.md) 的实施整理；字段位置与平台依据见决策图中的调研票，门控与降级语义见「能力门控与 API 降级语义」。
- 统一矩阵是实现者的唯一事实来源；如果真机验证推翻某一格，先改矩阵，再改代码。
- 上线前 release note 必须包含：`video_made_with_ai` 已移除、旧排程帖子会失去 AI 标注但不会发布失败、`is_ai_generated` 是新的统一字段。
- 真实账号验证单独跟踪，当前缺 Instagram（FB Login）与 TikTok Business 账号；这不阻塞实现。
