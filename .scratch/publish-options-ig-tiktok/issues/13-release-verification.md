# 13 — 发布前验证与 release note

**What to build:** 对 AI 披露与 Location 的最终矩阵做一次发布前验证，并写好面向用户的 release note。验证覆盖四个 provider、所有媒体/模式、UI 显隐与值保留；release note 明确说明 `video_made_with_ai` 已移除、旧排程帖子会失去 AI 标注但不会发布失败、`is_ai_generated` 是统一字段，以及 Instagram Location 的可用范围与搜索限制。

**Blocked by:** 11 — TikTok Business UPLOAD 的 Location 门控 + 旧字段收口；12 — Instagram Location

**Status:** resolved

- [x] 完整 `pnpm test` 通过；需要数据库的套件按仓库既有条件提供 `DATABASE_URL` 或按既有规则跳过。
- [x] `pnpm typecheck` 与 `pnpm lint` 通过。
- [x] 按最终矩阵逐项核对 provider 测试与 settings 组件测试，确认没有遗漏的格子。
- [x] release note 包含：旧 `video_made_with_ai` 移除、旧排程帖子失去 AI 标注但发布成功、`is_ai_generated` 新字段、Instagram Location 的 Story/Standalone 限制与 `No location found` 行为。
- [x] 记录真实账号验证的缺口：Instagram（FB Login）与 TikTok Business 账号仍由 **07 — 真账号发布验证** 跟踪，不作为本票阻塞。
- [x] 若验证发现行为与规格不符，先修代码或回写规格，再完成本票。

## Answer

Release verification only; the matrix audit found **no production mismatch**, so no production code changed.

**Commands (worktree root, `DATABASE_URL` unset):**
- `pnpm test` → 73 files total: 71 passed, 2 skipped; 856 tests total: **837 passed, 19 skipped, 0 failed**. Skipped by the repo's existing DB guards: `tests/accepted-invitations.test.ts` (2 tests, `describe.skipIf(!DATABASE_URL)`), `tests/selected-channel-posts.test.ts` (7 tests, same guard), and 10 DB tests inside `tests/channel-credentials.test.ts` (the file itself ran 40 passed).
- `pnpm typecheck` → exit 0 (frontend typegen + tsc, backend, orchestrator).
- `pnpm lint` → exit 0, **0 errors**, 695 pre-existing warnings. A production build was not run, per the ticket.

**Matrix audit outcome:** every cell in the spec's support matrix is covered by a provider HTTP-boundary test and/or settings-component test. No production behavior contradicted the spec. Gaps found and closed with tests only (no duplicated coverage):
- Standalone single video/Reel AI is sent (`tests/instagram-ai-disclosure.test.ts`).
- `checkValidity()` remains true for Standalone + location (`tests/instagram-location.test.ts`).
- Standalone Story hides the AI control while keeping its value (`tests/instagram-ai-settings.test.tsx`).
- `checkValidity()` remains true for legacy and Business video UPLOAD + retained AI (`tests/tiktok-ai-disclosure.test.ts`).
- TikTok Business video UPLOAD AI and photo UPLOAD Location now assert value retention + restore in `tests/tiktok-ai-settings.test.tsx`.

Also confirmed: `true` sends vs `false`/`undefined` omits; Story/carousel-child/Standalone Location suppression; `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` → non-retryable `bad-body`; DTO/schema removal of `video_made_with_ai`; 16-locale `made_with_ai` migration.

**Release note:** `.scratch/publish-options-ig-tiktok/release-note.md` (English, user-facing) states the `video_made_with_ai` removal / `is_ai_generated` unification, the breaking change for pre-deployment scheduled posts, Instagram Location scope + search/error behavior, and TikTok AI label placement with UPLOAD caveats.

**Real-account gap:** implementation and release verification are complete, but T1–T8/T10/T11 still need real Instagram (FB Login, with a located Facebook Page) and TikTok Business accounts. Tracked in **07 — 真账号发布验证** (kept open; comment appended 2026-11-23).

### Post-review fixes

A review-fix pass on branch `review-fixes/publish-options` (from integration tip
`2fbcac32`) addressed the standards and spec findings. `**Status:** resolved`
stays.

**Fixed**

