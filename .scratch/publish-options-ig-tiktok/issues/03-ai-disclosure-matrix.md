# AI 披露字段在四个 provider 上的位置与生效条件

Type: research
Status: resolved
Blocked by: —

## Question

逐项核实并给出字段路径、取值和生效条件：

1. Instagram (Facebook Business / Standalone)：`is_ai_generated` 在单图、单视频、Reel、Story、Carousel 父容器、Carousel 子项上的支持情况；Carousel 是否只能设父容器。
2. TikTok legacy 视频：`post_info.is_aigc`；图片：body 顶层 `is_aigc`。UPLOAD（draft）模式下是否仍生效或被忽略？
3. TikTok Business 视频：`post_info.is_ai_generated`；图片：body 顶层 `is_ai_generated`。是否只接受 `true`、不接受 `false`？UPLOAD（draft）模式下是否生效？
4. 每个 provider 应在「仅 true 时发送」还是「true / false 都发送」？给出推荐及理由。
5. 平台不支持的媒体类型：provider 应省略字段还是报错？给 06 提供事实输入。

产出：`.scratch/publish-options-ig-tiktok/research/03-ai-disclosure-matrix.md`，并在本票 `## Answer` 里给出结论与来源链接。

## Answer

完整调研：`.scratch/publish-options-ig-tiktok/research/03-ai-disclosure-matrix.md`（含逐条引文、证据等级、实测清单、代码落点）。

### 结论矩阵

| Provider | 媒体 | 字段路径 | 文档支持取值 | 发送策略 | 证据 |
|---|---|---|---|---|---|
| Instagram（Facebook Login / Instagram Login 均支持） | 单图 | `POST /<IG_ID>/media` 的 `is_ai_generated` | `true`/`false`（类型 `TRUE_OR_FALSE`） | 仅 `true` 时发 | ✅ 写明 |
| Instagram | 单视频 / Reel | 同上 | 同上 | 仅 `true` 时发 | ⚠️ 无排除条款、无示例 |
| Instagram | Story | 同上 | 同上 | 仅 `true` 时发（**先实测**，未确认前 UI 隐藏） | ⚠️/🧪 |
| Instagram | Carousel 父容器 | 同上（`media_type=CAROUSEL`） | 同上 | 仅 `true` 时发；**唯一合法位置** | ✅ 写明 |
| Instagram | Carousel 子项 | 同上（`is_carousel_item=true`） | — | **绝不发送，会报错** | ✅ 写明 |
| TikTok legacy | 视频 DIRECT_POST | `post_info.is_aigc` | bool（文档只描述 `true`） | 仅 `true` 时发 | ✅ 写明 |
| TikTok legacy | 视频 UPLOAD | 无字段 | — | 不能发（endpoint 无 `post_info`） | ✅ schema 缺失 |
| TikTok legacy | 图片（两种 post_mode） | **body 顶层** `is_aigc` | bool（文档只描述 `true`） | 仅 `true` 时发；MEDIA_UPLOAD 是否生效 🧪 | ✅ 位置 / ⚠️ UPLOAD |
| TikTok Business | 视频 DIRECT | `post_info.is_ai_generated` | `true`/`false`，默认 `false` | 仅 `true` 时发 | ✅ 写明 |
| TikTok Business | 视频 draft | 同上 | — | 不发（`upload_to_draft` 忽略整个 `post_info`） | ✅ 写明 |
| TikTok Business | 图片 | **body 顶层** `is_ai_generated` | **只写 `true`，不要就省略** | 仅 `true` 时发 | ✅ 写明 |
| TikTok Business | 图片 draft | 顶层 `is_ai_generated` | — | 可发；未被 `is_draft` 的忽略条款覆盖 🧪 | ⚠️ |

### 逐项回答

1. **Instagram**：`is_ai_generated` 是创建媒体容器时的 query 参数。官方明确「carousel 只需设在父容器；设在子项上会**报错**」（不是静默忽略）。文档唯一的排除项就是 carousel children，因此单图/单视频/Reel 推定支持（无示例），Story 既没写支持也没写排除 → 需实测。两种登录类型都支持，Standalone 无需特殊处理。实现要点：子项容器在 `postPending()` 建（不能带参数），父容器在 `finalizePost()` 建（参数必须随 `pendingData` 传过去）。

