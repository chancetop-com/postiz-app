# 01 — Instagram Location 的 `location_id` 从哪来？

- 票据：`.scratch/publish-options-ig-tiktok/issues/01-instagram-location-source.md`
- 调研日期：2026-11-23
- 范围：Instagram API with **Facebook Login**（`graph.facebook.com`，Postiz 的 `instagram` 渠道）与 Instagram API with **Instagram Login**（`graph.instagram.com`，Postiz 的 `instagram-standalone`）
- 方法：只查 Meta 官方开发者文档；每个结论附 URL。结论按「官方写明 / 文档可推定 / 文档未明确 / 需实测」标注
- 文档版本：当前页面标注的最新 Graph API 版本为 **v27.0**

定级沿用同目录 `02-instagram-location-media-matrix.md` 的约定：

- **A 官方写明**：文档有明确文字或请求语法直接支持。
- **B 文档可推定**：参数级描述覆盖了该场景，但没有该场景的完整示例。
- **C 文档未明确**：文档既没列为支持、也没明确禁止 → 必须实测。
- **D 官方写明不支持**：明确写不支持或明确写会报错。

---

## 0. 结论速查

| # | 问题 | 结论 | 定级 |
|---|---|---|---|
| 1 | Postiz 现有 Facebook Login app 能否搜索地点并拿到可发布的 `location_id`？ | **有条件地能**。端点存在；Postiz 存的 **user token** 就是搜索所需 token。但生产环境能否对「非 app 角色用户 + 任意 Page」返回结果，取决于 App Dashboard 的 **Page Public Metadata Access（PPMA）或 Page Public Content Access（PPCA）** feature 审批，或用户对目标 Page 的关系。代码里看不出来，必须查 App Dashboard + 实测。 | B / C |
| 2 | 搜索端点是什么？ | `GET https://graph.facebook.com/pages/search?q=<关键词>&fields=id,name,location,link&access_token=<USER_TOKEN>`。旧的 `GET /search?type=place` 已废弃。 | A |
| 3 | 需要什么权限 / App Review？ | **user token 路径**：Search Pages 文档没有列任何 permission，只说 user access token + app secret。**app token 路径**：需要 PPMA 或 PPCA feature，两者都要求 App Review + Business Verification。两处口径不完全一致；保守做法是不把搜索当唯一入口。 | A（两条路径各自写明）/ C（user token 是否仍需 feature） |
| 4 | 返回哪些字段？ | `id`、`name`、`location`（city/country/latitude/longitude/state/street/zip）、`link`、`is_unclaimed`、`is_eligible_for_branded_content`、`verification_status`。搜索结果里的 `id` 就是可用的 `location_id`。 | A |
| 5 | 分页与限流？ | 分页/`limit` 官方未文档化（只展示 `data` 数组）。限流按 **Pages API + user token → Platform Rate Limits**；被限流时错误码 `32`（Page calls made with a User access token），另有 `4` / `17`。 | A（限流）/ C（分页） |
| 6 | 搜索不可用时只能手填 Page ID？如何校验？ | 可以手填；校验用 `GET /{page-id}?fields=id,name,location,link`，有 `location` 即有地点数据。但**非本人管理的 Page**，读 Page 需要 PPCA/PPMA；没有 feature 时只能靠「创建 IG 容器」兜底，失败为 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`。发布后**不能**回读 location。 | A / B |
| 7 | 只接受与 IG 账号绑定的 Page，还是任意 place page？ | 官方只要求「a Page associated with a location」且「has location data」，**没有要求必须是 IG 账号绑定的那个 Page**；也没有写需要对 location Page 有角色。任意带 location 数据的 Page 都符合参数定义；隐藏的角色限制需实测。 | B / C |
| 8 | Instagram Login（Standalone）是否完全不可用？ | **对 location 不可用**。官方写明 "This API setup cannot access ads or tagging."；Instagram Login 不要求、也不使用 Facebook Page，而 `location_id` 是 Facebook Page ID；Page 节点仅 Facebook Login 可用；host 是 `graph.instagram.com`。 | A（限制句）/ B（逐参数未列） |
| 9 | 失败模式？ | 权限 `10` / `200-299`；token `190` / `102`；无结果 `data: []`；ID 无效 `100`；无 location 数据 → `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`；限流 `32` / `4` / `17`；Story 不支持；carousel 子项不支持。详见 §6。 | A / B |

**一句话推荐**：`location_id` 存成字符串，取值用「搜索选择」优先、「手填 Page ID」兜底；**不要**把搜索作为唯一入口，也不要在发布后依赖 API 回读 location。

---

## 1. `location_id` 的官方定义与边界

### 1.1 它是 Facebook Page ID，不是 Place ID

IG User Media 的参数表原文：

> `location_id` — The ID of a [Page](https://developers.facebook.com/docs/graph-api/reference/page) associated with a location that you want to tag the image or video with.
>
> Use the [Pages Search API](https://developers.facebook.com/documentation/pages-api/search-pages) to search for Pages whose names match a search string, then parse the results to identify any Pages that have been created for a physical location. Include the `location` field in your query and verify that the Page you want to use has location data. Attempting to create a container using a Page that has no location data will fail with coded exception `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`.
>
> **Not supported on images or videos in carousels**.

来源：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media

结论（A）：

- `location_id` 的类型是 **Facebook Page ID**，不是旧的 Graph `Place` 节点 ID。
- 该 Page **必须带 location 数据**；否则建容器直接失败。
- 官方给出的唯一查找方式是 **Pages Search API**。
- 参数名叫 `location_id`，没有 `location_name` 参数（这一点和 TikTok Business 不同）。

### 1.2 支持范围（与票据 02 一致）

| 场景 | 是否发送 `location_id` | 定级 | 依据 |
|---|---|---|---|
| 单图 | ✅ | A | Image Containers 请求语法含 `location_id` |
| 单视频 / Reel | ✅ | A/B | 参数描述写 "image **or video**"；Reel 语法含该参数 |
| Carousel 父容器 | ✅ | A | Carousel Containers 语法含 `location_id` |
| Carousel 子项 | ❌ | D | "Not supported on images or videos in carousels." |
| Story | ❌ | C/D | Story 容器语法不含该参数；Story Limitations 写 "Publishing stickers (i.e., link, poll, location) is not supported" |
| Instagram Login（Standalone） | ❌ | A/B | "cannot access ads or tagging"，且不使用 Facebook Page |

注意：参数说明里的 "Not supported on images or videos in carousels" 指的是 **carousel 子项容器**；carousel **父容器**的请求语法显式包含 `location_id=<LOCATION_PAGE_ID>`。所以多图帖不是「不能加地点」，而是「只加在父容器上」。

Story 限制原文（同一页）：

> Publishing stickers (i.e., link, poll, location) is not supported; however mentioning users without a sticker is supported.

### 1.3 发布后不能回读 location（重要纠正）

同目录 `02-instagram-location-media-matrix.md` 的 S4 写「发布后可用 `location` / `location_name` 字段回读」，但当前 IG Media 参考明确把这些字段列为 **不支持**：

> **Warning:** If you are migrating from Marketing API Instagram Ads endpoints to Instagram Platform endpoints, be aware that some field names are different.
>
> The following Marketing API Instagram Ads endpoint fields are not supported:
>
> - `filter_name`
> - `location`
> - `location_name`
> - `latitude`
> - `longitude`

来源：https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media

IG Container 也没有 location 字段（只有 `copyright_check_status`、`id`、`status`、`status_code`）：

来源：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container

结论（A）：**发布后无法通过 Instagram Platform API 验证 location 是否生效**。验收只能看：

1. 建容器是否成功（失败会返回 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`）；
2. 人工在 Instagram 客户端看帖子；
3. （可选）用 Page API 验证所选 Page 本身有 `location` 数据。

