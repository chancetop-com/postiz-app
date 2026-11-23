# 02 — Instagram `location_id` 媒体类型矩阵

- 票据：`.scratch/publish-options-ig-tiktok/issues/02-instagram-location-media-matrix.md`
- 调研日期：2026-11-23
- 范围：Instagram API with **Facebook Login**（`graph.facebook.com`，Postiz 的 `instagram` 渠道）
- 只采信一手来源：Meta 官方 Instagram Platform 文档（下表列出抓取到的具体页面与章节）
- 文档版本：页面当前标注的最新 Graph API 版本为 **v27.0**

## 0. 结论速查

| 媒体类型 | 是否发送 `location_id` | 定级 | 一句话依据 |
|---|---|---|---|
| 单图 | ✅ 发送 | **A 官方文档写明** | Image Containers 请求语法显式含 `location_id` |
| 单视频（Feed `media_type=VIDEO`） | ✅ 发送 | **B 文档可推定** | 参数说明写的是 "the image **or video**"；但文档没有 VIDEO 单媒体容器的请求语法示例 |
| Reel（`media_type=REELS`） | ✅ 发送 | **A 官方文档写明** | Reel Containers 的 standard 与 resumable 两段语法都含 `location_id` |
| Story（`media_type=STORIES`） | ❌ 不发送 | **C 文档未明确（强烈暗示不支持）** | Story 两种容器的请求语法都不含该参数；Story Limitations 写 location 贴纸不支持；但没有一句 "`location_id` not supported on stories" |
| Carousel 子项 | ❌ 不发送 | **D 官方文档写明不支持** | "Not supported on images or videos in carousels." |
| **Carousel 父容器** | **✅ 发送** | **A 官方文档写明** | **Carousel Containers 请求语法显式含 `location_id=<LOCATION_PAGE_ID>`** |

定级说明：

- **A**：官方文档有请求语法或明确文字直接支持。
- **B**：官方文档的参数级描述涵盖了该场景，但缺少该媒体类型的请求语法示例。
- **C**：官方文档既没有列为支持、也没有明确禁止 → 必须实测。
- **D**：官方文档明确写不支持 / 明确写会报错。

同时回答票据的两个附加问题：

1. **`location_id` + `is_ai_generated` 可以出现在同一个 container 请求里。** 两者都是 `POST /<IG_ID>/media` 的文档化 query string 参数，文档没有声明任何互斥；文档对真正互斥的参数（如 `poll_attachment` vs `is_comment_prompt_used`）都会显式标注"不能组合"。定级 **B**（可推定允许），建议上线前做一次实测。
2. **Carousel 父容器走 `POST https://graph.facebook.com/v27.0/<IG_ID>/media`，`media_type=CAROUSEL` + `children=<ids>`，`location_id` 是该端点的合法参数。** 见第 4 节。
3. **父容器是支持的**，所以不需要退化成"多图帖不提供 Location"。但如果实测发现父容器传 `location_id` 被拒，退路是"多图帖不提供 Location"（**绝不能**改放到子项上，见第 5 节）。

---

## 1. 一手来源清单

| # | 页面 | URL | 抓取到的关键内容 |
|---|---|---|---|
| S1 | IG User Media（创建容器） | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media | 各类容器的请求语法、Query String Parameters 表、Story Limitations |
| S2 | Content Publishing 指南 | https://developers.facebook.com/documentation/instagram-platform/content-publishing | carousel 容器创建步骤、AI Content 章节、`media_type=VIDEO` 说明 |
| S3 | IG Container 参考 | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container | container 只有 `status_code` 等读字段，无写能力 |
| S4 | IG Media 参考 | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media | 读侧字段清单；`location` / `location_name` 被列为不支持，**不能**用于发布后回读（01 交叉核对） |
| S5 | Instagram API with Instagram Login | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login | "This API setup cannot access ads or tagging."；"does not require a Facebook Page to be linked" |
| S6 | Changelog | https://developers.facebook.com/documentation/instagram-platform/changelog | 2018-03-13：Content Publishing API 首次支持在**发照片**时 tag locations |

