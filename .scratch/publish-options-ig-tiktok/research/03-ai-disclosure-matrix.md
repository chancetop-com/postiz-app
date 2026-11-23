# AI 披露字段矩阵 — Instagram / TikTok legacy / TikTok Business

- 调研日期：2026-11-23
- 对应票：`.scratch/publish-options-ig-tiktok/issues/03-ai-disclosure-matrix.md`
- 范围：只核实 AI 披露字段的位置与生效条件；Location / Tags / Collaborators 不在本文件
- 方法：只读一手官方文档（Meta Instagram Platform、TikTok Content Posting API、TikTok Business API），并对照本仓库当前 provider 实现
- 不涉及生产代码改动

## 证据等级约定

| 标记 | 含义 |
|---|---|
| ✅ 文档写明 | 官方文档原文有明确语句（下文给出引文与 URL） |
| ⚠️ 文档未明确 | 官方文档没有写；结论来自字段位置、类型、排除条款的缺失等间接证据 |
| 🧪 需实测 | 只能靠真实调用确认（给出建议的验证方式） |

---

## 0. TL;DR

| Provider | 媒体 | 字段路径 | 文档支持取值 | 何时发送（推荐） | 证据 |
|---|---|---|---|---|---|
| Instagram（Facebook Login / Instagram Login 都支持） | 单图 | `POST /<IG_ID>/media` 的 `is_ai_generated` | `true` / `false`（类型 `TRUE_OR_FALSE`） | 仅 `true` 时发送 | ✅ |
| Instagram | Reel / 单视频 | 同上 | 同上 | 仅 `true` 时发送 | ⚠️（无排除条款，无示例） |
| Instagram | Story | 同上 | 同上 | 仅 `true` 时发送，但需先实测 | ⚠️/🧪 |
| Instagram | Carousel **父容器** | 同上（`media_type=CAROUSEL` 的容器） | 同上 | 仅 `true` 时发送；**唯一合法位置** | ✅ |
| Instagram | Carousel **子项** | 同上 + `is_carousel_item=true` | — | **绝不发送**（会报错） | ✅ |
| TikTok legacy（Content Posting API） | 视频 DIRECT_POST | `post_info.is_aigc` | bool（文档只描述 `true`） | 仅 `true` 时发送 | ✅ |
| TikTok legacy | 视频 UPLOAD | 无字段 | — | 不能发送（endpoint 无 `post_info`） | ✅（schema 缺字段） |
| TikTok legacy | 图片 DIRECT_POST | **body 顶层** `is_aigc`（与 `post_mode` 同级） | bool（文档只描述 `true`） | 仅 `true` 时发送 | ✅ |
| TikTok legacy | 图片 MEDIA_UPLOAD | 同上 | 同上 | 仅 `true` 时发送（是否生效 ⚠️/🧪） | ⚠️ |
| TikTok Business | 视频 DIRECT | `post_info.is_ai_generated` | `true` / `false`，默认 `false` | 可发 `true`/`false`；建议仍只发 `true` | ✅ |
| TikTok Business | 视频 draft（`upload_to_draft=true`） | `post_info.is_ai_generated` | — | 不发送（`post_info` 全部被忽略） | ✅ |
| TikTok Business | 图片 | **body 顶层** `is_ai_generated`（与 `post_info` 同级） | **只写 `true`；不要就省略** | 仅 `true` 时发送 | ✅ |
| TikTok Business | 图片 draft（`post_info.is_draft=true`） | 顶层 `is_ai_generated` | — | 可发送，是否生效 🧪 | ⚠️ |

一句话：**四个 provider 统一实现为「用户勾选（true）才发送字段，否则整个字段省略」**；唯一的硬性例外是 TikTok Business 图片，文档明确只支持 `true`，`false` 属未定义取值。

---

## 1. 来源清单