> 这条会影响 02 里的 T1/T2 验收步骤：`GET /<IG_MEDIA_ID>?fields=location,location_name` 不应作为验收手段，建议改成「建容器成功 + 人工检查」或「发布前用 Page API 校验」。

---

## 2. Q1 — 能否搜索地点？端点、权限、App Review、字段、分页、限流

### 2.1 端点

官方 Search Pages 文档给的示例（注意：示例**没有**版本号前缀）：

```bash
curl -i -X GET \
  "https://graph.facebook.com/pages/search?q=Facebook
  &fields=id,name,location,link
  &access_token={access-token}"
```

来源：https://developers.facebook.com/documentation/pages-api/search-pages

- 正确端点：**`GET /pages/search`**。
- 旧端点 `GET /search?type=place` 已废弃：“The `GET /search?type=place` endpoint is deprecated in v8.0+ and in all versions on Nov. 2, 2020.”（同一页 Limitations）
- 文档说 “Returns a list of Pages that meet the query's criteria”；`q` 是关键词，`fields` 指定返回字段。

实测（有限，未带 token）：

```text
GET https://graph.facebook.com/pages/search?q=coffee&fields=id,name,location,link
→ {"error":{"message":"Authentication Error","code":190,...}}

GET https://graph.facebook.com/v27.0/pages/search?q=coffee&fields=id,name,location,link
→ {"error":{"message":"Authentication Error","code":190,...}}
```

说明（C）：两个路径都存在（都返回鉴权错误，而不是 unknown path）；但文档示例用的是**不带版本号**的 `/pages/search`。实现时建议按文档用 `/pages/search`，或者先实测版本化路径再决定。这个探测只能证明路由存在，不能证明权限行为。

### 2.2 认证：用 user token，不是 Page token

Search Pages 的 “Before You Start”：

> You will need:
> - A **User access token** and the **app secret** if the app user is logged into Facebook.
> - An **App access token** with the **Page Public Metadata Access** feature if the app user is not logged into Facebook and is searching for public Page information.
> - An **App access token** with the **Page Public Content Access** feature if the app user is not logged into Facebook and is searching Pages to conduct competitive analysis.

来源：https://developers.facebook.com/documentation/pages-api/search-pages

Postiz 的 token 结构（代码事实）：

- `instagram.provider.ts:657` 保存的是 `pageAccessToken + '___' + userAccessToken`。
- `postPending()` 在 `:747` 取 `[accessToken]`，即 **Page token**，用于建容器。
- `checkPostStatus()` 在 `:891-892` 取 `[accessToken, userToken]`，优先用 **user token** 读容器状态。

因此：

