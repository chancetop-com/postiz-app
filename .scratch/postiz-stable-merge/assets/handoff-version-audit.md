# Handoff — Postiz fork version & provider audit

**Date:** 2026-11-11  
**Repository:** `/Users/chancetio/Desktop/Web/postiz-app`  
**Fork:** `chancetop-com/postiz-app` (`origin`)  
**HEAD:** `6fdf7cb53543fa28a470ad63e7619e8b98bcee43` (2026-07-07)  
**Upstream:** `gitroomhq/postiz-app`, latest main `80c3e55dc025c57c00bc4ecc146125125851dc41` (2026-11-11)

---

## Session outcome

The user asked three investigative questions; no product code was changed.

1. Which official GitHub commit is this fork based on?
2. Which platform providers changed in the latest official Postiz?
3. What did the fork's own two commits do?

A fourth follow-up asked for concrete TikTok and Instagram examples of upstream provider changes.

---

## 1. Version baseline

**Baseline commit:** `0b554e684483932d394e703208fe21648e7acd6f`  
- Official upstream commit by Nevo David, dated **2026-04-20**.
- Confirmed ancestor of upstream `main` with `git merge-base --is-ancestor`.
- Subject looks local (`Merge remote-tracking branch 'origin/main'`) but it is in official history.

**Fork adds exactly 2 commits on top:**

| Commit | Date | Subject |
|---|---|---|
| `f042c177c1a378edacd54790614bdd9f709a2480` | 2026-04-24 | `sso` |
| `6fdf7cb53543fa28a470ad63e7619e8b98bcee43` | 2026-07-07 | `feat: SSO integration, channel relay, UI improvements, and documentation` |

**Distance to upstream latest:** **1,093 commits behind** `80c3e55d`.

### Verification commands

```bash
git fetch --filter=blob:none https://github.com/gitroomhq/postiz-app.git main
git update-ref refs/upstream/main FETCH_HEAD
git merge-base HEAD refs/upstream/main          # -> 0b554e68
git rev-list --count 0b554e68..refs/upstream/main # -> 1093
git rev-list --count 0b554e68..HEAD              # -> 2
```

`refs/upstream/main` was created locally during this session and still exists. A partial-clone remote entry named after the upstream URL was also added by the fetch; neither is needed for normal work.

---

## 2. Provider changes in official latest

### Local fork: zero provider changes

```bash
git diff --stat 0b554e68 HEAD -- libraries/nestjs-libraries/src/integrations
# empty
```

All local provider files equal the 2026-04-20 baseline.

### Upstream since baseline

- **286 upstream commits** touch `libraries/nestjs-libraries/src/integrations`.
- **All 34 existing `*.provider.ts` files modified**.
- **2 new providers added:** `tiktok.business.provider.ts` (+1301), `tumblr.provider.ts` (+652).
- `hashnode.tags.ts` unchanged.
- Shared adapter layer also changed: `social.abstract.ts`, `integration.manager.ts`, `refresh.integration.service.ts`, `social.integrations.interface.ts`, new `dashboard.function.decorator.ts`.
- Frontend provider components under `apps/frontend/src/components/new-launch/providers`: **49 files, +1758 / -598**.

Full provider diff stat was produced during the session; re-run:

```bash
git diff --numstat 0b554e68 refs/upstream/main -- \
  'libraries/nestjs-libraries/src/integrations/social/*.provider.ts'
```

### TikTok example (41 commits, +611 / -109)

File: `libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts`

Main changes:
- Video upload rewritten from `PULL_FROM_URL` to **`FILE_UPLOAD` chunked streaming**:
  - single chunk ≤64MB, otherwise 10MB chunks;
  - ranged reads for remote URL and local files;
  - SSRF-safe dispatcher, `accept-encoding: identity`;
  - 5xx/429 retries, stream release, heartbeat.
- Blocking `uploadedVideoSuccess()` loop replaced by **`postPending()` + `checkPostStatus()`** durable workflow; old `post()` kept as 9-minute compatibility wrapper.
- Post ID fixes: int64 `publicaly_available_post_id` parsed from raw text; photo vs video URL path; draft publish ID in URL fragment; new `resolveReleaseId()` / `releaseUrl()`.
- `checkValidity()`: media count, mixed carousel, image shorter side ≤1080px pre-check.
- Error mapping updates (`reached_active_user_cap` → disconnect, pending-post 24h message, URL ownership message, media size message).
- Default `content_posting_method` becomes `DIRECT_POST`; `assetBoolean()` for string booleans; cover timestamp supports `0`.
- `makeSecureId(16)` for OAuth state; `maxConcurrentJob` 300 → 10000.
- New `tiktok.business.provider.ts` (+1301) with `musicSearch()` / `locationSearch()`.
- DTO adds `music` and `location`.
- Frontend: new `tiktok.music.tsx` (334), `tiktok.location.tsx` (183), major `tiktok.provider.tsx` rewrite.

### Instagram example (40 commits, +652/-155 main provider, +96/-8 standalone)