| # | 页面 | URL | 抓取日期 | 用到的内容 |
|---|---|---|---|---|
| S1 | IG User Media（`POST /<IG_ID>/media` 参考） | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media | 2026-11-23 | `is_ai_generated` 参数定义；carousel children 限制；caption / location / alt_text 的对照 |
| S2 | Instagram Platform — Content Publishing 指南（**AI Content** 小节） | https://developers.facebook.com/documentation/instagram-platform/content-publishing | 2026-11-23 | AI Content 段落：只设父容器、子项会报错、两种登录类型都支持 |
| S3 | Instagram Platform Changelog（2026-06-22 条目） | https://developers.facebook.com/documentation/instagram-platform/changelog | 2026-11-23 | `is_ai_generated` 上线公告，日期与适用版本 |
| S4 | IG Media（读侧字段） | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media | 2026-11-23 | `is_ai_generated` 读回语义："Excludes album children" |
| S5 | IG Container | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container | 2026-11-23 | 容器字段里**没有** `is_ai_generated`（只能写、不能读容器） |
| S6 | TikTok Content Posting API — Direct Post（video） | https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post | 2026-11-23（页面标注 Last updated 2026-10-27） | `post_info.is_aigc` |
| S7 | TikTok Content Posting API — Upload（video inbox） | https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video | 2026-11-23（页面标注 2026-08-04） | UPLOAD 模式 body 只有 `source_info` |
| S8 | TikTok Content Posting API — Photo | https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post | 2026-11-23（页面标注 2026-10-27） | 顶层 `is_aigc`；`post_info` 字段的 "Only works for post_mode = DIRECT POST" 限定 |
| S9 | TikTok Business API — Publish a public video post（v1.3） | https://business-api.tiktok.com/portal/docs/publish-a-public-video-post-to-an-owned-account/v1.3 | 2026-11-23 | `post_info.is_ai_generated`（true/false）；`upload_to_draft` 忽略 `post_info` |
| S10 | TikTok Business API — Publish a photo post（v1.3） | https://business-api.tiktok.com/portal/docs/publish-a-photo-post-to-an-owned-account/v1.3 | 2026-11-23 | 顶层 `is_ai_generated`（"Supported value: `true`"）；`is_draft` 只忽略 `post_info` 内字段 |

> 复现提示：S9/S10 是 Next.js 客户端渲染页，直接 curl HTML 拿不到正文。正文由
> `https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?content_slug=<slug>&version=1.3&language=ENGLISH`
> 返回（`language` 必须是大写枚举 `ENGLISH`），JSON 的 `data.content_data` 就是 markdown 原文。S1–S5 加 `.md` 后缀可直接取 markdown（如 `.../ig-user/media.md`）。

---

## 2. Instagram（Facebook Login 与 Instagram Login 共用一套容器 API）

### 2.1 字段位置

`is_ai_generated` 是**创建媒体容器**（`POST /<IG_ID>/media`）时的 query 参数，不是发布时的参数，也不是 caption 的一部分。

S1 原文（Query String Parameters 表）：

> `is_ai_generated` | `<TRUE_OR_FALSE>` | An optional parameter to provide a self-disclosure of AI usage in the post. **Not available for carousel children.**

S2「AI Content」小节原文：

> To provide a self-disclosure of AI usage in the media, you can set `is_ai_generated` parameter to `true` when creating a media container. For carousels, only the carousel container needs to have the `is_ai_generated` parameter set to `true`. **Setting this parameter on carousel children will result in an error.** This parameter is available to both Instagram API with Facebook Login and Instagram Login.

S3（2026-06-22，标注 "Applies to all versions."）：

> The Content Publishing API now supports self-disclosure of AI-generated content at publish time. Set the new `is_ai_generated` parameter to `true` when creating a media container to apply the AI info label. For carousels, set `is_ai_generated` on the carousel container only. Available in both Instagram API with Facebook Login and Instagram API with Instagram Login.

因此：

- 参数挂在**单个容器**上，谁被 `media_publish` 谁带标签；
- API 版本无关（"all versions"）；
- 两种登录类型都支持，**Standalone（graph.instagram.com）不需要特殊处理**——只要把参数拼进 `postPending()` 里同一个 `/media` 请求即可。

### 2.2 逐媒体类型矩阵