> 说明：S1/S2 的 `.md` 原始版本也用 `curl` 抓过一遍做交叉核对（避免 HTML 渲染漏段），结论一致。

---

## 2. 逐媒体类型论证

### 2.1 单图 — ✅ 发送（A）

S1 的 **Image Containers** 请求语法：

```
POST https://graph.facebook.com/v27.0/<YOUR_APP_USERS_IG_USER_ID>/media
?image_url=<IMAGE_URL>
&is_carousel_item=<TRUE_OR_FALSE>
&alt_text=<IMAGE_ALTERNATIVE_TEXT>
&caption=<IMAGE_CAPTION>
&location_id=<LOCATION_PAGE_ID>
&user_tags=<ARRAY_OF_USERS_FOR_TAGGING>>
&product_tags=<ARRAY_OF_PRODUCTS_FOR_TAGGING>
&access_token=<USER_ACCESS_TOKEN>
```

`location_id` 是文档列举的 image container 参数。注意这一段语法块同时包含 `is_carousel_item`，也就是说"单图"和"carousel 子图"用的是同一段语法 —— 真正的区分靠参数表里的那句限制（见 2.5）。

### 2.2 单视频（Feed video，`media_type=VIDEO`）— ✅ 发送（B）

有两处证据，但没有一处是"VIDEO 容器的请求语法示例"：

1. S1 参数表 `location_id` 的描述写的是：**"The ID of a Page associated with a location that you want to tag the image or video with."** —— 明确涵盖 video。
2. S2 的 "Create a container" 一节写：**"`media_type` — If the container will be for a video, set to `VIDEO`, `REELS`, or `STORIES`."** —— 说明 `VIDEO` 是文档化的容器类型。

但 S1 的 "Request Syntax" 只有 Image / Reel / Carousel / Image Story / Video Story 五段，**没有单独的视频容器示例**；`VIDEO` 只在 carousel 子项的 resumable 示例里出现过：

```
POST .../media
?media_type=VIDEO
&is_carousel_item=true
&upload_type=resumable
&access_token=<USER_ACCESS_TOKEN>
```

另外 S1 的 `media_type` 参数表本身有一处自相矛盾：它写 "Required for carousels, stories, and reels. ... Value can be: `CAROUSEL` / `REELS` / `STORIES`"，列表里漏了 `VIDEO`，而 S2 又明确说视频要设 `VIDEO`。

结论：按参数级描述可以发送，定级 B。**对 Postiz 而言这一行实际上用不到** —— 见下面的代码事实。

> **Postiz 代码事实**：`instagram.provider.ts` 的 `postPending()` 对"单媒体 + mp4 + 非 Story"一律发 `media_type=REELS`（约 `:771-781`），从不发 `media_type=VIDEO`。也就是说 Postiz 的"单视频"在 API 层面就是 Reel，走的是 A 级的那条路径。

### 2.3 Reel — ✅ 发送（A）

S1 的 **Reel Containers → Standard upload**：

```
POST https://graph.facebook.com/v27.0/<YOUR_APP_USERS_INSTAGRAM_USER_ID>/media
?media_type=REELS
&video_url=<REEL_URL>
&caption=<IMAGE_CAPTION>
&share_to_feed=<TRUE_OR_FALSE>
&collaborators=<COLLABORATOR_USERNAMES>
&cover_url=<COVER_URL>
&audio_name=<AUDIO_NAME>
&user_tags=<ARRAY_OF_USERS_FOR_TAGGING>>
&location_id=<LOCATION_PAGE_ID>
&thumb_offset=<THUMB_OFFSET>
&trial_params=<TRIAL_PARAM>
&access_token=<USER_ACCESS_TOKEN>
```

**Resumable upload session** 那段同样含 `&location_id=<LOCATION_PAGE_ID>`。

结论：Reel 明确支持，且与 `trial_params`（trial reel）、`audio_name`、`collaborators` 并列，没有互斥说明。

