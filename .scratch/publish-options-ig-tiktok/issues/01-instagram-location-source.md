# Instagram Location 的 location_id 从哪来？

Type: research
Status: resolved
Blocked by: —

## Question

Instagram (Facebook Business) 的 `location_id` 必须是一个「带 location 数据的 Facebook Page ID」。请核实并给出最小可用方案：

1. Postiz 现有的 Facebook Login app（scopes 见 `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`）能否通过 Meta Graph API 搜索地点并拿到可发布的 `location_id`？端点、所需权限 / App Review、返回字段、分页与限流。
2. 如果搜索不可用，是否只能让用户手填 Facebook Page ID？如何校验该 ID 有效且带 location 数据？
3. 是只接受与 Instagram 账号绑定的 Facebook Page，还是任意 place page 都可以？
4. Instagram Login（Standalone）是否完全不可用（官方说明 "cannot access ads or tagging"）。
5. 给出失败模式：权限不足、无结果、ID 无效、token 过期。

产出：`.scratch/publish-options-ig-tiktok/research/01-instagram-location-source.md`，并在本票 `## Answer` 里给出结论与来源链接。

## Answer

**结论**：`location_id` 就是一个「带 `location` 数据的 Facebook Page」的数字 ID。它与 IG 账号绑定的 Page 没有绑定关系；Facebook Login 版可用，Story、carousel 子项、Instagram Login 版不可用。搜索用 Pages Search API，但生产可用性受 app feature 审批影响；**最小可用方案是「手填 Page ID + 建容器兜底校验」，搜索作为可选增强**。

1. **能否搜索**：能构造 `GET https://graph.facebook.com/pages/search?q=<kw>&fields=id,name,location,link&access_token=<USER_TOKEN>`。必须用 **user token**（Postiz 存的 `___` 第二段），不是 Page token。按端点文档字面，现有 user token 路径不需要新 scope / 新 App Review；但 PPMA/PPCA feature 文档都声称覆盖 Pages Search API 且需 App Review + Business Verification，两处口径不完全一致 → 生产对非角色用户是否可用**必须实测**。旧 `/search?type=place` 已废弃。分页/`limit` 官方未文档化。限流按 Pages API + user token → Platform Rate Limits（错误码 `32`/`4`/`17`）。
   - https://developers.facebook.com/documentation/pages-api/search-pages
   - https://developers.facebook.com/docs/apps/features-reference/page-public-metadata-access
   - https://developers.facebook.com/docs/graph-api/overview/rate-limiting

2. **手填与校验**：可手填数字 Page ID；用 `GET /{page-id}?fields=id,name,location,link` 校验，有 `location` 即可。但对**非本人管理**的 Page，读 Page 需要 PPCA/PPMA；没有 feature 时前置校验可能返回 `200`/`10`，此时不要阻止提交，最终由建容器校验：无 location 数据会返回 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`。发布后**不能**用 `fields=location,location_name` 回读（IG Media 明确不支持）。
   - https://developers.facebook.com/docs/graph-api/reference/page/
   - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
   - https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media

3. **绑定 Page？** 官方只要求「a Page associated with a location」且「has location data」，**没有要求必须是 IG 账号绑定的那个 Page**，也没有写需要对 location Page 有角色。任意带 location 数据的 Page（place page 或普通 business Page）都符合参数定义；隐藏的角色限制需实测。
   - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media

4. **Standalone**：**不可用**。官方写明 “This API setup cannot access ads or tagging.”；Instagram Login 不要求、也不使用 Facebook Page，而 `location_id` 是 Facebook Page ID；Page 节点仅 Facebook Login 可用；host 是 `graph.instagram.com`。`instagram-standalone` 应隐藏 Location，provider 侧用 `type === 'graph.facebook.com'` 守卫。
   - https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
   - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/page

5. **失败模式**：
   - 权限不足/被撤销：Graph `10` / `200-299`；
   - token 过期：`190` / `102`（subcode `463`/`467`）；
   - 搜索无结果：`data: []`；
   - ID 无效：`100`；
   - Page 无 location 数据：`INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`；
   - 限流：`32` / `4` / `17`；
   - Story：不支持 location sticker；carousel 子项：不支持。
   - Postiz 的 `handleErrors()` 目前没有映射 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`，需要补一条 `bad-body`。
   - https://developers.facebook.com/docs/graph-api/guides/error-handling

**推荐取值**：DTO 存 `{ id, name, address? }`（镜像 `TikTokLocation`），`id` 用 **string**；发送时只发 `location_id=<id>`。单媒体加到 `postPending()` 的容器；carousel 只加到 `finalizePost()` 的父容器；Story / carousel 子项 / Standalone 不发。

完整调研（含逐条引文、代码落点、实测清单、与 02 的回读结论冲突说明）：`.scratch/publish-options-ig-tiktok/research/01-instagram-location-source.md`