| 媒体形态 | 容器怎么建（本仓库现状） | `is_ai_generated` | 证据 |
|---|---|---|---|
| 单图 | `image_url=...`（无 `media_type`） | 支持。S2 的 AI Content 示例就是单图容器 | ✅ |
| 单视频（Postiz 走 `media_type=REELS`） | `video_url=...&media_type=REELS` | 支持（推定）。S1 的排除项只有 carousel children；S2 说 "in the media" | ⚠️ 文档未逐类型列举 |
| Reel（含 Trial Reel） | 同上 + `trial_params` | 同上（推定支持） | ⚠️ |
| Story（图/视频） | `media_type=STORIES` | **文档既没列支持、也没列排除** | ⚠️ + 🧪 |
| Carousel 父容器 | `media_type=CAROUSEL&children=...` | 支持，且是唯一应该设置的位置 | ✅ |
| Carousel 子项 | 每个 child 单独建容器 + `is_carousel_item=true` | **不支持，设置会报错** | ✅ |

关于 Story，值得记录的对照证据：S1 里 `alt_text`、`location_id`、`poll_attachment` 都写了明确的排除语句（"Reels and stories are not supported" / "Not supported on images or videos in carousels" / "Not supported on stories or carousel children"），而 `is_ai_generated` 只有一句 "Not available for carousel children"。**排除条款的缺失是一个正面信号，但不等于官方承诺**。所以：

- 结论：Story 属「文档未明确」，上线前应实测；
- 在实测结论出来之前，若坚持「UI 可见即必须生效」的原则（handoff §5.7），Story 上应**隐藏**该开关，而不是让用户勾了却可能被平台丢掉。

### 2.3 Carousel：只能设父容器，且子项设置是**报错**而不是忽略

这是本条最硬的事实：

1. 只有父容器需要设置（S2）；
2. 在子项上设置 **会报错**（"will result in an error"）——不是静默忽略；
3. 读侧印证：S4 的 IG Media 字段 `is_ai_generated` 描述为 "Indicates if the media has an AI label. **Excludes album children.**"

对本仓库的直接含义：`instagram.provider.ts` 里 carousel 的**子项容器在 `postPending()` 创建**（`is_carousel_item=true` 那段），**父容器在 `finalizePost()` 创建**（`media_type=CAROUSEL` 那段）。因此：

- `is_ai_generated` **不能**加进子项容器的 URL；
- 必须加进 `finalizePost()` 的父容器 URL；
- 值必须随 `pendingData` 从 `postPending()` 传到 `finalizePost()`（和现在 `collaborators` 的做法一样）。

单媒体（图/视频/Story）不经过父容器，直接在 `postPending()` 的容器 URL 上加。

### 2.4 取值：`true` / `false` 都可，但文档只描述 `true`

- S1 把类型写成 `<TRUE_OR_FALSE>`，语法上两个值都合法；
- S2 与 S3 都只说「set … to `true`」，没有描述 `false` 的行为；
- 平台对参数校验较严（carousel children 直接报错），因此 `false` 是否被接受**没有文档保证**（⚠️/🧪）。

推荐：**只在 `true` 时发送，`false`/未设置时整个参数省略**。理由见第 5 节。

### 2.5 代码落点（供 06 使用，不改代码，仅定位）

- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`
  - `postPending()` ≈ 740–877：单个容器 URL 的拼接在 835–842（`/media?${mediaType}${altText}${isCarousel}${itemCollaborators}${trialParams}${audioConfiguration}&access_token=...&caption=...`）。在这里加 `&is_ai_generated=true`（**仅当**非 carousel 子项、且用户勾选）。
  - `pendingData` 构造 ≈ 851–876：需要新增一个字段把值带到 `finalizePost()`。
  - `finalizePost()` ≈ 938–1066：carousel 父容器创建在 994–1021，在这里加 `&is_ai_generated=true`。
- `libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts`
  - `postPending()` 225–238、`finalizePost()` 253–259 都是纯委托，**不需要单独改**（参数随 `pendingData` 走）。

---

## 3. TikTok legacy（Content Posting API，`open.tiktokapis.com`）

### 3.1 视频 DIRECT_POST：`post_info.is_aigc`

S6 原文（`post_info` 表）：

> `is_aigc` | bool | Set to true if the video is AI generated content. If set, the video will be labelled with **Creator labeled as AI-generated** tag in video's description. | Required: false

- 位置：`post_info` 内（与 `title`、`privacy_level`、`disable_comment` 同级）；
- 类型 bool，文档只描述 `true` 的语义，未描述 `false`；
- 只影响“标签”，不影响分发（Business 版文档有明确写；legacy 未写，不做推断）。

### 3.2 视频 UPLOAD（inbox / draft）：**结构上没有这个字段**

S7 的 `POST /v2/post/publish/inbox/video/init/` Body 表**只有** `source_info`（`source` / `video_size` / `chunk_size` / `total_chunk_count` / `video_url`）——**没有 `post_info`**。

结论（✅ 文档写明，依据是 schema 缺字段）：

- UPLOAD 模式下 legacy 视频**没有任何 AI 披露字段可以传**；
- 当前 `tiktok.provider.ts` 在 UPLOAD 分支仍返回 `{ post_info: { title } }`（`buildTikokPostInfoBody()` 617–625），这个 `post_info` 在 inbox endpoint 是未定义字段，按平台行为会被忽略；
- 因此 UI 在 UPLOAD 模式下隐藏/禁用 AI 开关是**正确**的，不是暂时妥协。

（严格说是「文档未定义」，但 inbox endpoint 的 body 里连 title 都没有，说明它确实不读 `post_info`。若想彻底确认可 🧪：在 UPLOAD 调用里附带 `post_info.is_aigc=true`，看返回是否 `invalid_param`。**不建议在实现里依赖这个未定义行为。**）

### 3.3 图片：`is_aigc` 在 **body 顶层**

S8 的 Body 表（顶层字段）：`media_type`、`post_mode`、`post_info`、`source_info`、`is_aigc`。

> `is_aigc` | bool | Set to `true` if the photo is AI generated content. If set, the photo will be labeled with an AI-generated tag in the description. | Required: false

关键对照：S8 里 `post_info` 内的 `disable_comment`、`auto_add_music`、`brand_content_toggle`、`brand_organic_toggle` **每一条都带** "Only works for `post_mode = DIRECT_POST`"；而 `is_aigc` 位于 `post_info` 之外，**没有**这个限定。

- DIRECT_POST：生效（✅ 顶层字段 + 文档描述）；
- MEDIA_UPLOAD：**文档未明确**（⚠️）。字段位置在 `post_info` 之外，所以「只有 DIRECT_POST 生效」的限定条款管不到它；官方 Upload 示例里没有带 `is_aigc`。是否真的在用户从 inbox 完成发布后仍打标，需要实测（🧪）。

### 3.4 代码落点（供 06 使用）

- `libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts`
  - `buildTikokPostInfoBody()` ≈ 564–626：视频 `post_info.is_aigc` 已在 589–595（DIRECT_POST 分支，正确位置）。
  - **图片分支缺字段**：589–595 是 `...(isPhoto ? {} : { is_aigc: ... })`，图片被显式排除。
  - `buildTikokSourceInfoBody()` ≈ 871–904：图片分支（879–892）返回 `post_mode` / `media_type` / `source_info`，**这里才是加顶层 `is_aigc` 的地方**（注意它在 `source_info` 外面）。
  - `postPending()` 937–940 把两个 builder 展开合并成 body：`{...buildTikokPostInfoBody(), ...buildTikokSourceInfoBody()}`，所以顶层字段加在 source builder 里能正确出现在 body 顶层。

---

## 4. TikTok Business（Business API，`business-api.tiktok.com`）

### 4.1 视频：`post_info.is_ai_generated`，`true`/`false` 都支持

S9 原文（`post_info` 表，嵌套行 `#|`）：

> `is_ai_generated` | boolean | Whether to enable the AI-generated content toggle for the video post. If you enable the toggle, your video will be labeled as **Creator labeled as AI-generated** once posted and can't be changed. … **Supported values: `true`, `false`.** Default value: `false`.

所以对 Business **视频**：