### 2.4 Story — ❌ 不发送（C）

三条证据，但没有一条是直白的禁令：

1. S1 **Image Story Containers** 语法只有 `image_url` / `media_type=STORIES` / `user_tags` / `access_token`；**Video Story Containers** 只有 `video_url` / `media_type=STORIES` / `user_tags` / `access_token`。两段都**没有** `location_id`。
2. S1 **Story Limitations** 第一条明确写：
   > "Publishing stickers (i.e., link, poll, location) is not supported; however mentioning users without a sticker is supported."
3. S1 的 `location_id` 参数描述只排除了 carousel 子项，**没有**排除 stories；全站也没有 "`location_id` not supported on stories" 这样的句子。

严格讲：**"location sticker 不支持" 说的是 App 内的贴纸，不完全等同于 container 的 `location_id` 参数**。所以这一格只能定级 C —— 文档层面"未列为支持 + 强烈暗示不支持"。

**工程判断**：不发送。如果以后要放开，必须先实测；在拿到实测结果前，Story 一律不带。

> 附带风险：`postPending()` 里"单条 Story"的 `pendingData.postType` 是 `'single'`（只有多条 Story 才是 `'stories'`）。所以**不能**用 `postType` 判断要不要跳过 location，必须用 `postType === 'stories' || firstPost.settings.post_type === 'story'` 之类的 Story 判定。代码里现有的 `isStory` 变量（`:749`）才是正确依据。

### 2.5 Carousel 子项 — ❌ 不发送（D）

S1 参数表 `location_id` 最后一句：

> **"Not supported on images or videos in carousels."**

这是全文档唯一一处对 `location_id` 的明确禁止，指向的就是 `is_carousel_item=true` 的子容器。定级 D：**文档写明不支持**，不要发。子项发这个参数属于未定义行为（可能报错，也可能被静默忽略），两种都不可接受。

注意：Image Containers / carousel 子容器的**语法块**里仍然印着 `location_id`（因为单图和子图共用同一段语法），容易误读。以参数表的那句限制为准。

### 2.6 Carousel 父容器 — ✅ 发送（A）【本票定案：空格填"支持"】

S1 的 **Carousel Containers → Standard upload**：

```
POST https://graph.facebook.com/v27.0/<YOUR_APP_USERS_INSTAGRAM_USER_ID>/media
?media_type=CAROUSEL
&caption=<IMAGE_CAPTION>
&share_to_feed=<TRUE_OR_FALSE>
&collaborators=<COLLABORATOR_USERNAMES>
&location_id=<LOCATION_PAGE_ID>
&product_tags=<ARRAY_OF_PRODUCTS_FOR_TAGGING>
&children=<ARRAY_OF_CAROUSEL_CONTAINTER_IDS>
&access_token=<USER_ACCESS_TOKEN>
```

以及 S1 在该小节前的说明：

> "Carousel containers only. To create carousel item containers, create image or video containers instead (reels are not supported)."

**为什么这不是和 "Not supported on images or videos in carousels" 矛盾：**

- 那句禁令的主语是 **"images or videos in carousels"**，即 `is_carousel_item=true` 的**子容器**；父容器是 `media_type=CAROUSEL` 的 **carousel container**，既不是 image 也不是 video 容器。
- 父容器这一层在文档里**显式列出**了 `location_id`，这是主动写入，不是省略。
- 同一套"父容器承载 post 级参数"的模式在文档里有三处平行先例：
  - `is_ai_generated`："Not available for carousel children."，S2 进一步写 "For carousels, only the carousel container needs to have the `is_ai_generated` parameter set to `true`. Setting this parameter on carousel children will result in an error."
  - `poll_attachment`："Not supported on stories or carousel children — **set it on the carousel container instead**."
  - `collaborators`：文档只写 "For Feed image, Reels and Carousels only"，Postiz 现有代码也确实是放在父容器（`finalizePost` `:1005-1009`）。

结论：**父容器支持 `location_id`，定级 A。用户表格里那一格填 ✅。**

