# 09: 旧渠道继续刷新凭据与重连

**What to build:** 已有商户继续使用原渠道绑定，凭据能被正确读取、刷新和重新授权；六入口以外的历史渠道仍可管理，升级不要求统一解绑或重新绑定。

**Blocked by:** 07 — [六渠道入口与直接 OAuth 回调可用](07-channel-oauth-direct.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的存量 Integration、凭据与重连契约；同时遵守[共同执行约束](../README.md#执行约束)。03 已提供升级后样本；实际排程发布在 15 验证。

- [x] 使用升级后的旧绑定样本，从页面/公开 API 读取、刷新和重连，保留 Integration ID、组织、internalId、rootInternalId、凭据和有效期关系；仅按真实刷新/授权结果更新必要字段。
- [x] 覆盖旧 root 查找、同账号多页及跨组织绑定；需要适配时基于 provider 契约，不统一猜测下划线后缀，不整表重写 root 或强制重授权。
- [x] 验证 Instagram 旧单 token fallback 和新组合格式、Skool 旧 JWT 与新格式的兼容读取，沿用既有加密/JWT 配置，不根据字符串形状擅自修复凭据。
- [x] 六项普通 OAuth 重连继续当前窗口导航；账号/密钥类 provider 保留对应表单，兼容上游重连变化不被六入口限制删除。
- [x] 验证凭据过期、刷新成功/失败、拒绝授权、重连成功/失败后的可见状态和持久化变化，避免把刷新消息当作成功；多步重连复用既有选择契约，其新版完整选择流程由 08 和最终验收覆盖。
- [x] 至少覆盖代表性非白名单历史绑定的查询、设置和凭据操作，证明其代码与接口仍可使用；不删除其它记录或队列，不开启全量 provider 迁移。
- [x] 平台替身观察到正确账号与凭据语义，敏感值只在受控程序内比较，不进入日志；说明模拟不能证明真实平台凭据有效，交付样本供 15 继续验证发布。

## Answer

2026-11-12, implemented on `codex/ticket-09-channel-credentials` from integration tip `f0e11bd0`. Production code changed in one place; every other requirement is proven by regression tests against the real service/repository/provider code with only the database and external platforms stubbed.

### What changed

- `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` — `refreshTokens()` used a bare `return` when one channel failed, which ended the whole batch and left every later channel unrefreshed. It now `continue`s. This is the only production change; the k8s generated copy was refreshed with `./k8s/prepare-build-context.sh --allow-dirty`, never hand-edited.
  Spec basis: user stories 26–27 (“已有渠道可以刷新凭据、重新授权并继续发布”“既有绑定和发布能力得到保留”) and the [六项渠道 / 旧渠道凭据 ruling](../../postiz-stable-merge/spec.md#六项渠道与完整授权回传) — “已有渠道可以刷新凭据、重新授权并继续发布”. A batch that aborts at the first revoked channel leaves every later channel unrefreshable, so the ruling cannot hold without this fix; it is a baseline defect fix, not a new feature.
- `tests/channel-credentials.test.ts` — 20 new tests. The Prisma `integration` delegate is an in-memory table honouring the queries the repository issues (`upsert` on `organizationId_internalId`, `updateMany` on root id, `findMany` for refresh candidates, etc.). Provider/HTTP stubs only sit at platform boundaries.

### Coverage

- **Rotation and retention.** The six identifiers plus `tumblr` and `linkedin-page` rotate with the integration id, organization, `internalId`, `rootInternalId`, name, profile and additional settings unchanged; only token, refresh token and expiry move. A failed refresh keeps the old token/expiry, sets `refreshNeeded` and notifies once. An empty refreshed token (Facebook-Business Instagram has no self-refresh) is treated as failure, never persisted as success.
- **Root and grouping.** A grouped page refreshes through `reConnect(rootInternalId, internalId, freshUserToken)` and stores the page token; a root channel does not call `reConnect`. Old md5-hashed root lookup still matches; an underscore-suffixed root is deliberately not matched. The same account bound in two organizations refreshes each org row with its own result.
- **Provider-specific reads.** Instagram reads an old single token as the whole access token and a `page___user` token as the page part only; `reConnect` keeps the combined write format. Skool reads both the AES-encrypted JSON format and the legacy JWT via the existing `AuthService` functions; malformed data yields no credentials and no platform call.
- **Reconnect surface.** `refreshChannel` branches on the backend's `integration.isCustomFields` to open `CustomVariables` and returns before requesting an OAuth URL; ordinary reconnects still use `window.location.href`, never `window.open`. The menu offers the credential entry on `isCustomFields` and hides the OAuth reconnect entry for custom-field providers.
- **Reconnect persistence.** With the real controller and mock Redis, a successful reauthorisation stores the page token together with the fresh authentication's refresh token and expiry; a rejected reauthorisation throws before `createOrUpdateIntegration`, so nothing is persisted.
- **Non-whitelisted bindings.** `getIntegrationsList` still returns live `tumblr`/`linkedin-page` rows for the org, excludes soft-deleted rows, and settings updates stay org- and row-scoped.

### Commands and results

| Command | Result |
| --- | --- |
| `git log -1 --oneline` | `f0e11bd0` (integration tip, as required) |
| `pnpm install --frozen-lockfile` | succeeded, Prisma client generated |
| `pnpm vitest run tests/channel-credentials.test.ts` | 20/20 passed |
| `pnpm run typecheck` | frontend, backend, orchestrator passed |
| `pnpm run lint` | 0 errors, 713 warnings |
| `pnpm run test` (twice) | 45 files, 388/388 tests passed both runs |
| `pnpm run build` | frontend, backend, orchestrator built |
| `./k8s/prepare-build-context.sh --check` | context in sync with `f0e11bd0` |
| `git merge codex/postiz-stable-merge` | already up to date |

### Not proven / remains for later tickets

- No real platform account, consent screen, token refresh or publish was exercised; stubs prove code and contract, not that real credentials are valid.
- The database was not available; `db push`/upgrade evidence is ticket 03's, and these tests use an in-memory delegate rather than PostgreSQL.
- Consent denial in the browser and the popup callback remain ticket 07's baseline; multi-step selection remains 08's. The credential form is asserted at source level, not rendered in a browser.
- The Temporal workflow's sleep/retry behaviour belongs to 14; this ticket exercises the activity target (`RefreshIntegrationService.refresh`).
- `MIGRATE_PROVIDERS` was not enabled or exercised.
- Upstream `oneTimeToken` propagation (`updateMany` by root id) intentionally left unchanged; it is not org-scoped, and this ticket neither asserts nor changes that cross-org write.
- Actual scheduled publishing with these credentials is ticket 15.

### Handoff to 15/16

- The CLI refresh batch now continues after a failed channel; the per-channel Temporal path was already isolated.
- Instagram (Facebook Business) cannot self-refresh: expect `refreshNeeded` and a reconnect, while page channels refresh through `reConnect` and keep the page token.
- Reconnect preserves the freshly authenticated refresh token and expiry instead of the old stored ones.
- Reusable upgraded-binding fixtures and the in-memory integration table are in `tests/channel-credentials.test.ts`; publishing itself still needs real/stubbed platform verification in 15.