- 搜索地点必须用 **`token.split('___')[1]`（user token）**，不能用第一个 Page token。
- 这不是新问题：provider 已经在 `checkPostStatus` 里用了同一个 user token。
- 代码里目前没有 `appsecret_proof`（`social.abstract.ts` 的 `fetch` 也没有加）。Search Pages 文档提到 "app secret"，这可能指 `appsecret_proof`，也可能只是说明服务端需要 app secret；Graph API 的 `appsecret_proof` 默认是可选的，只有 App Dashboard 开启 **Require App Secret** 后才强制。定级 C（文档未说明 Postiz 这种服务端调用是否必须带 proof）。
  - https://developers.facebook.com/docs/graph-api/guides/secure-requests

### 2.3 权限与 App Review

这里有两套官方说法，需要分开看。**按端点文档的字面，最可能的情况是：Postiz 用 user token 搜索不需要新 scope、也不需要新的 App Review**；下面的 feature 文档是主要的反证，所以仍需实测。

**(a) Search Pages 端点文档（端点级）**

只列 token 类型，**没有列任何 permission**，也没有在 user token 路径上提 App Review。按字面：登录用户的 user token 就够。

**(b) PPMA / PPCA feature 文档（feature 级）**

- Page Public Metadata Access：
  > The **Page Public Metadata Access** allows your app access to the **Pages Search API** and to read public data for Pages for which you lack the `pages_read_engagement` permission and the `pages_read_user_content` permission.
  >
  > *Requires App Review.*
  >
  > - This permission or feature requires successful completion of the App Review process before your app can access live data.
  > - This permission or feature is only available with business verification.
  > - This feature is superseded by the Page Public Content Access (PPCA) feature. If your App Review submission includes PPCA, or your app has already been approved for PPCA, you cannot request this permission.

  来源：https://developers.facebook.com/docs/apps/features-reference/page-public-metadata-access

- Page Public Content Access：
  > The **Page Public Content Access** feature allows an app access to the **Pages Search API** and to read public data for Pages for which you lack the `pages_read_engagement` permission and the `pages_read_user_content` permission.
  >
  > - This permission or feature requires successful completion of the App Review process before your app can access live data.
  > - This permission or feature is only available with business verification.
  > - While you are testing your app and before you submit it for review, your app can only access content on a Page for which the following is true: The person who holds the admin role for the Page also holds an admin, developer, or tester role on the app.

  来源：https://developers.facebook.com/docs/apps/features-reference/page-public-content-access

**(c) Access Levels 文档（feature 的通用规则）**

> Features with Standard Access are only active for app users who have a role on the app.
>
> Advanced Access ... requires App Review and Business Verification.

来源：https://developers.facebook.com/documentation/development/graph-api/overview/access-levels

> 注：Features Reference 的概述还有一句 “Exceptions are Page Public Content Access and Page Public Metadata Access.”，容易被读成「无需审核」。但两者各自的详情页都明确写 **Requires App Review** + **only available with business verification**；以详情页为准。这个概述句的确切含义官方没有进一步解释，属于文档未明确。

**怎么读这个矛盾（重要）**：

- 端点文档把「登录用户的 user token」和「app token + PPMA/PPCA」并列，像是两条互斥路径：user token 不需要 feature。
- feature 文档又说 PPMA/PPCA 是「access to the Pages Search API」的开关。
- 两者可以同时成立：**PPMA/PPCA 是给 app token（未登录用户 / 服务端公共数据）用的；user token 路径不需要它**。但文档没有一句话明确说「user token 搜索不需要 PPMA/PPCA」。
- **保守结论**：代码层面可以先用 user token 调；生产上是否能对非角色用户、非本人管理的 Page 返回结果，必须实测。若失败，再走 PPMA（只做 metadata，且不能和 PPCA 同时申请）或 PPCA（要读公共帖子/评论时）。
- 这与 `02` 的结论不冲突：`02` 只讨论发送侧，不讨论搜索侧。

**Postiz 现有 scopes 与 feature 的关系**：

当前 `instagram.provider.ts:37-45`：

```ts
scopes = [
  'instagram_basic',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
];
```

- 这些是 **permissions**，不是 **features**。`PPMA` / `PPCA` 不在 `scopes` 里，也无法通过 OAuth scope 字符串申请。
- 搜索端点文档没有要求新增上述任何一个 scope。
- 因此：**不需要为了搜索新增 OAuth scope**；需要确认的是 App Dashboard → App Review → Permissions and Features 里是否已有 PPMA 或 PPCA（或确认 user token 路径实测可用）。
- 如果 app 只有 Standard Access，feature 只对 app 角色用户生效；Postiz 这类面向外部用户的生产 app 按 Access Levels 文档需要 Advanced Access。

### 2.4 返回字段

同一页的 Fields 表：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | Facebook Page ID（**直接作为 `location_id` 使用**） |
| `name` | string | Page 名称 |
| `location` | array | 物理地点；子字段 `city`、`country`、`latitude`、`longitude`、`state`、`street`、`zip`。没有地点数据的 Page 可能不返回或为空 |
| `link` | uri | Page 的 Facebook URL |
| `is_unclaimed` | boolean | 是否是自动生成但尚未被认领的 Page |
| `is_eligible_for_branded_content` | boolean | 是否可做 branded content |
| `verification_status` | string | `blue_verified` / `not_verified` |

来源：https://developers.facebook.com/documentation/pages-api/search-pages

**筛选规则（推荐）**：

- 必须带 `fields=...location...`，否则无法判断是否可发布。
- 只展示 `location` 存在且至少有 `city`/`street`/`latitude`/`longitude` 之一的结果。
- `is_unclaimed=true` 的 Page 文档没有说不能用于 IG location；但这类 Page 可能是重复的自动生成地点。**建议优先展示 `is_unclaimed=false`，不要硬性屏蔽**（这是产品推断，不是官方要求）。