**残余风险（必须记录）**：`location_id` 的参数描述那句 "Not supported on images or videos in carousels" 措辞偏宽，不排除服务端对"carousel 帖"整体做了额外校验。因此建议在实现后做一次真实发布验证（第 7 节）。若实测失败，按第 5 节退化。

---

## 3. `location_id` 与 `is_ai_generated` 能否同请求

**结论：可以。定级 B（文档未明确禁止，可推定允许；建议一次实测）。**

依据：

1. 两者是**同一个端点** `POST /<IG_ID>/media` 的**同级 query string 参数**，都在 S1 的 Query String Parameters 表里。
2. S1 对 `is_ai_generated` 的描述只有一句限制：**"An optional parameter to provide a self-disclosure of AI usage in the post. **Not available for carousel children**."** —— 只排除了子项，没有排除 `location_id`。
3. S2 的 "AI Content" 章节：
   > "To provide a self-disclosure of AI usage in the media, you can set `is_ai_generated` parameter to `true` when creating a media container. For carousels, only the carousel container needs to have the `is_ai_generated` parameter set to `true`. Setting this parameter on carousel children will result in an error. This parameter is available to both Instagram API with Facebook Login and Instagram Login."
   这里同样没有任何与 location 相关的排除。
4. 反证：这套文档在参数真正互斥时会**显式**写出来，例如 `poll_attachment`："**Cannot be combined with `is_comment_prompt_used`.**"；`is_comment_prompt_used` 也反向写了 "Cannot be combined with `poll_attachment`"。`location_id` 与 `is_ai_generated` 都没有这类句子。

所以：

- **单图 / 单视频（Reel）**：两个参数放同一个 container 请求，合法。
- **Carousel**：两个参数都放在**父容器**那一次请求里（`media_type=CAROUSEL`），子项两个都不放。此时它们也自然共存于同一请求。

上线前建议跑一条"单图 + location + ai"的真实发布，确认无 400。

---

## 4. Carousel 父容器的端点与参数合法性

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | `POST https://graph.facebook.com/v27.0/<IG_ID>/media` | S1 Carousel Containers |
| 必需参数 | `media_type=CAROUSEL`、`children=<逗号分隔的最多 20 个 container id>` | S1 + S2 "Create a carousel container" |
| `location_id` | **合法**，语法块显式列出 | S1 Carousel Containers |
| `is_ai_generated` | 合法（且**只应**设在这里） | S1 参数表 + S2 AI Content |
| `collaborators` | 合法，最多 3 个；"Not supported for Stories" | S1 参数表 |
| 发布 | `POST /<IG_ID>/media_publish?creation_id=<carousel container id>` | S2 "Publish the container" |

补充：`ig-container` 节点本身是只读的（S3："Creating: This operation is not supported."），所以父容器没有独立的"更新 location"接口 —— 一旦创建就不能补 location，必须重建容器。这对 Postiz 的失败重试语义有影响（现有代码用 `pendingData.carouselId` 做了幂等，如果 location 只在创建父容器时传，重试逻辑不需要改，但**不能**指望"先建父容器、再补 location"）。

---

## 5. 如果父容器不支持（本次不适用，作为退化预案）

结论是**支持**，所以不需要退化。但为了应对实测翻车或未来 API 变更，约定退化顺序：

1. 父容器 `location_id` 被拒 → **多图帖整体不提供 Location**（UI 隐藏/禁用，或发布前明确提示会忽略）。
2. **绝不能**把 `location_id` 下放到 carousel 子项：文档明确写不支持（D），可能直接报错。
3. 也不能"多图帖拆成多条单图"来保留 location —— 这会改变用户可见的帖子形态，属于产品决策，不能由 provider 偷偷做。

对应到 UI 契约（与 handoff 第 5 节第 7 条一致）：**渠道/媒体类型不支持时隐藏或禁用，不能出现用户选了但 provider 不发送。**

---

## 6. Postiz 代码映射（只记录事实，不改代码）

