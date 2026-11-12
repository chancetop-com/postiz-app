# Ticket 14 — Temporal history replay rehearsal

Offline replay of pre-upgrade Temporal histories against the candidate
orchestrator workflow bundle.

The pre-upgrade histories are **generated from the old code**, not from the
candidate: `legacy/base/` is a verbatim `git show` of the orchestrator workflows
at the product-behaviour baseline commit
`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`[^commit], with synthetic ids,
tokens, e-mail addresses and payloads only. No production history was read,
exported or committed.

[^commit]: `6fdf7cb53543fa28a470ad63e7619e8b98bcee43` — customisation commit C,
the behaviour baseline recorded in `.scratch/postiz-stable-merge/spec.md`.

## Run it

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs replay
# or: pnpm run test:replay

node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs check-detection
node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs generate     # only when fixtures must change
```

| command | needs a server? | what it does |
| --- | --- | --- |
| `replay` | no | bundles `apps/orchestrator/src/workflows` exactly like the worker does and feeds every stored history to `Worker.runReplayHistory`. Exits non-zero on the first non-determinism error and prints the failing scenario, workflow id, event count and the SDK's history location. |
| `replay --dist` | no | same, but against the compiled entrypoint `apps/orchestrator/dist/apps/orchestrator/src/workflows/index.js` (the path the running worker resolves). Requires `pnpm run build` first. |
| `check-detection` | no | replays a fixture against a deliberately divergent definition and requires the determinism check to reject it. Guards against a harness that silently "passes". |
| `generate` | yes (ephemeral, local) | starts a time-skipping Temporal test server per scenario, runs the old workflows with stubbed activities and rewrites `fixtures/`. The test-server binary is downloaded/cached by `@temporalio/testing` (one-time). |
| `all` | yes | `generate`, then `replay`. |

Replay writes `fixtures/../results/replay-latest.json` with the case count,
per-history result, candidate bundle sha256 and the fixture provenance it
replayed against.

## What is replayed

| scenario | source bundle | workflow type | events | proves |
| --- | --- | --- | ---: | --- |
| `v101-scheduled-sleep-success` | old (C) | `postWorkflowV101` | 52 | V101 resolves; schedule timer; `postSocial` → `updatePost` → notification → webhooks |
| `v102-delayed-comment` | old (C) | `postWorkflowV102` | 75 | V102 schedule timer; comment-delay timer; `postComment` payload |
| `v102-repeat-child` (parent) | old (C) | `postWorkflowV102` | 62 | repeat interval timer; `StartChildWorkflowExecutionInitiated` for a **V102** child |
| `v102-repeat-child` (repeat-child) | old (C) | `postWorkflowV102` | 47 | an old repeat child is itself a V102 execution and replays as V102 |
| `v102-refresh-token` | old (C) | `postWorkflowV102` | 64 | `refresh_token` activity failure → `refreshTokenWithCause` → retry |
| `v102-bad-body` | old (C) | `postWorkflowV102` | 34 | `bad_body` → `changeState(ERROR)` + user notification |
| `v102-inflight-sleep` | old (C) | `postWorkflowV102` | 11 | **open** history: publish timer started, publish activities not yet recorded |
| `refresh-token-loop` | old (C) | `refreshTokenWorkflow` | 34 | token-expiry sleep, `refreshToken`, exit on `refreshNeeded` |
| `legacy-email-signal-drain` | old (C) | `sendEmailWorkflow` | 39 | `sendEmail` signal contract + 700 ms throttle on the old singleton |
| `legacy-email-continue-as-new` | old (C) | `sendEmailWorkflow` | 335 | old backlog continues-as-new after 30 emails |
| `autopost-pre-patch` | old (C) | `autoPostWorkflow` | 44 | history **before** the patch marker: `patched('autopost-continue-as-new')` must resolve `false` |
| `autopost-post-patch-continue-as-new` | old + patch gates | `autoPostWorkflow` | 271 | marker present; continue-as-new after 24 live loops |
| `missing-pre-patch` | old (C) | `missingPostWorkflow` | 44 | hourly sweep history **before** the patch marker |
| `missing-post-patch-continue-as-new` | old + patch gates | `missingPostWorkflow` | 271 | marker present; continue-as-new after 24 sweeps |
| `streak-pre-patch` | old (C) | `streakWorkflow` | 39 | 22 h reminder + 2 h end; both `patched()` calls resolve `false` |
| `streak-post-patch-v2-handoff` | old + patch gates | `streakWorkflow` | 37 | `reminder` / `streak-last-post` markers; continue-as-new to `streakWorkflowV2` |

“old + patch gates” means the same commit-C sources with only the documented
`patched(...)` / continue-as-new blocks added (`lib/derive-patched.mjs`), so the
generating bundle is still not the candidate. The derivation asserts each anchor
exactly once and refuses to run if `legacy/patched/` has drifted from
`legacy/base/`.

Each fixture is `fixtures/<scenario>.json`:

```json
{
  "scenario": { "id", "description", "bundle", "workflowType", "workflowId", "proves" },
  "histories": [{ "name", "workflowId", "runId", "eventCount", "lastEventType", "history" }]
}
```

`history` is protobuf JSON (`History.toObject` with `bytes`/`longs`/`enums` as
strings), so it round-trips through `History.fromObject` without a server.

`fixtures/provenance.json` records the legacy commit, per-file blob shas
(`legacy/base/MANIFEST.json`), the sha256 of both generated bundles, the
replaying candidate revision (`HEAD`, branch, dirty count), `pnpm-lock.yaml`
sha256, Node/SDK versions and the cached test-server binary digest.

## Contract facts this rehearsal pins

- Every workflow type that appears in the fixtures is still exported by name
  from `apps/orchestrator/src/workflows/index.ts`; `tests/temporal-continuity.test.ts`
  asserts the full list, so deleting V101/V102 (or any V103–V112) fails `pnpm run test`.
- Old activity names and the blocking `postSocial` contract stay put;
  `postSocialPending` is a separate activity. Asserted in the same test.
- New starts use V112; old definitions stay registered because an old repeat
  child continues to create old versions (`v102-repeat-child` proves the child
  type). Nothing here terminates, renames or rebuilds executions.

## What replay does not prove (hand-over to tickets 15–17)

Replay only checks that the candidate produces the same command sequence for an
already-recorded history. It does not execute anything real:

- no database, provider or e-mail call; every activity is a stub, so
  `postSocial`, `postComment`, `refreshToken`, `sendEmail` and `searchForMissingThreeHoursPosts`
  side effects, idempotency, token validity and media readability are unproven
  (tickets 15/17);
- no queue routing: the fixtures run on `main`. Which task queues actually held
  workflows in the deployed environment is unknown; activity-only provider
  workers and any provider-queue workflows must be checked against the real
  deployment (ticket 15);
- no worker lifecycle: shutdown during an in-flight external publish, poller
  start-up, `EXCLUDE_QUEUE` / `WORKER_CONCURRENCY_DIVIDER` and email queue rate
  limits are not exercised (tickets 16/17);
- `streakWorkflowV2`, `sendSingleEmailWorkflow`-style new types have no
  pre-upgrade history by definition, so their own behaviour is not replayed
  here (ticket 16);
- search-attribute *types* are registered as TEXT in the ephemeral server; the
  deployed namespace is not inspected (ticket 15);
- Temporal server version and storage remain out of scope.

## Adding or refreshing a scenario

1. Add an entry to `lib/scenarios.mjs` (workflow type, args, stubs, capture).
2. `node .../run.mjs generate` (add `--refresh-legacy` only if `legacy/base` or
   `lib/derive-patched.mjs` changed).
3. `node .../run.mjs replay` and `check-detection`.
4. Update the table above and the ticket's Answer.
