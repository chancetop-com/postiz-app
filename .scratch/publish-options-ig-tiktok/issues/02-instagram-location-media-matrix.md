# Instagram Location 在哪些媒体类型上生效？

Type: research
Status: resolved
Blocked by: —

## Question

核实 Instagram (Facebook Business) `location_id` 的可用范围，逐项给出「发送 / 不发送 / 文档未明确」及来源：

- 单图
- 单视频
- Reel
- Story
- Carousel 子项
- Carousel 父容器（用户表格里这一格为空，需要定案）

同时确认：

1. `location_id` 与 `is_ai_generated` 能否同时出现在同一个 container 请求里。
2. Carousel 父容器走哪个端点（`/media` + `media_type=CAROUSEL`），`location_id` 是否是该端点的合法参数。
3. 如果父容器不支持，是否只能退化为「多图帖不提供 Location」。

产出：`.scratch/publish-options-ig-tiktok/research/02-instagram-location-media-matrix.md`，并在本票 `## Answer` 里给出结论与来源链接。

## Answer

### 矩阵（Instagram API with Facebook Login，`graph.facebook.com`）

| 媒体类型 | `location_id` | 定级 | 依据 |
|---|---|---|---|
| 单图 | ✅ 发送 | 官方文档写明 | Image Containers 请求语法含 `&location_id=<LOCATION_PAGE_ID>` |
| 单视频（`media_type=VIDEO`） | ✅ 发送 | 官方文档可推定 | 参数说明写 "the image **or video**"；但无 VIDEO 单媒体语法示例（Postiz 实际把单视频发成 `REELS`，见下） |
| Reel | ✅ 发送 | 官方文档写明 | Reel Containers（standard + resumable）语法都含 `location_id` |
| Story | ❌ 不发送 | **文档未明确**（强烈暗示不支持） | Story 容器语法不含该参数；Story Limitations: "Publishing stickers (i.e., link, poll, location) is not supported"；但无 "`location_id` not supported on stories" 的明文 |
| Carousel 子项 | ❌ 不发送 | 官方文档写明不支持 | "**Not supported on images or videos in carousels.**" |
| **Carousel 父容器** | **✅ 发送** | **官方文档写明** | Carousel Containers 请求语法显式含 `&location_id=<LOCATION_PAGE_ID>`（`media_type=CAROUSEL` + `children`） |

> 定级说明：单视频之所以只是"可推定"，是因为文档没有 `media_type=VIDEO` 的单媒体容器语法示例，且 `media_type` 参数表的枚举里漏了 `VIDEO`（Content Publishing 指南又明确要求视频用 `VIDEO`）。对 Postiz 无实际影响：`postPending()` 对单媒体 mp4 一律发 `media_type=REELS`（`instagram.provider.ts:771-781`）。

### 1. Carousel 父容器的定案（表格空格）

**支持，发送。** `location_id` 不是"整个 carousel 帖"的禁忌，那句 "Not supported on images or videos in carousels" 限定的是 `is_carousel_item=true` 的**子容器**；父容器是 `media_type=CAROUSEL` 的 carousel container，既不是 image 也不是 video，且官方语法主动列出了该参数。同类的"post 级参数只放父容器"先例：`is_ai_generated`、`poll_attachment`（"set it on the carousel container instead"）、`collaborators`。

### 2. `location_id` 与 `is_ai_generated` 能否同请求

**能。** 两者是同一端点 `POST /<IG_ID>/media` 的同级 query 参数，文档未声明任何互斥；文档对真正互斥的参数会显式标注（如 `poll_attachment` ↔ `is_comment_prompt_used`），而这两者都没有。`is_ai_generated` 的唯一限制是 "Not available for carousel children"。
定级：**文档未明确写可组合、但可推定允许**，建议上线前实测一次（单图 + 两者同请求）。Carousel 场景两者都放父容器那一次请求里，因此也自然共存。

### 3. 父容器端点与参数合法性

`POST https://graph.facebook.com/v27.0/<IG_ID>/media?media_type=CAROUSEL&children=<ids>&caption=...&location_id=...&is_ai_generated=...&access_token=...` → 拿到 carousel container id → `POST /<IG_ID>/media_publish?creation_id=<id>`。
`location_id` **是**该端点的合法参数（官方 Carousel Containers 语法显式列出）。`ig-container` 节点只读，容器创建后不能补 location，必须重建。

### 4. 若父容器不支持（预案，本次不适用）

退化为"多图帖整体不提供 Location"，UI 隐藏/禁用。**绝不能**把 `location_id` 下放到 carousel 子项（文档明确不支持，可能直接报错）。

### 5. 实现要点

- 门控应为：`!isStory && media.length === 1` → 单媒体容器带 `location_id`；carousel 父容器（`finalizePost()` `:994-1021`）带 `location_id`；Story 与 carousel 子项不带。
- Story 判定要用 `isStory`（`post_type === 'story'`），**不能**用 `postType`：单条 Story 的 `postType` 是 `'single'`。
- `pendingData`（`:857-874`）目前不带 location，需新增字段传给 `finalizePost()`。
- `location_id` 必须是**带 location 数据的 Facebook Page ID**，否则报 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`；前端搜索需按 `location` 字段过滤。发布后**不能**用 IG Media 回读 location（`location`/`location_name` 被列为不支持字段，见 01 的交叉核对）；验收以「建容器成功 + Instagram 客户端人工确认」为准。
- `instagram-standalone`（`graph.instagram.com`）不发送：官方未单列该参数的可用性（"文档未明确"），但该 API "cannot access ads or tagging" 且不要求/不保证有 Facebook Page，`location_id` 是 Page ID，无来源可取。

### 来源

- IG User Media（`location_id` 参数、各容器请求语法、Story Limitations）：
  https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- Content Publishing（carousel 容器、AI Content、`media_type=VIDEO`）：
  https://developers.facebook.com/documentation/instagram-platform/content-publishing
- IG Container（只读，无创建/更新）：
  https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container
- IG Media（`location` / `location_name` 回读字段）：
  https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
- Instagram API with Instagram Login（"cannot access ads or tagging"）：
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
- Pages Search API（location 搜索）：
  https://developers.facebook.com/documentation/pages-api/search-pages

完整论证、逐条原文引用、待实测清单与文档矛盾点：
`.scratch/publish-options-ig-tiktok/research/02-instagram-location-media-matrix.md`