Files:
- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`
- `libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts`

Main changes:
- Same **pending workflow** refactor: `postPending()` / `checkPostStatus()` / `finalizePost()`, with recovery for `media_publish` returning 2207051 after actually publishing.
- Meta Graph API **v20/v21 → v25.0** via `META_GRAPH_API_VERSION`.
- Token format changed to `<page_token>___<user_token>`.
- Image **alt text** support (≤1000 chars, images only).
- Collaborator fixes: strip leading `@`, URL-encode JSON, send on carousel container, error 2207018.
- Reel audio: `audioSearch()` tool (`ig_audio`), `audio_configuration` with `audio_volume` / `video_volume`, single-video Reel only.
- Custom Reel cover via `cover_url`.
- Many curated error mappings (2207078, #200, checkpoint/session → disconnect, 1772107, 2207082 retry, 2207085, 2207077, carousel 2–10, 2207052 retry).
- Analytics fix: `until` changed to `startOf('day')`, removed duplicate total entry that doubled metrics.
- Standalone provider delegates pending methods with `graph.instagram.com`; surfaces token exchange errors and logs returned permissions.
- Frontend: new `instagram.audio.tsx` (353), collaborators changes, preview tweaks; DTO adds `InstagramAudio`.

---

## 3. What the fork's two commits did

### Commit `f042c177` "sso" (2026-04-24)

Stats: 357 files, **+92,949 / -316**.  
But **92,507 added lines are the first half of a `k8s/` deployment source copy** (including 10,950 lines of translation JSON). Actual non-`k8s` change: **31 files, +442 / -316**.

Functional content:

1. **Auth transport migration: httpOnly cookies → response headers + sessionStorage**
   - Backend stops setting `auth` / `showorg` / `impersonate` cookies in `auth.controller.ts` and `users.controller.ts`; returns headers instead.
   - Logout returns `logout` header, no server-side cookie clear.
   - Frontend `libraries/helpers/src/utils/custom.fetch.func.ts` reads `sessionStorage` and sends custom headers; drops default `credentials: 'include'`.
   - `layout.context.tsx` stores headers and redirects to `/auth/login` on logout/401.
   - `apps/frontend/src/proxy.ts` removes auth-cookie redirects and `/modal/` protection; auth becomes client-side.
   - `main.ts` always allows auth-related CORS headers.
   - Note: backend `AuthMiddleware` already accepted `req.headers.auth`, so the server side works; security tradeoff is real (JWT now readable by JS, no SSR gate).

2. **SSO backend groundwork**
   - `AuthService.jwt()` → public `signJwt()`.
   - New `ssoLogin()`: verifies `auth_code` via `SsoService`, finds/creates user by `Provider.GENERIC` + `providerId = merchantId`, auto-creates org.
   - New `POST /auth/sso`.
   - Env vars `SSO_SERVER_URL`, `SSO_PARENT_ORIGINS`, `NEXT_PUBLIC_SSO_PARENT_ORIGINS`.
   - ⚠️ This commit **does not compile alone**: it imports `apps/backend/src/services/auth/sso.service.ts` and `SsoLoginDto`, both added only in the next commit.

3. **Iframe / popup OAuth relay groundwork**
   - `add.provider.component.tsx` detects iframe, opens `/channel-relay` popup with auth in URL hash.
   - `continue.integration.tsx` posts `CHANNEL_UPDATED` to opener and closes.
   - `launches.component.tsx` listens and refreshes channel list.
   - nginx adds `frame-ancestors *`, longer proxy timeouts, buffering off, stdout logging.

4. **Deployment/misc**
   - Adds `k8s/` root config, Dockerfiles, ACR deploy script, card source snapshot.
   - Adds `docker/docker-compose.yaml` (Postgres/Redis/Temporal/SSO mock env).
   - `next.config.js`: `output: 'standalone'`.
   - Backend build excludes `chat`/`agent`.
   - `main.ts`: non-fatal unhandled rejection + non-blocking MCP start.
   - Copilot returns 503 when OpenAI key missing.
   - Hides Settings menu; logout goes to `/auth/login`.

### Commit `6fdf7cb5` (2026-07-07)

Stats: 509 files, **+86,093 / -37**.  
**478 files / +82,949 lines are `k8s/apps` source copy.** Non-`k8s`: **31 files, +3,144 / -37** (about 2,600 of those are docs).

Functional content:

1. **SSO completed**
   - `apps/backend/src/services/auth/sso.service.ts`: POSTs `{ auth_code }` to `SSO_SERVER_URL`, expects `merchant_id` / `merchant_name`; no local signature verification.
   - DTOs `SsoLoginDto`, `SsoCreateAccountDto`.
   - `/auth/sso?token=` → `/sso?auth_code=`.
   - `/sso` page supports URL code or `postMessage({ type: 'SSO_TOKEN' })` from `NEXT_PUBLIC_SSO_PARENT_ORIGINS`; calls `/auth/sso`; redirects to `/launches` or `/analytics`; forces light mode.

2. **Channel relay completed**
   - `apps/frontend/src/app/(app)/channel-relay/page.tsx` reads auth from hash, stores in sessionStorage, sets `channel_popup_mode`, redirects to OAuth URL.
   - `add.provider.component.tsx` hardcodes allowed channels: `youtube`, `linkedin`, `tiktok`, `facebook`, `instagram`, `instagram-standalone`.

3. **UI / branding**
   - Logo SVG → `/logo-postiz.png` (32×32).
   - Default theme dark → light across mode, analytics, billing, launches, icons, app layout.
   - Hides Agent / Plugs / Integrations menu items (Settings hidden in commit 1).
   - Hides Design Media / AI buttons.
   - Safer `/user/self` null handling and redirect.
   - Preview page/wrapper tolerate network/parse errors.

4. **Docs**
   - `docs/sso-migration-plan.md` (1,148 lines)
   - `doc/social-platform-comments-api.md` (344)
   - `var/social-media-platform-execution-plan.md` (550)
   - `var/social-media-tools-research.md` (566)
   - `doc/sso-test/mock-sso-server.js` + `index.html`

5. **Deployment**
   - Complete `k8s/apps` copy (backend/frontend/orchestrator), nearly byte-identical to root.
   - `docker/dynamicconfig/development-sql.yaml`, `var/docker/ecosystem.config.cjs`.
   - `k8s/.core-ai/tool-permissions.json` (contains a local developer path).

---

## Current repository state (as of handoff)

```text
HEAD: 6fdf7cb5
refs/upstream/main: 80c3e55d