- `true` 和 `false` 都是文档支持值，默认 `false`；
- 标签一旦发布不可更改（"can't be changed"）；
- 传 `false` 与省略等价（默认值就是 `false`）。

### 4.2 视频 draft：`upload_to_draft=true` 会忽略整个 `post_info`

S9 原文：

> `upload_to_draft` | boolean | Whether to upload the post as a draft. … **If you set this field to `true`, all the other fields within `post_info` will be ignored.**

`is_ai_generated` 是 `post_info` 的嵌套字段 → **draft 模式下 100% 被忽略**（✅ 文档写明）。当前 `tiktok.business.provider.ts` 的 `buildVideoBody()` 把 `is_ai_generated` 放在非 draft 分支（581–616 的 `...(isDraft ? { upload_to_draft: true } : { ... is_ai_generated ... })`），**现在就是对的**。

### 4.3 图片：`is_ai_generated` 在 **body 顶层**，且**只接受 `true`**

S10 参数表（`post_info` **之前**、`photo_cover_index` 之后，没有 `#|` 前缀 → 顶层；Param Location = Body）：

> `is_ai_generated` | boolean | Body | Whether the AI-generated content toggle is enabled for the photo post. If this field is `true`, the photo post is labeled as Creator labeled as AI-generated once posted and this label cannot be changed. … **Supported value: `true`. Omit this field if you do not want to enable the setting.** Note: For photos published before this toggle was available, the API will not enable the setting.

这是四个 provider 里唯一一处**明确只支持单一取值**的字段：

- `true` → 打标；
- 不想要 → **省略（omit）**；
- `false` **不是**文档支持值 → 传 `false` 属于未定义行为，很可能被当成 `invalid_param`（🧪 可验，但不建议在实现里赌）。

对照同文件的 `post_info` 内字段（`privacy_level`、`title`、`caption`、`auto_add_music`、`is_brand_organic`、`is_branded_content`、`is_draft`、`disable_comment`、`music_sound_info`、`location_id`、`location_name`）都在 `post_info` 之下（`#|` 前缀），只有 `is_ai_generated` 是顶层。

**这也解释了为什么当前代码缺失它是真正的 bug**：`buildPhotoBody()` 只构造了 `business_id` / `photo_images` / `photo_cover_index` / `post_info`，没有顶层 `is_ai_generated`。

### 4.4 图片 draft：只忽略 `post_info` 内字段，顶层 `is_ai_generated` 未在忽略范围内

S10 原文：

> `is_draft` | boolean | Whether to upload the post as a draft. … **If you set this field to `true`, all the other fields within `post_info`, except for `title` and `caption`, will be ignored.**

- 忽略范围被明确限定在 **`post_info` 内部**；
- `is_ai_generated` 在 `post_info` **之外** → 按文本**不在**忽略范围内；
- 但文档也没有正面说「draft 模式下 `is_ai_generated` 会保留」→ ⚠️ 文档未明确 + 🧪。

对比视频：视频的 `upload_to_draft` 是「`post_info` 内所有字段都忽略」，而 AI 字段恰好在 `post_info` 内，所以视频 draft 是明确失效；图片 draft 则是明确**没有**被那条条款覆盖。这个不对称必须写进实现注释，否则下一个维护者会以为「draft 一律忽略 AI」。

### 4.5 代码落点（供 06 使用）

- `libraries/nestjs-libraries/src/integrations/social/tiktok.business.provider.ts`
  - `buildVideoBody()` ≈ 560–619：`post_info.is_ai_generated` 在 587–589（非 draft 分支），位置正确，**无需改动**（除非要改成「仅 true 发送」）。
  - `buildPhotoBody()` ≈ 636–695：返回对象是 `{ business_id, photo_images, photo_cover_index, post_info }`，需要新增**顶层** `is_ai_generated`（仅 `true` 时）。
  - 注意：`buildPhotoBody` 当前是 `async`（因为要 `pickRandomMusicId`），加字段不影响签名。

---

## 5. 推荐：四个 provider 一律「仅 `true` 时发送，`false`/未设置则省略」

### 5.1 结论