文件：`libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`

### 6.1 `postPending()`（`:740`）— 每个媒体一个容器

- `isStory` 判定在 `:749`，来源是 `firstPost.settings.post_type === 'story'`。
- 单媒体容器在 `:835-842` 创建：`POST https://${type}/<ver>/<id>/media?...`。
- 现有的参数拼装习惯：`mediaType`（`:771-789`）、`altText`（`:793-796`，已按 "images only / not video / not story" 做了门控，可作为 location 门控的写法模板）、`trialParams`（`:798-805`）、`itemCollaborators`（`:809-810`，**只在 `media.length === 1` 时携带**，这正是 carousel 子项排除的现成范式）、`audioConfiguration`（`:814-833`，同样的 `media.length === 1 && !isStory && type === 'graph.facebook.com'` 门控）。
- `pendingData` 在 `:857-874`：目前只带 `type` / `postType` / `containers` / `message` / `collaborators`。**父容器需要的 location 与 ai 必须在这里加字段带过去**，否则 `finalizePost()` 拿不到。
- `postType` 计算在 `:859-864`：`isStory && medias.length > 1 → 'stories'`，`medias.length === 1 → 'single'`，否则 `'carousel'`。**单条 Story 会落成 `'single'`**，所以判断 Story 要用 `isStory` 而不能只看 `postType`。

### 6.2 `finalizePost()`（`:938`）— carousel 父容器

- 父容器在 `:994-1021` 创建：

```
POST https://${type}/<ver>/${igId}/media
  ?caption=<message>
  &media_type=CAROUSEL
  &children=<containers.join(',')>
  [&collaborators=<json>]
  &access_token=<token>
```

- 当前**没有** `location_id`，也**没有** `is_ai_generated`。这两者要加在这里。
- 注意参数顺序无影响，但 `caption` 已经用 `encodeURIComponent`，`children` 也是；新的 `location_id` 是纯数字 ID，不需要编码。
- Story 分支在 `:954-992`（逐条 `media_publish`），**不应**携带 location。
- 单媒体/父容器发布都在 `:1023-1065`，用 `creationId` 统一。

### 6.3 与本次结论的对应

| 代码位置 | 应发送 location_id？ | 备注 |
|---|---|---|
| `:835-842` 单媒体容器，`!isStory && media.length === 1` | ✅ | 单图/单视频（实际是 REELS） |
| `:835-842` carousel 子项（`media.length > 1`） | ❌ | 文档 D 级禁止 |
| `:835-842` Story 容器（`isStory`） | ❌ | 文档 C 级，按不支持处理 |
| `:998-1015` carousel 父容器 | ✅ | 文档 A 级；且要为 `pendingData` 增加承载字段 |
| `instagram.standalone.provider.ts`（`graph.instagram.com`） | ❌ | 见第 8 节 |

---

## 7. 仍需实测的项

按优先级排序。实测建议用 `--no-publish` 之外的单独测试账号，逐条建容器（建容器不会发帖，容器 24h 过期，成本低）：

| # | 待测 | 预期 | 失败时的动作 |
|---|---|---|---|
| T1 | 单图 container + `location_id` → 建容器成功 → publish → 在 Instagram 客户端人工确认 location tag | 客户端显示该 Page 的 location | 检查 Page 是否有 location 数据（见下） |
| T2 | **carousel 父容器** + `location_id` + `children` → publish → 在 Instagram 客户端人工确认 | location 生效 | 退化到"多图帖不提供 Location"（第 5 节） |
| T3 | 单图 container + `location_id` + `is_ai_generated=true` 同一请求 | 成功，两个都生效 | 拆成两次请求是**不可行**的（容器只能建一次），需重新评估 |
| T4 | carousel 父容器 + `location_id` + `is_ai_generated=true` | 成功 | 优先级：AI 披露 > Location（合规优先），location 退化 |
| T5 | Story container + `location_id` | 预期失败/被忽略 | 若意外成功，再决定是否放开 Story |
| T6 | carousel 子项 + `location_id` | 预期失败/被忽略 | 无论如何都不发 |