### 2.5 分页与限流

**分页（C：文档未明确）**

- Search Pages 文档只展示 `data: [...]`，没有 `paging`、`limit`、`after`/`before` 的说明。
- 没有文档化的 `limit` 参数。
- 结论：不要假设有分页；先按「一次返回一页结果」实现，UI 只展示前 N 个。若需要更多，实测响应是否带 `paging.next`。

**限流（A）**

- Pages API 请求按 token 类型分：
  > Pages API requests are subject to either Platform or BUC Rate Limits, depending on the token used in the request; requests made with application or user access tokens are subject to Platform Rate Limits, while requests made with system user or page access tokens are subject to Business Use Case Rate Limits.

  来源：https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- 用 user token 搜索 → **Platform Rate Limits**（按 user 的调用计数；官方不公布具体数值）。
- 被限流的错误码：
  - `32` — “Page calls made with a User access token”（同一页的 Error Codes 表）
  - `4` — app 级限流
  - `17` — user 级限流
- 建议读取 `X-App-Usage` header 观察 `call_count` / `total_cputime` / `total_time`。

### 2.6 对「现有 app 能否」的最终判断

**能调，但不能假设对所有用户/所有地点都可用。**

- ✅ 代码层面：有 user token，有服务端，有 `pages_read_engagement` / `pages_show_list` / `business_management`，端点路径也存在。
- ⚠️ 产品层面：是否能搜索到「非本人管理的 place Page」，取决于：
  1. app 是否已获 PPMA/PPCA（或 user token 路径实测可用）；
  2. 目标 Page 是否 published/unrestricted；
  3. 搜索关键词是否命中（官方明确说 alias 搜索支持较弱、低粉丝 Page 可能不返回）。
- 官方原文（A）：
  > Alias-based searches are not strongly supported and might not return pages that have a low fan following.

  来源：https://developers.facebook.com/documentation/pages-api/search-pages

**所以：搜索只能作为增强，不能作为唯一入口。**

---

## 3. Q2 — 搜索不可用时：手填 Page ID 与校验

### 3.1 手填什么

- 让用户填 **Facebook Page 的数字 ID**（字符串）。
- 不要要求用户填 Page URL；虽然 Page 参考的 Limitations 提到 “If the page url is being used as the query input, ensure the page url is set up the following way: `facebook.com/<pageusername>`”，但文档没有给出可依赖的 URL→ID 解析端点，不作为方案。
- Page ID 是数字字符串；用 `string` 存储，避免 JS `number` 精度问题（Page ID 可能超过 `Number.MAX_SAFE_INTEGER` 的安全范围）。这是实现推断（B），不是官方要求。

### 3.2 校验端点

```text
GET https://graph.facebook.com/v27.0/{page-id}?fields=id,name,location,link&access_token=<USER_TOKEN>
```

- 有 `location` 字段（且非空）→ 该 Page 有地点数据，可以作为 `location_id`。
- 没有 `location` / 空对象 → 不要允许提交；建容器也会失败。
- `id` 返回的不是输入的 ID 或返回 `100` → ID 无效 / 不存在。
- `200` / `10` → 没有权限读这个 Page，见 3.3。

Page 参考对 `location` 字段的定义（A）：

> `location` — Location — The location of this place. Applicable to all Places.

来源：https://developers.facebook.com/docs/graph-api/reference/page/

### 3.3 关键限制：非本人管理的 Page 读不到

Page 参考的 “Public Page Data” 表（A）：

| Page 状态 | 读公共数据的 token | 读公共数据的 feature | 读 Page owned data 的 permission |
|---|---|---|---|
| Unpublished | Page token 或 User token | 无 | 无 |
| Published, Unrestricted | App token 或 User token | **PPCA 或 PPMA** | `pages_read_engagement` / `pages_read_user_content` / `pages_show_list` |
| Published, Restricted | Page token 或 User token | **PPCA 或 PPMA** | 同上 |

同一页的 Limitations（A）：

> All users requesting access to a Page using permissions must be able to perform the **MODERATE** task on the Page being queried.

来源：https://developers.facebook.com/docs/graph-api/reference/page/

这意味着：

- 如果用户管理/ moderation 这个 place Page，并且 app 有 `pages_read_engagement`，校验大概率能成功。
- 如果用户**不管理**这个 place Page，读 Page 需要 PPCA/PPMA。没有 feature 时，`GET /{page-id}?fields=location` 可能返回 `200` / `10`，而不是 `data`。
- 所以：**手填 + 前置校验不是 100% 可靠**，尤其是对任意地点。

### 3.4 最终校验只能靠建容器

IG User Media 文档明确（A）：

> Attempting to create a container using a Page that has no location data will fail with coded exception `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`.

来源：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media

因此：

- 前置校验失败（权限不足）**不应阻止用户提交**；只提示「无法预校验，发布时会由 Instagram 校验」。
- 真正权威的校验是 `POST /<IG_ID>/media` 建容器。失败不会产生已发布内容，是安全的（容器 24 小时过期，不可见）。
- 发布后无法回读 location（见 §1.3），所以必须在建容器阶段把错误映射好。

### 3.5 不要把 `/{page-id}/locations` 当成校验