| Provider | 视频/图片 | 发送策略 |
|---|---|---|
| Instagram（两种登录） | 全部支持的类型 | 仅 `true` 发送（省略即无标签） |
| TikTok legacy | 视频 DIRECT_POST | 仅 `true` 发送 |
| TikTok legacy | 图片（两种 post_mode） | 仅 `true` 发送 |
| TikTok Business | 视频 | 仅 `true` 发送（文档允许 `false`，但没有收益） |
| TikTok Business | 图片 | **必须**仅 `true` 发送（`false` 非支持值） |

### 5.2 理由

1. **Business 图片把「只发 `true`」变成硬约束。** 文档写的是 "Supported value: `true`. Omit this field if you do not want to enable the setting."。如果为了「视频发 false、图片不发」做分叉，代码里会长期存在一个「同一 provider 两种布尔约定」的陷阱；统一成「true 才发」后，这个分叉自动消失。
2. **其余三处，`false` 的语义要么没写、要么等价于省略。**
   - IG：S2/S3 只说 `set … to true`；S1 的类型是 `TRUE_OR_FALSE` 但没有任何 `false` 行为描述；
   - TikTok legacy 视频/图片：文档只写 "Set to `true` if …"，bool 默认就是不打标。
   发 `false` 唯一新增的东西是**多一个可能被平台判为非法的参数**，而收益为零。
3. **IG 对参数校验是「报错型」而不是「忽略型」。** 同一个参数在 carousel children 上会直接 error（S2）。在这种平台上发一个语义未定义的 `false` 风险不对称：成功没有额外收益，失败会让整条发布挂掉。
4. **「省略」是文档给的标准关闭方式。** Business 图片原文就是 "Omit this field if you do not want to enable the setting"；其它三处省略等价于默认不启用。
5. **少一个网络字段 = 少一个版本兼容面。** 未来某个 API 版本把默认值改成「继承账号设置」时，显式 `false` 反而会覆盖平台默认；省略更稳。

### 5.3 反面意见（记录，不采纳）

- 「显式 `false` 表达用户意图更准确」：对 Business 视频成立（文档确实支持 `false`），但另外三处都不成立；为一致性放弃它更好。
- 「发 `false` 可以防止平台把上一次的状态带过来」：文档没有任何「状态粘连」描述；Business 视频默认值明确是 `false`。

### 5.4 DTO 层建议

- 保留现有 `video_made_with_ai?: boolean`（`@IsOptional()`），**不要**改成三态；`undefined` 与 `false` 在发送层合并为「不发」。
- 若要支持「用户明确要求关闭」，那是 UI 的默认状态（复选框未勾），不需要发字段。
- **不要**给 IG 复用 `video_made_with_ai` 这个名字（它现在语义是「视频」）；建议新增独立的 `is_ai_generated`（或 `made_with_ai`）字段，避免 TikTok 的「视频专属」历史语义污染 IG 的「图片/视频/Story 通用」语义。

---

## 6. 平台不支持的媒体类型：省略还是报错？

### 6.1 事实清单

| 场景 | 平台行为 | 证据 | provider 应该怎么做 |
|---|---|---|---|
| IG carousel 子项 | **报错**（"will result in an error"） | ✅ S2 | 绝不发送；值放父容器 |
| IG Story | 文档未明确 | ⚠️/🧪 | 先实测；未确认前 UI 隐藏 |
| IG 单视频 / Reel | 文档未明确排除，推定支持 | ⚠️ | 发送；若实测报错则退回省略 |
| TikTok legacy 视频 UPLOAD | endpoint 没有 `post_info` | ✅ S7 | 不发送（发不出去）；UI 隐藏 |
| TikTok legacy 图片 MEDIA_UPLOAD | 文档未明确 | ⚠️/🧪 | 发送；实测确认是否生效 |
| TikTok Business 视频 draft | `post_info` 全部被忽略 | ✅ S9 | 不发送；UI 隐藏 |
| TikTok Business 图片 draft | 顶层字段不在忽略范围 | ⚠️/🧪 | 发送；实测确认 |

### 6.2 建议：provider 层「省略」，UI 层「不显示/禁用」，都不要抛错

理由：