前置条件（很容易踩坑）：`location_id` **必须是有 location 数据的 Facebook Page ID**。S1 原文：

> "Use the Pages Search API to search for Pages whose names match a search string, then parse the results to identify any Pages that have been created for a physical location. Include the `location` field in your query and verify that the Page you want to use has location data. Attempting to create a container using a Page that has no location data will fail with coded exception `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`."

也就是说前端做 location 搜索时，候选列表必须过滤 `location` 字段为空的 Page，否则用户选中后会得到一个 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` 错误。Pages Search API：https://developers.facebook.com/documentation/pages-api/search-pages

验收方式：IG Media 不支持回读 location（S4 将 `location` / `location_name` 列为不支持字段），以「建容器成功 + Instagram 客户端人工确认」为准（见 01 §1.3/§12）。

---

## 8. 附：Instagram Login（`instagram-standalone`）为什么没有 location

这一格不在本票的媒体矩阵里，但 handoff 第 3 节把它标成"❌ 不支持"，这里补一下证据边界：

- S5 明确写：**"This API setup cannot access ads or tagging."** 以及 **"This API setup does not require a Facebook Page to be linked to the Instagram professional account."**
- `location_id` 的定义是 **"The ID of a Page associated with a location"** —— 它本质上是 Facebook Page ID。
- 但文档**没有**一句 "`location_id` is not supported with Instagram Login"。作为对比，S2 在 AI Content 一节主动写了 "This parameter is available to both Instagram API with Facebook Login and Instagram Login." —— 说明文档在需要区分登录方式时是会明说的，而 `location_id` 没有这类说明。

定级：**文档未明确（推理为不可用）**。工程结论不变：`instagram-standalone` 不发 `location_id`。如果要写进文档，措辞用"API 无 Page 上下文，无法提供 Page ID；官方未单列该参数在 Instagram Login 下的可用性"。

---

## 9. 查过但没找到 / 文档本身的坑

**查过但未找到支持性文字：**

- S1 的 "Request Syntax" 没有 **Video Containers**（单媒体 `media_type=VIDEO`）这一段 —— 所以单视频只能定级 B。
- S1 全篇没有 "`location_id` not supported on stories"。
- S2（Content Publishing 指南）**整页没有任何 "location" 字样**（`curl` + `grep -i location` 零命中）。位置功能只记录在 S1 的参数表和请求语法里。
- S6 的 2018-03-13 changelog 仍链向 `content-publishing#publish-with-locations`，但该锚点/章节在现版 S2 中**已不存在**（死链）。历史上下文：location 最早只支持**发照片**时 tag。

**文档自身的矛盾/易误读点（实现时注意）：**

1. `media_type` 参数表（S1）漏列 `VIDEO`，但 S2 明确要求视频用 `VIDEO`。
2. Image Containers 语法块含 `location_id`，但参数表说 carousel 子项不支持 —— 因为单图与子图共用同一段语法，**以参数表的限制为准**。
3. `location_id` 的限制句 "Not supported on images or videos in carousels" 字面上可以读成"整个 carousel 帖都不支持"，但 Carousel Containers 语法块显式列了 `location_id`，且父容器既不是 image 也不是 video。判读为"仅子项不支持"。
4. `is_ai_generated` 的 Story 可用性同样没有明确说明（Story 语法块也没列它），本票不定案，另开票据时需实测。

---

## 10. 对实现的一句话建议

- Facebook Login（`graph.facebook.com`）：**单媒体（非 Story）+ carousel 父容器**发送 `location_id`；**Story 与 carousel 子项**不发送。
- `pendingData` 需要新增承载字段（如 `locationId`），因为父容器在 `finalizePost()` 才创建。
- 前端 location 选择器只列有 `location` 数据的 Page；Story / carousel 场景按"整体帖"判断，而不是按单张图判断。
- Standalone（`graph.instagram.com`）整条链路不显示 location。