2. **TikTok legacy**：视频 `post_info.is_aigc`；图片 `is_aigc` 在 **body 顶层**（与 `post_mode` 同级）。视频 UPLOAD 用的是 `/v2/post/publish/inbox/video/init/`，其 body **只有 `source_info`**，没有 `post_info` → UPLOAD 模式下视频根本没有 AI 字段可传（现有 UI 禁用是对的）。图片 UPLOAD 走同一个 `/content/init/` 端点，`is_aigc` 在 `post_info` 之外、不受「Only works for DIRECT_POST」限定 → 文档未明确，倾向生效，需实测。

3. **TikTok Business**：视频 `post_info.is_ai_generated`，**`true`/`false` 都是支持值**（默认 `false`）；`upload_to_draft=true` 时「`post_info` 内其余字段全部忽略」→ AI 明确失效。图片 `is_ai_generated` 在 **body 顶层**，且**只支持 `true`**——"Supported value: `true`. Omit this field if you do not want to enable the setting."，所以 `false` 是未定义取值，只能省略。图片 `is_draft=true` 只忽略「`post_info` 内除 title/caption 外的字段」，顶层 AI 字段不在忽略范围 → 文档未明确，需实测。

4. **推荐：四个 provider 统一「仅 `true` 时发送，`false`/未设置则省略」。** 理由：Business 图片本来就只能发 `true`，统一后消除「同一 provider 两种布尔约定」；其余三处文档只描述 `true`、省略等价于不打标，发 `false` 只增加被平台判非法的风险而无收益；IG 是「报错型」校验平台，风险不对称；省略也是 Business 文档给的官方关闭方式。

5. **平台不支持时的处理（给 06 的事实输入）**：provider 层**省略、不抛错**（AI 披露是标签，不该让整条发布失败）；但**不得静默丢弃**——不支持的组合必须在 UI/能力层隐藏或禁用。唯一例外是 IG carousel：不是省略而是**把值移到父容器**。若确需硬失败（合规要求），放 `checkValidity()`，不要在容器创建时抛 `BadBody`。

### 来源

- IG User Media（`is_ai_generated` 参数；"Not available for carousel children"）：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- Content Publishing 指南「AI Content」（只设父容器、子项会报错、两种登录都支持）：https://developers.facebook.com/documentation/instagram-platform/content-publishing
- Changelog 2026-06-22「AI Info Label」（Applies to all versions；两种登录）：https://developers.facebook.com/documentation/instagram-platform/changelog
- IG Media（读侧 `is_ai_generated`，"Excludes album children"）：https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
- TikTok Direct Post（`post_info.is_aigc`）：https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- TikTok Upload（inbox endpoint body 只有 `source_info`）：https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video
- TikTok Photo（顶层 `is_aigc`；`post_info` 字段的 "Only works for post_mode = DIRECT POST" 限定）：https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post
- TikTok Business 视频 v1.3（`post_info.is_ai_generated` true/false；`upload_to_draft` 忽略 `post_info`）：https://business-api.tiktok.com/portal/docs/publish-a-public-video-post-to-an-owned-account/v1.3
- TikTok Business 图片 v1.3（顶层 `is_ai_generated`，"Supported value: `true`"；`is_draft` 只忽略 `post_info` 内字段）：https://business-api.tiktok.com/portal/docs/publish-a-photo-post-to-an-owned-account/v1.3

### 顺带确认的既有偏差（不在本票改代码）

- `instagram.provider.ts` 完全没有 `is_ai_generated`。
- `tiktok.provider.ts:589-595` 图片分支显式排除 AI，`buildTikokSourceInfoBody()` 的 picture 分支也没加顶层 `is_aigc`。
- `tiktok.business.provider.ts:653-694` 图片 body 缺顶层 `is_ai_generated`。
- `tiktok.dto.ts:138` 与 `tiktok.dto.ts:61-66` 的注释（"TikTok has no AI-generated label for photo posts"）是旧信息，需改；两个 provider 的 `@Rules` 文本同样要改。