- `GET /{page-id}/locations` 返回的是「父 Page 下面的子 location Pages」，不是「这个 Page 自己有没有 location」。
- 该 edge 的读取权限是 “Any valid access token is required to retrieve locations.”，但语义不同，别混用。

来源：https://developers.facebook.com/docs/graph-api/reference/page/locations

### 3.6 推荐的手填 UX

1. 输入框：`Facebook Page ID`（数字）。
2. 失焦 / 点「验证」时调用 3.2。
3. 成功：显示 Page 名称 + 地址（`location.city` / `street`），保存 `{ id, name, address? }`。
4. 无 `location`：红字「这个 Page 没有地点数据，不能用于 Instagram 地点标签」。
5. 权限错误（`200`/`10`）：黄字「无法预校验这个 Page；发布时 Instagram 会做最终校验」，仍允许保存。
6. `100`：红字「Page ID 无效或不存在」。
7. 发布失败且错误含 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`：红字「所选 Page 没有有效地点数据，请重新选择」。

---

## 4. Q3 — 必须是 IG 绑定的 Page，还是任意 place page？

### 4.1 官方怎么写

`location_id` 的定义只说（A）：

> The ID of a Page associated with a location that you want to tag the image or video with.

来源：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media

它**没有**说：

- 必须是 Instagram 账号绑定的那个 Facebook Page；
- 必须是用户管理的 Page；
- 必须是 claimed Page。

“IG 绑定的 Page”只在**发布权限 / tasks** 语境里出现：

> Your app user must be able to perform the `MANAGE` or `CREATE_CONTENT` tasks on the Page linked to their Instagram professional account.

来源：同页 Requirements

这是对「承载 IG 账号的那个 Page」的要求，不是对 `location_id` 那个 Page 的要求。

### 4.2 结论

- **按文档字面：任意带 `location` 数据的 Facebook Page 都符合 `location_id` 的定义。** 不要求与 IG 账号绑定的 Page 相同。（B：文档没有正面说“任意”，但也没有任何“必须绑定”的限制，且参数定义是独立的。）
- place Page（Facebook 自动生成的地点页）和普通 business Page（商家自己填了地址的 Page）都是 Page；区别在于有没有 `location` 数据，而不在于 Page 类型。
- 是否存在「必须对 location Page 有角色 / 必须是 claimed Page」的隐藏限制，**官方文档没有写**（C）。需要实测：
  - 用非本人管理的 place Page ID 建容器；
  - 用 `is_unclaimed=true` 的 place Page ID 建容器。

### 4.3 产品建议

- 搜索时优先展示 `is_unclaimed=false`、`verification_status=blue_verified` 的结果（更好、更稳定），但不要把 unclaimed 硬性过滤掉。
- 手填时允许任意数字 Page ID；用 3.4 的容器错误兜底。
- 如果实测发现「非本人管理的 Page 不能 tag」，再收紧为「只能选自己管理的 Page」——但这会大幅降低地点标签的可用性，先不要把产品做死。

---

## 5. Q4 — Instagram Login（Standalone）是否完全不可用？

### 5.1 官方限制

Instagram API with Instagram Login 的 Limitations（A）：

> **This API setup cannot access ads or tagging.**

来源：https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login

同一页还说：

> **Note:** This API setup does not require a Facebook Page to be linked to the Instagram professional account.

### 5.2 结构性原因

- `location_id` 是 **Facebook Page ID**（A，见 §1.1）。
- Instagram Login 的 API host 是 `graph.instagram.com`，主请求对象是 Instagram professional account ID 或 `/me`，**不使用 Facebook Page**（A）：

  > **Facebook Page**: Not required
  >
  > **API host**: `graph.instagram.com`
  >
  > **Primary request object**: Instagram professional account ID or `/me`

  来源：https://developers.facebook.com/documentation/instagram-platform/overview

- Instagram Platform 的 Page 节点明确写（A）：

  > Represents a Facebook Page.
  >
  > **Available via Facebook Login for Business only.**

  来源：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/page

- Content Publishing 的权限表里，`pages_read_engagement` 只出现在 Facebook Login 一列（A）：

  来源：https://developers.facebook.com/documentation/instagram-platform/content-publishing

### 5.3 结论

- **对 location 不可用。** 官方用 “cannot access ads or **tagging**” 一句话排除了 tagging 能力；location 标签属于 tagging；且 Instagram Login 没有 Page 对象可以承载 `location_id`。
- 定级：**A（限制句）+ B（没有逐参数写 `location_id` 不支持）**。
- 官方**没有**在 IG User Media 的 `location_id` 参数旁写 “Available for Instagram API with Facebook Login only”（对比 `is_ai_generated` 明确写了 both）。所以如果你要 100% 的逐参数证据，需要拿一个 Standalone token 实测 `POST graph.instagram.com/.../media` 带 `location_id`。但按文档的整体限制，不应实现。
- 产品决策：**`instagram-standalone` 不显示 Location 控件，provider 也不发送 `location_id`。** 如果 public API 调用方硬塞，provider 侧应按 `type === 'graph.facebook.com'` 守卫，避免发到 `graph.instagram.com`。

### 5.4 附带说明：collaborators

“cannot access ads or tagging” 里的 “tagging” 是否也排除 collaborators，是另一个问题（handoff §6.3 已列为待复核）。本票不展开；但实现时不要把「location 不可用」的结论直接外推成「collaborators 也不可用」，两者需要分别验证。

---

## 6. Q5 — 失败模式

### 6.1 总表

| 场景 | 触发点 | 官方证据 | 建议检测 | 用户可见文案 | 处理 |
|---|---|---|---|---|---|
| 缺 scope / 权限被撤销 | OAuth 连接时 / API 调用时 | Graph `10` / `200-299`：“Permission is either not granted or has been removed.”（https://developers.facebook.com/docs/graph-api/guides/error-handling） | `checkScopes`（连接时）；响应 `error.code` | “Reconnect Instagram and grant the requested Page permissions.” | 走现有 reconnect 流程；不要重试到死 |
| 搜索 feature 未获批 | 调 `/pages/search` | 文档未明确；PPMA/PPCA 文档称覆盖 Search API（见 §2.3） | 响应 `200`/`10` 或空 `data` | “Location search is unavailable for this account; enter the Facebook Page ID manually.” | 回退手填；不要把它当致命错误 |
| 搜索无结果 | `/pages/search` 返回 `{"data":[]}` | Search Pages 文档只展示 `data` 数组（https://developers.facebook.com/documentation/pages-api/search-pages） | `data.length === 0` | “No matching Pages with location data.” | 提示换关键词 / 手填 |
| 搜索结果没有 location | `data[i].location` 缺失/空 | `location` 字段是“if applicable”；`location_id` 要求有 location 数据 | 过滤 `location` | 不展示该结果 | 不要允许选中 |
| Page ID 格式错误 | 手填非数字 / 空 | Page ID 是 numeric string（Page 参考：`id` numeric string） | 前端/后端正则 | “Enter a numeric Facebook Page ID.” | 阻止提交 |
| Page ID 不存在 / 不可见 | `GET /{page-id}` | Graph `100` “Invalid parameter”（Page 参考 Error Codes） | `error.code === 100` | “Page not found or invalid.” | 阻止提交 |
| 无权限预校验 Page | `GET /{page-id}?fields=location` | Page 参考：非本人管理的 Page 需要 PPCA/PPMA；`200`/`10` | `error.code === 200/10` | “Could not pre-validate this Page; Instagram will validate it when publishing.” | **允许保存**，发布时兜底 |
| Page 没有 location 数据 | 建容器 | `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`（IG User Media） | 响应 body 含该字符串 | “This Page has no location data and cannot be used as an Instagram location.” | `bad-body`，要求重选；不要重试 |
| Page 被删除 / 合并 / 限制 | 建容器 | 文档未明确 | `100`/`200` 或同一 coded exception | “The selected Page is no longer available.” | 清空 location，要求重选 |
| Token 过期 | 任意调用 | Graph `190` / `102`；subcode `463` / `467`（https://developers.facebook.com/docs/graph-api/guides/error-handling） | 响应 `error.code` | “Reconnect Instagram.” | 现有 refresh/disconnect 流程 |
| 限流 | 搜索 / 建容器 | `32`（Page calls with User token）、`4`、`17`（https://developers.facebook.com/docs/graph-api/overview/rate-limiting） | `error.code`；`X-App-Usage` | “Too many requests; try again later.” | 指数退避 / 稍后重试 |
| Story 发 location | UI / API | Story 不支持 location sticker；Story 容器语法无该参数 | 设置层校验 | “Location is not supported on Stories.” | UI 隐藏；API 拒绝或忽略（建议拒绝，避免静默丢弃） |
| Carousel 子项发 location | 代码误加 | “Not supported on images or videos in carousels.” | 代码守卫 | — | 只加父容器；子项永远不加 |
| 发布后想验证 | 读 IG Media | `location` / `location_name` 明确不支持 | — | — | 不要实现；改为建容器成功 + 人工检查 |

### 6.2 Graph 错误码来源

- `10` / `200-299` / `190` / `102` / `4` / `17` / `32`：https://developers.facebook.com/docs/graph-api/guides/error-handling 与 https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- IG 平台错误码表（`2207xxx`）：https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes
  - 注意：该表**没有**列出 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`；这个字符串只出现在 IG User Media 的 `location_id` 参数说明里。不要假设它是一个 `error_subcode` 数字。