1. **AI 披露是「标签」，不是内容本身。** 因为平台少一个字段就让整条帖子发布失败，代价远大于少一个标签。
2. **但也不能静默丢弃。** handoff §5.7 已经把「UI 不能静默丢弃」定为决策：用户能看到开关 ⇔ provider 一定会发送。实现方式是在 **UI/能力层**（`supportsAi` 之类的判断）就把不支持的组合挡掉，而不是在 provider 里「收了不发」。
3. **IG carousel 子项是唯一例外**：不是「不支持所以省略」，而是「放错位置会炸」，正确做法是把值移到父容器（语义上仍然生效）。
4. 如果确实需要硬失败（例如合规要求必须打标），正确位置是 `checkValidity()`（发布前、可读错误信息），**不要**在容器创建时抛 `BadBody`——那时候可能已经建了一半容器。

### 6.3 给 06 的能力判定表（事实输入）

```
supportsAiDisclosure(integration, postType, mediaKind, contentPostingMethod):
  instagram / instagram-standalone:
    - carousel            -> true  (但只在父容器发)
    - carousel child      -> n/a   (不暴露给用户)
    - single image        -> true
    - single video / reel -> true  (⚠️ 待实测确认)
    - story               -> false 直到实测确认  (⚠️)
  tiktok (legacy):
    - video + DIRECT_POST -> true
    - video + UPLOAD      -> false (无字段)
    - photo + DIRECT_POST -> true
    - photo + UPLOAD      -> true  (⚠️ 待实测确认是否打标)
  tiktok-business:
    - video + DIRECT_POST -> true
    - video + UPLOAD      -> false (post_info 被忽略)
    - photo + DIRECT_POST -> true
    - photo + UPLOAD      -> true  (⚠️ 待实测确认是否打标)
```

---

## 7. 与当前代码的偏差（只记录，不改）

| 位置 | 现状 | 与文档的偏差 |
|---|---|---|
| `instagram.provider.ts` 全文 | 没有 `is_ai_generated` | 功能缺失（两个 IG 渠道共用） |
| `tiktok.provider.ts:589-595` | 图片分支 `...(isPhoto ? {} : { is_aigc })` | 图片确实没有 `post_info.is_aigc`，但**顶层**有 `is_aigc`；当前实现等于完全没有图片 AI 能力 |
| `tiktok.provider.ts:617-625` | UPLOAD 分支返回 `{ post_info: { title } }` | inbox endpoint 的 body 只有 `source_info`，这个 `post_info` 是未定义字段（会被忽略） |
| `tiktok.business.provider.ts:587-589` | 视频 `post_info.is_ai_generated` 在非 draft 分支 | ✅ 与文档一致 |
| `tiktok.business.provider.ts:653-694` | 图片 body 无顶层 `is_ai_generated` | 功能缺失 |
| `tiktok.dto.ts:136-140` | 描述「TikTok has no AI-generated label for photo posts」 | **错误**（旧信息）。legacy 图片有顶层 `is_aigc`，Business 图片有顶层 `is_ai_generated` |
| `tiktok.dto.ts:61-66` | 注释「photo post_info has no is_aigc」 | 字面正确但误导：字段在 `post_info` 外，读者会以为图片不支持 |
| `tiktok.provider.ts:32-33` / `tiktok.business.provider.ts:29-30`（`@Rules`） | 「video_made_with_ai … photo posts 没有对应字段」 | 同上，需要改写（这会影响 chat/LLM 的行为） |

---

## 8. 需要实测的清单（按优先级）

