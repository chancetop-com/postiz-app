# 12 — Instagram Location

**What to build:** Instagram（Facebook Login）用户按关键词搜索并选择地点。搜索结果来自带 location 数据的 Facebook Page，最多 20 条；没有结果或搜索失败统一显示 `No location found`。单图、单视频/Reel 在容器请求中发送 `location_id`，Carousel 只加在父容器；Story 与 Standalone 隐藏控件、保留值、永不发送。地点数据无效时返回可读错误，不重试。

**Blocked by:** 09 — Instagram AI 披露（与 Instagram DTO / provider / 设置组件共用同一表面，串行避免冲突）

**Status:** resolved

- [x] Instagram DTO 增加可选的 `location`，形状为 `{ id: string; name: string; address?: string }`。
- [x] provider 增加 `locationSearch`：使用 user token 调用 Pages Search，过滤没有 location 数据的 Page，`id` 转 string，`address` 由地点字段拼接，最多返回 20 条。
- [x] 搜索遇到 `refresh-token` 照常抛出；其余错误返回空数组，前端显示 `No location found`。
- [x] 设置组件复用现有地点搜索选择器交互：防抖、Loading、结果列表、已选卡片、移除；不做手填 Page ID，不调用 `/me/accounts`。
- [x] Facebook Login 的单图、单视频/Reel 在容器请求中发送 `location_id`。
- [x] Carousel 只在父容器发送 `location_id`；子容器、Story、Standalone 永不发送。
- [x] Story 与 Standalone 隐藏 Location 控件但保留值；`checkValidity` 不因这些组合拒绝保存。
- [x] `handleErrors` 将 `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` 映射为可读 `bad-body`，不重试；不扩展 `#100` / `#200` 等共享错误码。
- [x] provider 的 `@Rules` 与 Swagger 描述说明可用媒体与 Story/Standalone 忽略语义。
- [x] 在 provider 平台 HTTP 边界覆盖搜索、payload、Story/Standalone 与错误映射；在 settings 组件边界覆盖显示/隐藏与值保留。
- [x] 现有测试、typecheck 通过。

## Answer

Implemented Instagram (Facebook Login) location end to end; Instagram Standalone never sends it.

**Changed files**
- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/instagram.dto.ts` — `InstagramLocation { id, name, address? }`, `InstagramDto.location` with `@IsOptional` / `@ValidateNested` / `@Type` and `@JSONSchema` descriptions.
- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts` — `@Tool locationSearch` (user token, `GET graph.facebook.com/pages/search?fields=id,name,location,link`, filters Pages without location data, joins address, max 20); `location_id` on single non-Story Facebook Login containers; `locationId` carried in `pendingData` and appended to the Carousel parent only; `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` → readable non-retryable `bad-body`; `@Rules` updated.
- `libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts` — `@Rules` says Location is unavailable/ignored.
- `apps/frontend/src/components/new-launch/providers/instagram/instagram.location.tsx` (new) — search-only selector: 500 ms debounce, Loading / `No location found`, result list, selected card + X.
- `apps/frontend/src/components/new-launch/providers/instagram/instagram.collaborators.tsx` — one Location control below the AI checkbox, rendered only for `identifier === 'instagram'`; `invisible h-0 overflow-hidden` on Story (mounted, value kept).
- `tests/instagram-location.test.ts` (new) — DTO, search, payload, Story/Standalone and error mapping at the provider HTTP boundary.
- `tests/instagram-location-settings.test.tsx` (new) — visibility for `instagram` vs `instagram-standalone`, Story hide/retain/restore, search selection.

**Validation**
- `pnpm vitest run tests/instagram-location.test.ts tests/instagram-location-settings.test.tsx tests/instagram-ai-disclosure.test.ts tests/instagram-ai-settings.test.tsx` → 4 files, 50 tests passed (run before and after merging the integration tip).
- `pnpm typecheck` → passed (frontend, backend, orchestrator; before and after merge).
- Targeted `eslint` on changed files → 0 errors (warnings mirror the existing TikTok location selector).

**Commits**
- `fd06dcfc` feat(instagram): add Facebook Page location support
- `c3b4a217` Merge branch 'feat/publish-options-ig-tiktok' into ticket/12-instagram-location (integration tip `e0e564f9`, ticket 11)