### 6.3 Postiz 代码现状的缺口

- `instagram.provider.ts:106` 的 `handleErrors()` 已映射大量 `2207xxx`，但**没有** `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`。
- 如果不补映射，建容器失败时可能只会得到通用错误 / 原始 body，用户不知道为什么失败。
- 建议：在 `handleErrors()` 里加一条字符串匹配，返回 `bad-body` + 明确文案；不要返回 `retry`（重试也不会变好）。

---

## 7. 最小可用方案（推荐）

### 7.1 方案分层

**Phase 1（保证可用，不依赖新 App Review）**

- UI：手填 `Facebook Page ID`。
- 校验：`GET /{page-id}?fields=id,name,location,link`，按 §3.6 处理。
- 发布：在支持的容器上加 `location_id`。
- 失败：映射 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`。
- 适用：所有用户；对「用户自己管理的 Page」前置校验最可靠；非本人管理的 Page 可能只能发布时兜底。

**Phase 2（增强，取决于 App Dashboard / 实测）**

- UI：搜索框 → `GET /pages/search?q=...&fields=id,name,location,link`（用 user token）。
- 过滤 `location` 为空的结果。
- 选中后存 `{ id, name, address? }`。
- 仍然保留手填入口（低粉丝地点可能搜不到）。
- 如果实测 `/pages/search` 对非角色用户不可用：
  - 申请 **PPMA**（只做 metadata；不能和 PPCA 同时申请），或
  - 保持 Phase 1，不做搜索。

### 7.2 为什么不是「只做搜索」

1. 搜索的 feature 要求存在文档歧义（§2.3）。
2. 官方明确说低粉丝 / alias 搜索可能不返回（§2.6）。
3. 地点 Page 可能没有 `location` 数据，搜索结果需要过滤。
4. 手填是唯一不依赖 feature 审批的路径。

### 7.3 发布侧的发送规则

| 场景 | 发送 `location_id` | 代码位置 |
|---|---|---|
| `instagram` + 单图/单视频/Reel | ✅ | `postPending()` 的建容器 URL（`instagram.provider.ts:740-856`） |
| `instagram` + Carousel | ✅ 只加父容器 | `finalizePost()` 的 carousel 容器（`:994-1021`） |
| `instagram` + Carousel 子项 | ❌ | `postPending()` 里 `is_carousel_item=true` 的分支不要加 |
| `instagram` + Story | ❌ | `postPending()` 的 STORIES 分支不要加 |
| `instagram-standalone` | ❌ | provider 侧 `type === 'graph.facebook.com'` 守卫；UI 隐藏 |

**重要**：`postPending()` 同时负责单媒体容器和 carousel 子项容器。判断条件应是：

```text
type === 'graph.facebook.com'
&& settings.post_type !== 'story'
&& firstPost.media.length === 1
&& settings.location?.id
```

Carousel 的父容器在 `finalizePost()` 里创建，那时 `pendingData` 必须已经携带 location（见 §8）。

---

## 8. 推荐取值方式与代码落点（只做调研，不改代码）

### 8.1 数据形状

建议镜像 `TikTokLocation`（`tiktok.dto.ts:43`）：

```ts
export class InstagramLocation {
  id: string;        // Facebook Page ID，string
  name: string;
  address?: string;  // 展示用
}
```

`InstagramDto` 增加：

```ts
location?: InstagramLocation;
```

理由：

- UI 需要显示名称/地址，不能只存一个数字；
- provider 只需要 `location.id`；
- 与 TikTok 的 `location: { id, name, address? }` 保持一致；
- public API / chat tool 的 JSON schema 会自动带上（`class-validator-jsonschema`），但要确认 CLI/SDK 把字段放进 `settings`。

### 8.2 Provider 改动点（行号为当前 main）

| 位置 | 改什么 |
|---|---|
| `instagram.provider.ts:37-45` | 不改 scopes（搜索不需要新 scope） |
| `instagram.dto.ts:51-73` | 加 `location?: InstagramLocation` + `@JSONSchema` 描述 |
| `instagram.provider.ts:740-856` | `postPending()`：单媒体且非 Story 且 FB Login 时，把 `&location_id=<id>` 加到建容器 URL |
| `instagram.provider.ts:857-875` | `pendingData` 增加 `location?: string`（或整个对象），供 carousel 父容器使用 |
| `instagram.provider.ts:879-888` | `checkPostStatus()` 的 `pendingData` 类型加上 location 字段 |
| `instagram.provider.ts:994-1021` | `finalizePost()`：carousel 父容器 URL 加 `&location_id=<id>` |
| `instagram.provider.ts:106+` | `handleErrors()` 映射 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` |
| `instagram.standalone.provider.ts:225-238` | 不需要改（如果 provider 用 `type` 守卫生效）；否则显式剥离 location |
| 前端 `instagram.collaborators.tsx` 附近 | 新增 location 控件；`supportsLocation = integration?.identifier === 'instagram'`；Story 时隐藏 |
| `checkValidity()` | 建议：Story + location → 返回明确错误；carousel 不拒绝；Standalone 不校验/不显示 |