| # | 问题 | 建议验证方式 | 失败时的降级 |
|---|---|---|---|
| T1 | IG Story 是否接受 `is_ai_generated=true` | 用测试账号建 `media_type=STORIES` 容器带该参数，**不发布**，看返回是 `id` 还是 error；容器 24h 自动过期 | Story 隐藏开关 |
| T2 | IG Reel / 单视频是否接受 | 同上，`media_type=REELS` | Reel 隐藏开关 |
| T3 | IG 是否接受 `is_ai_generated=false` | 同上，传 `false`，看是否 `invalid_param` | 省略（本来推荐就是省略） |
| T4 | IG carousel 子项传该参数的错误码/文案 | 建 `is_carousel_item=true` 容器带参数，记录 error code（可用于 `handleErrors` 归类） | 不需要降级，只是确认 |
| T5 | TikTok legacy 图片 MEDIA_UPLOAD 是否保留 `is_aigc` | 上传草稿 → 手机 App 完成发布 → 看描述里是否有 AI 标签 | UI 在 UPLOAD 下隐藏 |
| T6 | TikTok Business 图片 draft 是否保留顶层 `is_ai_generated` | 同上 | UI 在 UPLOAD 下隐藏 |
| T7 | TikTok Business 图片 `is_ai_generated=false` 是否报错 | 传 `false` 发一条（可用 draft 降低影响面） | 省略（本来推荐） |
| T8 | TikTok legacy 视频 UPLOAD 附带 `post_info` 是否报错 | 可选；实现上不依赖 | 不发送 |

T1–T4 成本最低：IG 的验证**不需要真的发布**，建容器即可看到参数校验结果。

---

## 9. 明确「查过但文档没写」的问题

1. **IG Story 的 AI 披露**：查过 S1（IG User Media 参考）、S2（Content Publishing 指南的 AI Content 小节）、S3（Changelog 2026-06-22）、S4（IG Media 字段）、S5（IG Container 字段）。五处都没有 Story 的支持或排除语句。**文档未明确。**
2. **IG Reel / 单视频的 AI 披露**：同上五处，只有「carousel children 不支持」这一条排除。**文档未明确（推定支持）。**
3. **IG `is_ai_generated=false` 的行为**：S1 给的类型是 `TRUE_OR_FALSE`，但没有任何一句描述 `false` 会发生什么（无标签？报错？）。**文档未明确。**
4. **TikTok legacy 图片 MEDIA_UPLOAD 的 `is_aigc`**：S8 只给了顶层字段定义，Upload 示例里没带；字段不在 `post_info` 内，所以「Only works for DIRECT_POST」的限定管不到它，但也没有正面说明。**文档未明确。**
5. **TikTok Business 图片 draft 的顶层 `is_ai_generated`**：S10 的 `is_draft` 只声明忽略 `post_info` 内除 title/caption 外的字段；顶层字段没有说明。**文档未明确。**
6. **TikTok Business 图片传 `is_ai_generated=false`**：S10 只写 "Supported value: `true`"，没有写 `false` 会怎样（拒绝 / 忽略）。**文档未明确。**
7. **TikTok legacy 视频 UPLOAD 附带的 `post_info`**：S7 的 body 表没有 `post_info`，属于 schema 未定义字段；平台是忽略还是报错，文档没写。**文档未明确。**
8. **AI 标签是否可撤销**：Business 两处都写 "can't be changed"；IG 未写（只写了读侧字段）。不据此做任何实现假设。

---

## 10. 一页速查（给实现者）

```
IG (instagram + instagram-standalone)
  POST /<IG_ID>/media?is_ai_generated=true
    - 单图 / 单视频 / Reel / Story : 直接加在唯一容器上（Story 待实测）
    - Carousel                     : 只加在 finalizePost() 的父容器上
    - Carousel child               : 绝不加（会报错）

TikTok legacy (tiktok)
  video DIRECT_POST : body.post_info.is_aigc = true
  video UPLOAD      : （无字段，不要发）
  photo 任何模式     : body.is_aigc = true        <-- 顶层，和 post_mode 同级

TikTok Business (tiktok-business)
  video DIRECT      : body.post_info.is_ai_generated = true
  video draft       : （post_info 全被忽略，不要发）
  photo DIRECT      : body.is_ai_generated = true  <-- 顶层，和 post_info 同级
  photo draft       : body.is_ai_generated = true  <-- 顶层，未被 is_draft 的忽略条款覆盖（待实测）

通用规则
  - 只在 true 时发送；false / undefined 一律省略
  - 不支持的组合在 UI/能力层隐藏，不在 provider 里静默吞掉
  - provider 不因平台缺字段而抛错；确需硬失败时放 checkValidity()
```