- One shared `LocationSelector` at
  `apps/frontend/src/components/new-launch/providers/location.selector.tsx`
  replaces the duplicated TikTok and Instagram copies (both deleted). It keeps
  the 500 ms debounce, Loading / `No location found`, result list and selected
  card; TikTok behavior is unchanged. The Instagram provider reuses the
  existing `tiktok_*` copy keys (and `tiktok_location_label` for the label);
  no `instagram_*` location key remains in production.
- The shared selector accepts a `value?: SelectedLocation` prop and syncs it
  by id/name/address, so a location loaded after mount (edit, preview,
  defaults) renders the selected card. The mount `getValues()` fallback is
  kept. Both providers pass `watch('location')`.
- `instagram.collaborators.tsx` hoists one `storyHidden` class for the AI and
  Location wrappers; the Collaborators conditional unmount is unchanged.
- `instagram.provider.ts` defines one `InstagramPendingData` type used by
  `postPending`, `checkPostStatus` and `finalizePost`; the dead
  `type === 'graph.facebook.com'` guard in `finalizePost` is gone (locationId
  is only set for Facebook Login); `locationSearch` no longer declares the
  unused `internalId` parameter.
- The `TikTokDto` class comment now distinguishes required fields from
  optional enhancements, and its title/AI descriptions match the draft
  behavior.
- The tautological `InstagramDto` / `video_made_with_ai` test is removed; the
  TikTok DTO tests still cover the legacy field.
- The AI/location `@Rules` prose is shared via exported constants in
  `instagram.provider.ts` and reused by `InstagramStandaloneProvider`; DTO
  `@JSONSchema` descriptions stay separate by design.
- TikTok Business payloads now match the spec exactly:
  - video UPLOAD/draft `post_info` is exactly `{ upload_to_draft: true }`
    (caption, brand flags, AI and location are not sent);
  - photo UPLOAD/draft `post_info` is `is_draft` plus optional `title` /
    `caption` (brand flags, AI-in-post_info and location are not sent; the
    top-level `is_ai_generated` still is);
  - DIRECT_POST bodies are unchanged (caption and brand flags still sent);
  - the Business `@Rules` now states these draft payloads accurately.
- Pages Search now uses
  `https://graph.facebook.com/${META_GRAPH_API_VERSION}/pages/search`, and the
  search test asserts the versioned path.
- New/changed tests: Instagram single-image `is_ai_generated: false` (and
  missing) omit the flag explicitly; carousel settings show exactly one AI
  checkbox and one Location control; a location set after mount renders;
  `postPending()` rejects with a non-retryable `BadBody` on
  `INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID` (HTTP 400, no retry);
  TikTok Business draft `post_info` exact-key assertions plus DIRECT_POST
  brand/caption regression assertions. Test count: 862 (843 passed, 19
  skipped), up from 856 (837 passed, 19 skipped).

**Intentionally deferred**

- Renaming `instagram.collaborators.tsx`: it is a pre-existing settings
  filename also used for Post Type / audio / AI / location, and is referenced
  by the spec and tickets. A rename is a broad mechanical diff with no
  behavior gain; left as-is.
- Deduplicating `renderSettings` / `useIntegration` test scaffolding: the
  files use per-file `vi.hoisted` mocks and slightly different integration
  shapes; a shared helper would centralize jsdom module mocking and risk
  cross-file isolation for little benefit.
- `i18n.lock` `channel_popup_blocked` drift: tool-driven and documented in
  ticket 08; left untouched. No locale file changed, so the lock was not
  regenerated.

**i18n note:** the `tiktok_add_location` / `tiktok_search_location` /
`tiktok_no_location_found` / `tiktok_location_label` keys are not present in
the 16 locale JSON files on this branch; TikTok already relied on the English
fallback strings, and the shared selector now does the same, so this pass adds
no new untranslated keys. `made_with_ai` remains in all 16 locales and in
`i18n.lock` (`tests/i18n-made-with-ai.test.ts` passes).

**Full gate after the fixes (worktree root, `DATABASE_URL` unset):**

- `pnpm test` → 73 files: 71 passed, 2 skipped; 862 tests: **843 passed, 19
  skipped, 0 failed**.
- `pnpm typecheck` → exit 0 (frontend typegen + tsc, backend, orchestrator).
- `pnpm lint` → exit 0, **0 errors**, 692 warnings (pre-existing; three fewer
  than before because the duplicated location selectors were removed).

Commit: `fix(publish-options): address review findings`.