### 8.3 不要做的事

- 不要给 carousel 子项加 `location_id`（D：明确不支持）。
- 不要给 Story 加（C/D：不支持）。
- 不要给 `instagram-standalone` 发（A/B：不可用）。
- 不要发布后调 `fields=location,location_name` 验证（A：不支持）。
- 不要把 `/{page-id}/locations` 当成「这个 Page 有没有 location」的校验（语义不同）。
- 不要用 Page token 调 `/pages/search`（文档要求 user token）。
- 不要用 JS `number` 存 Page ID。

---

## 9. 需要实测的清单（上线前）

1. **查 App Dashboard**：App Review → Permissions and Features，确认是否有 **Page Public Metadata Access** 或 **Page Public Content Access**；确认 `pages_read_engagement` 是 Advanced Access。
2. **用非 app 角色用户的 user token 调 `/pages/search`**（app 未获批 PPMA/PPCA）：能否返回结果？能否返回非本人管理的 Page？这是 §2.3 歧义的关键。
3. **用同一 token 调 `GET /{place-page-id}?fields=id,name,location`**（Page 不是该用户管理的）：返回数据还是 `200`/`10`？
4. **用非本人管理的 place Page ID 建 IG 容器**：成功还是 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`？这决定 §4 的「任意 Page」是否成立。
5. **用 `is_unclaimed=true` 的 place Page 建容器**：是否可用？
6. **分页**：`/pages/search` 响应是否带 `paging`？`limit` 参数是否生效？
7. **错误 body**：故意用一个没有 location 的 Page ID 建容器，记录完整 JSON，确认 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` 出现的位置（`message` / `error_user_msg` / `error_subcode`）。
8. **Standalone（可选）**：用 Instagram Login token 向 `graph.instagram.com` 传 `location_id`，确认是报错还是忽略。文档已说不支持，实测只用于留证。
9. **UI 端**：Story 切换时 location 控件消失；切回 post 时已选地点是否保留（建议保留）。