Staged, not committed:
  A  .codegraph/.gitignore
  A  AGENTS.md
  T  CLAUDE.md
```

These staged files came from the environment/harness, not from this session's analysis. **Do not revert or commit them without asking the user.**

`k8s/` is a full source copy (~955 files), not just manifests. After these commits, root code and `k8s/apps` + `k8s/libraries` must be kept in sync manually.

---

## Important observations / risks

1. **Upgrade is a large merge, not a provider-only cherry-pick.** Upstream provider changes depend on shared framework changes (`social.abstract.ts`, interfaces, manager, DTOs, frontend components), so copying individual providers will likely not compile or behave correctly.
2. **First local commit is not independently buildable** (`SsoService` / `SsoLoginDto` added later).
3. **JWT in sessionStorage** increases XSS impact and removes server-side route protection from `proxy.ts`.
4. **`k8s/` duplication** is the biggest maintenance drift risk: deployed code comes from `k8s/`, not root.
5. **SSO auto-provisioning** trusts the configured internal `SSO_SERVER_URL` response; first login creates `${merchantId}@sso.merchant` with `Provider.GENERIC`.
6. **Channel allowlist** is hardcoded in the frontend to six platforms, independent of backend provider availability.

---

## Suggested next steps

The user has not chosen an action yet. Reasonable directions:

1. **Decide upgrade strategy**
   - Option A: merge upstream `main` into the fork in a dedicated branch, resolve conflicts, then re-apply local SSO/branding changes.
   - Option B: selectively port provider fixes on top of the old base (high effort, many interdependent files).
2. **If upgrading providers**, start with shared framework + DTOs, then providers, then frontend; verify with `pnpm` build/lint from repo root.
3. **Audit local commits** for security/behavior regressions, especially the cookie → sessionStorage migration and client-only auth gate.
4. **Resolve `k8s/` duplication** (make deployment build from root, or document a sync script) before making large upstream merges.
5. **Confirm product scope** — the six-channel allowlist may be intentional, but it hides many upstream providers.

---

## Suggested skills

- `code-review` — review `0b554e68..HEAD` along standards/spec axes before merging upstream.
- `resolving-merge-conflicts` — when merging `refs/upstream/main` into the fork.
- `diagnosing-bugs` — if SSO/channel-relay/iframe behavior regresses.
- `tdd` — if adding tests around SSO user provisioning or provider adapter behavior.
- `pr` — when preparing the upstream-sync or SSO changes for review.
- `research` — if a written comparison/upgrade recommendation document is needed.

---

## Useful commands

```bash
# confirm baseline/upstream
git merge-base HEAD refs/upstream/main
git log -1 --format='%H %ad %s' --date=iso refs/upstream/main

# local commit diffs (exclude deployment copy)
git show --stat f042c177 -- . ':(exclude)k8s'
git show --stat 6fdf7cb5 -- . ':(exclude)k8s'

# provider changes upstream
git diff --stat 0b554e68 refs/upstream/main -- libraries/nestjs-libraries/src/integrations
git diff 0b554e68 refs/upstream/main -- \
  libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts
git diff 0b554e68 refs/upstream/main -- \
  libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts

# sync check between root and k8s copy
for f in $(git ls-tree -r --name-only HEAD k8s/apps); do
  rel=${f#k8s/}
  git cat-file -e "HEAD:$rel" 2>/dev/null && \
    [ "$(git rev-parse HEAD:$f)" != "$(git rev-parse HEAD:$rel)" ] && echo "DIFF $rel"
done
```
