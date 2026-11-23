# Instagram Location 的取数 UX 与 DTO 形状

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

基于 01 / 02 的结论，定下：

1. 用户如何选择地点：复用 `TikTokLocationSelector` 的搜索选择器、手填 ID、还是两者兼有？
2. DTO 形状：`location?: { id, name, address? }`（对齐 `TikTokLocation`）还是只存 `location_id`？理由。
3. UI 显示范围：只在 Instagram (Facebook Business) 显示；Story 与不支持的媒体类型是隐藏还是禁用。
4. 搜索不可用时的最小方案与用户提示（去哪里取 ID、如何验证）。

## Answer

**定案（2026-11-23）：复刻原生发布器的「搜索任意地点」体验；不适用 / 失败场景的语义按 TikTok Business 对齐。**

### 1. 取数入口：只有搜索

- 复用 `TikTokLocationSelector` 的交互：500ms 防抖、`Loading / No location found / 结果列表`、已选卡片 + X 移除。
- **不做**手填 Page ID，**不做** `/me/accounts`（只列自己管理的 Page），**不做**「我的 Page」快捷区。
- Instagram provider 新增 `@Tool locationSearch`，走 `POST /integrations/function`，与 `audioSearch`（`instagram.provider.ts:1292`）同一通道。

### 2. 搜索实现

```http
GET https://graph.facebook.com/pages/search?q=<q>&fields=id,name,location,link&access_token=<USER_TOKEN>
```

- token 用 user token：`token.split('___')[1]`（同 `audioSearch:1297`）。
- 结果过滤掉 `location` 为空 / 缺失的 Page；`id` 转 `string`；`address` 由 `location.street/city/state/country` 拼出。
- UI 最多展示 20 条（对齐 TikTok Business 的 20 条；IG 文档未写分页，不假设 `paging.next`）。
- 错误语义对齐 `tiktok.business.provider.ts:920-928`：`refresh-token` 抛 `RefreshToken`；其余错误返回 `[]`。
- 前端 `catch` 同样归为 `[]`，统一显示 `No location found`（不区分权限 / 限流 / 无结果）。

### 3. DTO

```ts
export class InstagramLocation {
  id: string;        // Facebook Page ID，string，发布时使用
  name: string;      // 展示用；IG 发布不发送
  address?: string;  // 展示用
}
// InstagramDto 增加：location?: InstagramLocation
```

- 形状与 `TikTokLocation` 一致；不共用类，因为 JSONSchema 描述需要 provider 专属。
- Instagram 发布只发 `location_id`（`location_name` 是 TikTok 专有，IG 没有该参数）。

### 4. UI 范围与 Story 行为

| 场景 | 显示 | 发送 `location_id` |
|---|---|---|
| `instagram` + 单图 / 单视频 / Reel | ✅ | ✅ |
| `instagram` + Carousel | ✅（作用于父容器） | ✅ 仅父容器 |
| `instagram` + Story | ❌ 隐藏 | ❌ |
| `instagram-standalone` | ❌ | ❌ |

- 仅 `integration?.identifier === 'instagram'` 渲染；Standalone 整条链路不显示。
- **Story 对齐 TikTok Business 的 UPLOAD 语义**：用 `invisible h-0 overflow-hidden` 隐藏（组件保持挂载、`register('location')` 保留已选值），**不 clear**；发布时 provider 不发送。
  - 现象：用户在 Post 选了地点 → 切 Story → 控件消失 → 发布 → 地点被静默丢弃；切回 Post 时值仍在。
  - 这是对 handoff「UI 不能静默丢弃」的**有意例外**，由 06 决定是否补一行提示或给规则加例外说明。
- **搜索不可用对齐 TikTok Business**：不隐藏控件、不做能力探测；失败与空结果同样显示 `No location found`。

### 5. 发布侧红线（实现者）

| 位置 | 行为 |
|---|---|
| `postPending()` 单媒体容器（`!isStory && media.length === 1`） | 加 `&location_id=<id>` |
| `finalizePost()` carousel 父容器 | 加 `&location_id=<id>`；`pendingData` 增加 `locationId` |
| carousel 子项（`is_carousel_item=true`） | 永不发送（02 的 D 级禁止） |
| Story 容器 | 永不发送 |
| `instagram-standalone` | 永不发送（`type === 'graph.facebook.com'` 守卫） |
| `checkValidity()` | 不加 Story + location 的拒绝规则（与 TikTok Business 一致：静默不发） |
| `handleErrors()` | 建议补 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` → `bad-body`（不重试）；是否本轮做由 06 定 |

### 6. 预期差（写进文档，避免被当 bug）

- IG 原生 picker 搜的是 Meta 地点库；公开 API 只给 **Pages Search**，返回「有地点数据的 Facebook Page」。
- 没有 Page 的小店、或 Page 未填地址 → 搜不到；低粉 Page / alias 搜索按官方说法可能不返回。
- 发布后无法回读 location（IG Media 明确不支持 `location` / `location_name`）；验收只能靠建容器成功 + IG 客户端人工确认。

### 7. 上线前置实测（未通过则搜索对多数用户不可用）

1. App Dashboard 确认是否有 PPMA / PPCA；`pages_read_engagement` 是否 Advanced Access。
2. 非 app 角色用户的 user token 调 `/pages/search` → 能否返回非本人管理的 Page。
3. 同一 token 读该 Page 的 `location` → 返回 data 还是 `(#200)`。
4. 用非本人管理的 Page ID 建 IG 容器 → 成功还是 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`。
5. `is_unclaimed=true` 的 Place Page 能否建容器。
6. 响应是否带 `paging` / `limit`。