---

## 10. 官方文档未明确的事项（不要编造）

- `/pages/search` 的**分页 / `limit` / 最大返回数**：Search Pages 页面没有写。
- user token 调 `/pages/search` 是否**仍然需要** PPMA/PPCA：端点文档没写 permission，feature 文档又说 feature 覆盖 Search API，两者口径不一致。
- `location_id` 是否要求用户对 location Page 有**角色**：参数定义只要求 location 数据。
- `is_unclaimed=true` 的 Page 是否可用于 IG location：文档没有排除。
- `location_id` 传非数字 / 传 IG User ID / 传 User ID 时的具体错误：文档只给了「无 location 数据」的 coded exception。
- Story 传 `location_id` 的精确错误：文档只说不支持 location sticker，没有逐参数错误。
- Instagram Login 传 `location_id` 的精确行为：文档只有 “cannot access ads or tagging”，没有逐参数说明。
- Page 被删除/合并/限制后的 `location_id` 行为：未文档化。

查过的页面：本文 §11 全部；另外检查了 `https://developers.facebook.com/docs/pages/searching`（301 → 当前 Search Pages 页面，无额外内容）和 `https://developers.facebook.com/docs/places/search`（重定向到 `/docs/places/web/search` 后 404）。

---

## 11. 一手来源清单

| # | 页面 | URL | 用于 |
|---|---|---|---|
| S1 | IG User Media（创建容器） | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media | `location_id` 定义、Pages Search API 指引、carousel 子项限制、Story 限制、`INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` |
| S2 | Content Publishing | https://developers.facebook.com/documentation/instagram-platform/content-publishing | 三种登录方式的权限/host、carousel 父容器、Story 说明 |
| S3 | IG Container | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container | 容器无 location 字段 |
| S4 | IG Media | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media | **`location` / `location_name` 不支持回读** |
| S5 | Search Pages（Pages API） | https://developers.facebook.com/documentation/pages-api/search-pages | 端点、token 类型、返回字段、`/search?type=place` 废弃、alias 限制 |
| S6 | Page 参考 | https://developers.facebook.com/docs/graph-api/reference/page/ | `location` 字段、Public Page Data 表、MODERATE 限制、错误码 |
| S7 | Page Locations edge | https://developers.facebook.com/docs/graph-api/reference/page/locations | `/{page-id}/locations` 的语义与权限 |
| S8 | Page Public Metadata Access | https://developers.facebook.com/docs/apps/features-reference/page-public-metadata-access | App Review + Business Verification、与 PPCA 互斥 |
| S9 | Page Public Content Access | https://developers.facebook.com/docs/apps/features-reference/page-public-content-access | App Review + Business Verification、测试期限制 |
| S10 | Pages API overview / permissions-features | https://developers.facebook.com/docs/pages/overview/permissions-features | Features vs Permissions 的通用规则 |
| S11 | Access Levels | https://developers.facebook.com/documentation/development/graph-api/overview/access-levels | Standard 只对 app 角色生效；Advanced 需 App Review + Business Verification |
| S12 | Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting | Pages API + user token → Platform Rate Limits；错误码 32/4/17 |
| S13 | Graph API Error Handling | https://developers.facebook.com/docs/graph-api/guides/error-handling | 10 / 200-299 / 190 / 102 / 463 / 467 |
| S14 | Instagram API with Instagram Login | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login | “cannot access ads or tagging”、无需 Facebook Page |
| S15 | Instagram Platform overview | https://developers.facebook.com/documentation/instagram-platform/overview | 三种登录方式对比、host、Page 要求 |
| S16 | Instagram Platform Page 节点 | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/page | “Available via Facebook Login for Business only” |
| S17 | IG 错误码 | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes | `2207xxx` 列表（注意不含 INVALID_LOCATION_ID） |
| S18 | Features Reference | https://developers.facebook.com/docs/apps/features-reference | feature 的通用定义与“未获批只对角色用户生效” |
| S19 | Secure Graph API Calls | https://developers.facebook.com/docs/graph-api/guides/secure-requests | `appsecret_proof` 默认可选，Require App Secret 后才强制 |

---

## 12. 与 `02` 的交叉核对

`02-instagram-location-media-matrix.md` 的发送侧矩阵（单图/单视频/Reel/父容器/子项/Story）与本文一致，可以直接采用。

需要修正的一点：

- `02` 的 S4 写「发布后可用 `location` / `location_name` 回读」，并在 T1/T2 里用 `GET /<IG_MEDIA_ID>?fields=location,location_name` 做验收。
- 当前 IG Media 参考明确把 `location`、`location_name`、`latitude`、`longitude` 列为 **Marketing API 迁移时不支持**的字段（https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media）。
- 因此 T1/T2 的验收方式应改为：
  - 建容器成功（无 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`）；
  - 人工在 Instagram 客户端确认地点；
  - 发布前用 Page API 校验 Page 有 `location` 数据。

除此之外，`02` 的结论不需要改。
