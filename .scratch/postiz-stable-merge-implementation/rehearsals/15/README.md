# Ticket 15 — scheduled-post continuity rehearsal

Live-ish proof that a scheduled post survives the upgrade: the pre-upgrade
worker creates the execution, the candidate worker takes the same execution
over, publishes it against a disposable database, writes the result back, and
neither a restart nor the update/delete paths duplicate or alter it. New posts
are shown to use `postWorkflowV112`; old executions keep `postWorkflowV101/V102`.

Everything local and synthetic. Platform calls and e-mail go to a recording
substitute; the database, the media volume, the e-mail/task queues and the
Temporal namespace are isolated and removed afterwards.

## Run it

Prerequisites:

- Docker with `postgres:15` and `redis:7-alpine` available locally;
- the compiled processes the container runs (`pnpm run build`, or
  `pnpm run build:backend && pnpm run build:orchestrator`);
- the `@temporalio/testing` test-server binary (already cached by ticket 14's
  rehearsal; it downloads on first use otherwise).

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

node .scratch/postiz-stable-merge-implementation/rehearsals/15/run.mjs
# one scenario:      --only legacy-v102-continuity
# keep containers:   --keep
# list scenarios:    --list
```

The whole matrix takes about two minutes. It writes
`results/latest.json`, `results/call-log.jsonl`, `evidence/summary.txt`,
`evidence/latest.json` and `evidence/call-log.jsonl`, and exits non-zero on the
first failed assertion. The PostgreSQL and Redis containers are removed unless
`--keep` is passed.

## Architecture

The runner starts, per clock mode:

| piece | what runs |
| --- | --- |
| database | `postgres:15` in a throw-away container on a loopback port; schema created by the repository's own `pnpm run prisma-db-push` |
| cache | `redis:7-alpine` (the shipped backend's throttler wraps the shared ioredis client) |
| media | the local `UPLOAD_DIRECTORY` served over loopback HTTP at `/uploads`, plus a synthetic RSS feed |
| Temporal | the real server binary from `@temporalio/testing`: `createLocal()` for wall-clock scenarios, `createTimeSkipping()` for hourly/daily maintenance |
| backend | `apps/backend/dist/.../main.js` — the exact compiled API PM2 starts |
| orchestrator | `apps/orchestrator/dist/.../main.js` — the candidate worker and its workflow bundle |
| pre-upgrade worker | an in-process `Worker` with the workflow sources extracted verbatim from commit C (shared with ticket 14's `legacy/base`) |

The only injected code is `lib/stub-provider.cjs`, preloaded with
`NODE_OPTIONS=--require`, which replaces exactly two external boundaries:

- the `bluesky` social provider for the synthetic channel (records every call,
  the full payload, and a SHA-256 of the media bytes it actually read), and
- the e-mail provider used by `EmailService` (records every send), plus a
  recorder around the start of the new per-email workflow.

`postSocial` stays the blocking contract for V101/V102; the stub's
`postPending`/`checkPostStatus`/`finalizePost` implement the new contract that
only V112 calls.

Each scenario seeds a fresh organisation, user, channel, media file and webhook
with synthetic values. Results are asserted at system seams only: database
rows, Temporal descriptions/histories, the stub call log, and the media file.

## Scenarios and measured result

Run `node .../run.mjs` for the authoritative numbers; the latest run's exact
observations and call log are in `evidence/`.

| # | scenario | clock | proves | result |
| --- | --- | --- | --- | --- |
| 1 | `new-post-v112-http` | real | Public API + uploaded media → `postWorkflowV112` on `main`; provider activities on `bluesky`; `postPending` → `checkPostStatus` → `finalizePost`; one publish; `releaseId`/`releaseURL` written; `publishDate` unchanged; restart republishes nothing; `streakWorkflowV2` started | PASS |
| 2 | `legacy-v102-continuity` | real | A V102 execution **created by the old bundle** (old worker stopped before the timer), same workflow id/run id/type after hand-over; blocking `postSocial` payload with the old media read from disk; one publish; result written back; history not rebuilt; one execution only; restart republishes nothing | PASS |
| 3 | `reschedule-scheduled-post` | real | `PUT /posts/:id/date` (schedule) terminates **only that post's** execution, starts a new V112 run with the same workflow id, DB date updated, publishes once at the new date | PASS |
| 4 | `draft-update-delete` | real | DRAFT starts no workflow; switching DRAFT→schedule starts V112; DELETE sets `deletedAt` and terminates the execution with no platform call (also after a worker restart); date change with `action=update` on a published post keeps PUBLISHED/release fields and starts nothing | PASS |
| 5 | `legacy-email-backlog` | real | The pre-upgrade `sendEmailWorkflow` singleton created by the old bundle receives signals after hand-over and the candidate worker drains both through the e-mail boundary once, order preserved, no resend after restart | PASS |
| 6 | `missing-post-sweep` | skip | `missingPostWorkflow` finds a synthetic stale QUEUE post, pokes `post_<id>` (V112) via `signalWithStart`, publishes once at the original past date | PASS |
| 7 | `autopost-maintenance` | skip | `autoPostWorkflow` runs `autoPost` on `main`, reads the feed, creates one DRAFT through the post service, records `lastUrl`, never publishes | PASS |
| 8 | `streak-email` | skip | `streakWorkflow` sets the streak, after 24 simulated hours sends the streak-end e-mail through the new per-email workflow / bulk queue and clears `streakSince` | PASS |

Every scenario records the payload contract, the queue each activity ran on,
the final database row and the stub call counts in `results/latest.json`.

## Contract facts the rehearsal pins

- New starts are `postWorkflowV112` on `main`; the provider queue carries
  activities only.
- Old executions are not renamed, terminated *en masse*, deleted or rebuilt.
  Reschedule/delete terminate exactly the execution whose workflow id is
  `post_<postId>`, then start the replacement with the same id.
- The V101/V102 blocking `postSocial` contract and the V112
  pending/check/finalize contract are distinct activities.
- Old business fields survive: `publishDate`, `state`, `group`, media JSON
  (`settings`/`image`) and `releaseId`/`releaseURL` once written.
- No Worker Versioning, no split queues for posts: the same `main` queue keeps
  running both old and new workflow types.
- The e-mail backlog keeps using the old `send_email` singleton and `main`
  activity, while new per-email workflows use the `email`/`email-bulk` queues.

`tests/scheduled-post-continuity.test.ts` is the fast structural net under this
rehearsal (8 tests) and runs in the normal `pnpm run test` suite.

## What this does not prove (hand-over)

- no real social platform, OAuth token validity or rate limiting — the stub
  answers; six-provider binding and real credentials stay out of scope
  (tickets 07/09 and the final acceptance report);
- no pending/finalize *failure* paths, heartbeat semantics or unknown-outcome
  recovery (ticket 17);
- no duplicate-job/idempotency sweep across multiple workers, no digest,
  invite or bulk e-mail volume limits (ticket 16);
- the deployment's real Temporal namespace, task-queue history and server
  version are not inspected; the test server runs in-memory with the search
  attributes registered the way an operator registers them, but its visibility
  store does not answer list queries (the time-skipping scenarios therefore
  assert deterministic workflow ids instead);
- Redis usage is limited to the throttler/ioredis wiring the API needs to boot;
  queue semantics are not exercised;
- the API is exercised through the compiled backend with a synthetic JWT/API
  key, not through a browser session (tickets 05/12 cover the browser entry).

## Adding or refreshing a scenario

1. Add an entry to `lib/scenarios.mjs` with `clock: 'real' | 'skip'` and
   `needsBackend` when the HTTP API is involved.
2. Use `seedOrganization`/`seedPost`/`seedAutopost` for data; never touch a
   real database or provider.
3. Assert through `expectEqual`/`expectTrue` (which write
   `evidence/summary.txt`), and record payloads with `observe`.
4. Run `--only <id>`, then the full matrix, and update the table above.
