# Ticket 17 — unknown results, compatible rollback, coordinated recovery

Live proof that a failed publish or upgrade can be told apart as **complete**,
**failed** or **unknown**, that the recovery object is a *verified compatible
candidate* (not the old image), and that a database + media restore can be
correlated with the Temporal namespace without pretending it undoes external
effects.

Everything is local and synthetic. The platform and the mail provider are
recording substitutes; the database, media volume, Redis and Temporal namespace
are disposable. No real publish, credential or backup is touched.

## Run it

Prerequisites:

- Docker with `postgres:15` and `redis:7-alpine`;
- `pnpm run build` (the compiled backend/orchestrator are the processes PM2
  starts);
- the `@temporalio/testing` test-server binary (cached by ticket 14).

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

node .scratch/postiz-stable-merge-implementation/rehearsals/17/run.mjs
# one scenario:      --only worker-death-unknown-results
# keep containers:   --keep
# list scenarios:    --list
```

Latest full run: **15 scenarios, 108 PASS assertions**, no failures; 17
unknown-result registry entries. The full matrix takes about 12 minutes: ~4 minutes for the killed-worker
heartbeat timeouts, ~2.5 minutes for the real status-check timeout and ~25
seconds for the legacy mail continue-as-new. It writes `results/latest.json`, `results/call-log.jsonl`,
`evidence/summary.txt`, `evidence/latest.json` and `evidence/call-log.jsonl`,
and exits non-zero on the first failed assertion.

## Architecture

Reuses tickets 15/16 instead of forking them:

| piece | reuse |
| --- | --- |
| PostgreSQL 15, Redis, media origin, synthetic feed | `rehearsals/15/lib` |
| compiled candidate backend/orchestrator, queue isolation, main-worker readiness | `rehearsals/16/lib/stack.mjs` (one optional `preload`/`waitForReady` seam added) |
| platform + mail recording substitutes | `rehearsals/16/lib/stub-provider.cjs`, required verbatim |
| seeds (org, channel, media, threads, stale posts, refresh channels) | `rehearsals/15|16/lib` |

The only new injected code is `lib/stub-provider.cjs`, preloaded with
`NODE_OPTIONS=--require`:

1. it loads ticket 16's substitutes unchanged;
2. it adds faults read from `work/faults.json` **on every call**, so a scenario
   can arm/disarm without restarting the candidate:
   - external: `post`, `postPending`, `checkPostStatus`, `finalizePost`,
     `comment`, `refreshToken`, `email` — `hang` runs the real substitute first
     and then never returns (the platform accepted, the worker stalled), `fail`
     throws before the call;
   - local write-back: `updatePost`, `changeState`, `inAppNotification`,
     `sendWebhooks`, `sweep`, `autoPost`.

The negative half of the activity-registration check is `lib/incomplete-worker.mjs`:
a worker that runs the compiled candidate workflow bundle but registers only
`getIntegrationsById`, so `refreshToken` is genuinely absent (what an
undecorated `@ActivityMethod()` produces). Editing the decorator metadata from a
preload is not enough: nestjs-temporal-core caches the activity map, so the
registration set itself has to be the fault.

Local write-back faults are thrown as **non-retryable** `ApplicationFailure`s.
That compresses the shipped retry schedule (3 attempts, 2-minute backoff) into
one attempt so the rehearsal stays inside its disk/time budget. The branch the
workflow reaches is identical; the README records the real schedule per
activity.

Re-running ticket 16's matrix on the same changed stack still passes (10
scenarios, 122 assertions), so the shared `preload`/`waitForReady` seam and the
V112 fix do not regress the recurring/maintenance work.

The recording substitute's `maxConcurrentJob` is raised from 1 to 100 so three
mutations can be in flight on the same provider queue and killed together. The
cap belongs to the substitute, not to the product.

Killing is `SIGKILL` on the process group (`killProcessGroup`): no graceful
shutdown, no activity result reported — an OOM kill or hard pod eviction.

## Scenarios

| # | scenario | clock | measured result |
| --- | --- | --- | --- |
| 1 | `worker-death-unknown-results` | real | Three mutations are accepted and left in flight, then the worker is SIGKILLed: `finalizePost` with heartbeat details, `postComment` with details, `postSocialPending` before its first heartbeat. The first two are marked unknown and never retried; the third is re-published because the workflow reads "no heartbeat details" as "never ran". |
| 2 | `check-status-timeout-unknown` | real | `checkPostStatus` hangs into one real 2-minute start-to-close timeout, then fails fast through the rest of the read-only error budget (~2.5 min); the already-accepted post becomes unconfirmed, there is exactly one publish and no finalize. |
| 3 | `db-writeback-fails-after-accept` | real | The provider completes, `updatePost` fails: the row is ERROR/unconfirmed with the serialized failure, exactly one publish and one finalize. |
| 4 | `total-writeback-loss-is-republished-by-the-sweep` | real | Both write-backs fail while the platform holds a published post; the row stays QUEUE and the missing-posts sweep publishes it again. Recorded as a pre-existing hazard. |
| 5 | `notification-writeback-fails` | real | Publish + write-back succeed, notification fails: workflow completes, one publish, no duplicate, no notification or e-mail. |
| 6 | `webhook-writeback-fails` | real | Unreachable webhook target; `sendWebhooks` swallows it, the workflow completes with one publish. |
| 7 | `refresh-fails-no-retry-storm` | real | Provider refresh throws: one attempt, `refreshNeeded` set, the user is notified, the loop exits. No retry storm, token untouched. |
| 8 | `mail-all-attempts-fail` | real | Three `sendEmailSync` attempts, all fail, failure swallowed, per-email workflow completes with no delivery and no error row. |
| 9 | `mail-worker-offline-queue` | real | Workflow started with every worker down; nothing delivered until the candidate returns, then exactly once. |
| 10 | `legacy-mail-continue-as-new-non-empty-queue` | real | 32 signals; the singleton continues as new after 30 with two messages in the payload; the successor delivers them exactly once, same id/type. |
| 11 | `maintenance-continue-as-new-after-restart` | skip | Sweep publishes one stale post, the worker is replaced mid-life, 24 loops later the workflow continues as new with the same id/type; the post is not republished. |
| 12 | `compatible-rollback-covers-old-and-new` | real | One bundle runs V102 and V112 with unchanged type/id/queue/business ids; a provider-queue execution waits until `COMPAT_WORKFLOW_QUEUES=bluesky`; a worker without the `refreshToken` registration takes the execution, leaves it RUNNING with no mutation and names the unregistered activity. |
| 13 | `sync-failure-and-no-new-writes` | real | `prisma db push` against an unreachable database exits non-zero and leaves 88 tables / 1092 columns / 281 indexes, the row digest and the media digest untouched; no execution exists, so there is nothing to compensate; the same command against the real database succeeds with the same data. |
| 14 | `coordinated-db-media-temporal-recovery` | real | Quiesced dump + media copy; new publish/refresh/notification produced; both restored together; rows, token and files match the backup exactly, Temporal keeps the execution and its business ids, the platform keeps its effects, and the sweep republishes the restored QUEUE row. |
| 15 | `readiness-process-vs-api` | real | Backend pointed at an unreachable Temporal: process alive, `/api/` never ready. Same binary with Temporal: ready. |

## The three recovery situations

1. **Sync failure.** `prisma db push` is run against an unreachable database;
   it exits non-zero and the candidate does not start. The rehearsal records the
   structure snapshot before/after (no partial change to inspect in this run)
   and then re-runs the same command against the real database, which succeeds
   with the rows intact. A failed sync is **not** proof that the schema is
   unchanged; the run keeps the error and the snapshot rather than assuming.
2. **No new writes yet.** Nothing was produced under the new version: the
   database and media digests equal the pre-upgrade snapshot, no new Temporal
   execution exists, and the same candidate starts against the same data. There
   is nothing to resume and nothing to compensate.
3. **Already-produced new executions/data.** This is scenario 13: the restore
   is internally consistent and correlates with Temporal, but the restored row
   says QUEUE while the platform has a post. Recovery therefore reconciles the
   external facts first and does not treat the backup as the truth.

## Rollback coverage matrix

| produced item | covered by |
| --- | --- |
| workflow types `postWorkflowV101`–`V112`, `sendEmailWorkflow`, `sendSingleEmailWorkflow`, `digestEmailWorkflow`, `autoPostWorkflow`, `missingPostWorkflow`, `refreshTokenWorkflow`, `streakWorkflow`, `streakWorkflowV2` | all exported by the one candidate bundle; `tests/fault-recovery.test.ts` asserts the set |
| old blocking `postSocial` payload and new `postSocialPending`/`checkPostStatus`/`finalizePost` payloads | scenario 12, both executed by the same bundle |
| patches `missing-post-continue-as-new`, `autopost-continue-as-new`, `reminder`, `streak-last-post` | `tests/fault-recovery.test.ts` + ticket 16's rehearsal |
| provider-queue workflow **without** `COMPAT_WORKFLOW_QUEUES` | stays RUNNING, zero activities, zero publishes |
| provider-queue workflow **with** the queue listed | same type/id/queue, publishes through the old contract |
| activity missing from the worker's registration set (what a missing `@ActivityMethod()` produces) | the execution is picked up, the activity task stays scheduled, the execution stays RUNNING, no refresh, the worker names the unregistered activity; no half-run. The annotated candidate must be deployed, but the pending task is only re-dispatched after its 10-minute start-to-close, so recovery waits or explicitly re-drives the execution |
| new executions produced during the run | scenario 1/13 restart the candidate against them; ids/types/business ids unchanged |

**The old image is not a rollback object here.** It is never started: its
`--accept-data-loss` sync and its missing new workflow/patch support are the
reason the ticket requires a verified compatible candidate instead.

## Contract facts the rehearsal pins

- A timeout **with** heartbeat details means the mutation started: the outcome
  is unknown, the post is marked unconfirmed and is never re-published.
- **Fixed by this ticket:** the pending resolver (`postWorkflowV112`) had no
  `timeout` branch, so a `finalizePost` heartbeat timeout *with details* fell
  through to the transient-read-error path: it slept 20 s and ran
  `checkPostStatus` + `finalizePost` again, publishing twice for providers whose
  finalize performs the create. The rehearsal measured it
  (`ACTIVITY_TASK_TIMED_OUT` type 4 with one heartbeat payload, followed by
  `timerStarted`/`timerFired` and a second finalize). The fix stops on a
  heartbeating (mutation) timeout and marks the post unconfirmed, gated with
  `patched('post-finalize-timeout-unknown')` so histories recorded before the
  fix keep their old command sequence and still replay. Pre-patch in-flight
  executions therefore keep the old retry behaviour until they finish.
- A timeout **without** details is treated as never-started. If the platform
  accepted the call and the worker died inside the first 15-second heartbeat
  interval, the retry publishes a second time. This is a genuine,
  pre-existing unknown-result hazard; the spec forbids adding a global
  idempotency system for it, so it is recorded and handed to go-live.
- A timed-out `postComment` marks `postsList[0]` (the already-published root) as
  ERROR and leaves the comment row QUEUE with no result. Recorded as a
  local-state defect: the root stays live and the UI shows an unconfirmed
  error.
- A total DB write-back outage leaves a QUEUE row for a published post, and the
  missing-posts sweep re-publishes it. Reconcile the platform before re-enabling
  the sweep after an outage.
- Notification and webhook write-backs cannot fail the workflow or duplicate
  the post; a lost webhook is invisible locally.
- Mail delivery failures are swallowed after three attempts, so Temporal cannot
  retry them. Mail is not retried after a worker restart either (only undelivered
  workflow tasks are).
- Continue-as-new carries the unprocessed mail queue in the input payload.
- Maintenance `historyLength > 1000` cannot fire before the 24-loop gate at the
  measured ~11 events/loop (~270 events/run); it is a guard for a different
  cadence, not an exercised boundary.
- A missing activity registration blocks the execution instead of skipping the
  mutation, and it does not resume instantly when the annotated worker starts:
  the pending activity task waits for its start-to-close (10 minutes, up to
  three attempts). Recovery must schedule that delay or re-drive the execution.
- The API port is the readiness signal; a live process proves nothing.

`tests/fault-recovery.test.ts` is the fast structural net (15 tests) and runs in
the normal `pnpm run test` suite.

## What this does not prove

- no real social platform, OAuth validity, rate limits or mail delivery; the
  substitutes answer;
- the real retry timing (3 attempts / 2-minute backoff) is compressed to a
  non-retryable failure for the write-back faults; the branch, not the schedule,
  is what the rehearsal measures;
- a worker killed during a **maintenance** activity is not exercised: the sweep
  has a 10-minute start-to-close and no heartbeat, so recovery is deferred, not
  duplicated — this was reasoned from the proxy, not measured;
- the blocked-on-unregistered-activity execution is not resumed in the
  rehearsal: its pending activity task waits for the 10-minute start-to-close,
  so only the block (not the later resume) is measured;
- the time-skipping server has no visibility store; deterministic workflow ids
  and `describe`/histories are used instead of list queries;
- the coordinated restore uses a quiesced, single-writer synthetic database; the
  real backup method, consistency point, live in-flight inventory, on-prem
  schema drift, Pod/imageID and stop-write window remain a go-live check
  (ticket 18).
