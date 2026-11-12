# Ticket 16 — recurring/maintenance continuity rehearsal

Live-ish proof that the work ticket 15 did not cover keeps running under the
candidate: old repeat children stay old, delayed comments and the refresh
backlog finish, both e-mail generations deliver, the maintenance patches and
continue-as-new boundaries execute, and an old provider-queue workflow can be
consumed without turning every provider worker into a workflow worker.

Everything is local and synthetic. Platform calls, comments, token refreshes
and e-mail go to recording substitutes; the database, media volume, Redis and
Temporal namespace are isolated and removed afterwards.

## Run it

Prerequisites:

- Docker with `postgres:15` and `redis:7-alpine`;
- `pnpm run build` (the compiled backend/orchestrator are the processes PM2
  starts);
- the `@temporalio/testing` test-server binary cached by ticket 14.

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

node .scratch/postiz-stable-merge-implementation/rehearsals/16/run.mjs
# one scenario:      --only legacy-repeat-child-continuity
# keep containers:   --keep
# list scenarios:    --list
```

The full matrix takes about 2.5 minutes, writes `results/latest.json`,
`results/call-log.jsonl`, `evidence/summary.txt`, `evidence/latest.json` and
`evidence/call-log.jsonl`, and exits non-zero on the first failed assertion.

## Architecture

Reuses ticket 15's stack instead of forking it: disposable PostgreSQL 15 +
Redis, a loopback media/RSS origin, the **compiled** candidate backend and
orchestrator, and `@temporalio/testing` Temporal servers. Real-clock scenarios
share one server; every time-skipping scenario gets a fresh server.

The only injected code is `lib/stub-provider.cjs`, preloaded with
`NODE_OPTIONS=--require`, which replaces exactly the external boundaries:

- the `bluesky` provider (`post`, `postPending`, `checkPostStatus`,
  `finalizePost`, `comment`, `refreshToken`), recording every call, payload and
  a SHA-256 of the media bytes it actually reads;
- the e-mail provider used by `EmailService` (records every delivery).

Two harness-only adjustments keep the test server measurable:

- `T16_DISABLE_STICKY=1` wraps `Worker.create` with
  `maxCachedWorkflows: 0`. The time-skipping test server expires sticky-cache
  entries on the virtual clock, which is frozen while it waits for a timer's
  workflow task. After a worker restart the timer's task would sit on the dead
  worker's sticky queue forever. Product workers keep the default sticky cache;
  only the rehearsal forces replay-per-task.
- `EXCLUDE_QUEUE` limits the orchestrator to `main`, `bluesky`, `email` and
  `email-bulk`, so a restart does not open ~40 unused provider pollers (the test
  server's connection ping limiter).

These are harness concerns, not product behaviour. No product code is changed
for the rehearsal.

## Scenarios and measured result

| # | scenario | clock | measured result |
| --- | --- | --- | --- |
| 1 | `legacy-repeat-child-continuity` | skip | Existing V102 repeat run: round one publishes through the blocking `post` contract on `bluesky`; worker restart; the 24 h round starts a **V102** child (`post_<id>_<random>`) with the same business post id; rounds 1+2 each publish once; the DB anchor date is untouched. The old export is still required after round one. |
| 2 | `new-repeat-child-continuity` | skip | New scheduling payload → `postWorkflowV112` on `main`; round one uses `postPending`→`checkPostStatus`→`finalizePost`; restart; the next round is another **V112** child; two rounds, two finalizes, anchor unchanged. |
| 3 | `autopost-continue-as-new` | skip | First loop creates one AUTOPOST draft from the local feed, records `lastUrl`, never publishes. At 24 loops the workflow continues as new (271-event first run, `continuedAsNew=1`) with the same id/type and a new run; the same feed item is not drafted twice. |
| 4 | `missing-sweep-continue-as-new` | skip | `missingPostWorkflow` runs 24 sweeps on `main`, then continues as new (271-event first run) with the same id/type. |
| 5 | `streak-patch-continue-as-new` | skip | Both patch gates resolve true: no legacy reminder, and at the 24 h check it continues as new into `streakWorkflowV2` (37-event first run) instead of ending the streak; no e-mail, `streakSince` remains set. |
| 6 | `missing-sweep-compensation` | real | Genuinely stale (5 h) QUEUE post publishes once with `postPending`, original past date kept. A repeat anchor 25 h old is poked as V112 but **re-anchored** in memory to the next occurrence: state stays QUEUE, DB date untouched, zero calls. A 3-day-old post and a refresh-needed channel post are not swept. Sweep activity on `main`. |
| 7 | `delayed-comments-both-generations` | real | Old V102 root published by the old worker, then the candidate posts its delayed comment after ~60 s; new V112 root+comment through the public API posts its comment after ~60 s. Both target the root release id, use the bound account/token, write `PUBLISHED` + `releaseId` on the comment row, and both workflows complete. Exactly two comment calls. |
| 8 | `refresh-token-backlog` | real | `refreshTokenWorkflow` keeps `refresh_<integrationId>`, sleeps to expiry, runs the (now registered) `refreshToken` activity once on `main`, stores the new token/refresh token/expiry, clears `refreshNeeded`, then keeps running for the next expiry. One refresh call. |
| 9 | `email-both-generations` | real | Legacy `sendEmailWorkflow` drains three signals through `main` in addTo order; new `sendSingleEmailWorkflow` runs the priority activity on `email` and the bulk activity on `email-bulk`, both complete. Five scenario messages delivered exactly once; a worker restart resends nothing. |
| 10 | `provider-queue-workflow-compat` | real | Synthetic old `postWorkflowV102` whose task queue is `bluesky` sits at 2 events with no activity while provider workers are activity-only. After `COMPAT_WORKFLOW_QUEUES=bluesky` and a restart, the same compatible bundle consumes it: type/id/queue unchanged, one blocking publish, `postSocial` and the DB activities on `bluesky`, workflow completed. |

Latest full run: **10 scenarios, 122 PASS assertions**, no failures. Queue
consumption roll-up: workflow tasks `{"main":15,"bluesky":1}`; activity tasks
`{"main":68,"bluesky":33,"email":1,"email-bulk":1}`.

## Contract facts the rehearsal pins

- A repeat child keeps the version of the execution that started it: V102
  parents/children stay V102; new V112 repeats stay V112. Old definitions are
  not deleted after the first round.
- The test-server restart workaround is explicitly harness-only; product
  workers still use Temporal's default sticky cache and no Worker Versioning.
- `refreshToken` is a registered Temporal activity. Before this ticket it was
  only a class method, so `refreshTokenWorkflow` could never run it.
- New provider workers stay activity-only by default. A deployment whose
  history contains provider-queue workflows opts in per queue with
  `COMPAT_WORKFLOW_QUEUES=bluesky,x`. New workflows are never moved off `main`.
- The missing sweep compensates a stale repeat anchor by rolling it to the next
  occurrence, not by re-sending every past post; posts outside the two-day
  window and refresh-needed channels are ignored.
- The old e-mail singleton remains a long-lived `main` queue consumer while new
  per-email workflows split priority/bulk onto `email`/`email-bulk`.

`tests/recurring-maintenance-workers.test.ts` is the fast structural net under
this rehearsal (10 tests) and runs in the normal `pnpm run test` suite.

## What this does not prove

- no real social platform, OAuth token validity, rate limits or real Resend
  delivery; the stubs answer;
- provider-queue workflows are a synthetic local history. Whether the deployed
  namespace actually has any is unknown and must be inspected before choosing
  `COMPAT_WORKFLOW_QUEUES`; the default keeps provider workers activity-only;
- the streak hand-off scenario aligns the synthetic "last post" value with the
  time-skipped workflow clock (see `stub-provider.cjs`). The real 24 h wall-clock
  path is exercised by ticket 15's streak-end scenario, not here;
- the time-skipping test server has no visibility store; deterministic workflow
  ids and `describe`/histories are used instead of list queries;
- failure injection (platform accepted then worker exit, DB/notification
  write-back failure, heartbeat/no-heartbeat timeouts, e-mail provider retries,
  continue-as-new at history limits) is ticket 17's scope. The list of types,
  patches and payloads to cover is in the ticket's Answer;
- the deployment's real Temporal server version, namespace and queue history
  remain a pre-launch check.

## Hand-over to ticket 17 (failure injection)

Types, patches, payloads and seams this rehearsal executed successfully and
that fault injection must now break deliberately:

| area | what to inject |
| --- | --- |
| workflow types | `postWorkflowV101`–`V112` (old repeats keep the parent version); `sendEmailWorkflow`, `sendSingleEmailWorkflow`, `digestEmailWorkflow`, `streakWorkflow`, `streakWorkflowV2`, `autoPostWorkflow`, `missingPostWorkflow`, `refreshTokenWorkflow`. |
| patches / boundaries | `missing-post-continue-as-new`, `autopost-continue-as-new`, `reminder`, `streak-last-post`; legacy e-mail continue-as-new after 30; history-length >1000 gates; streak hand-off to V2. |
| activities / payloads | `postSocial`, `postSocialPending`, `checkPostStatus`, `finalizePost`, `postComment`, `updatePost`, `changeState`, `inAppNotification`, `sendWebhooks`, `getPost`/`getPostsList` (repeat re-anchor), `refreshToken`, `refreshTokenWithCause`, `getIntegrationsById`, `sendEmail`, `sendEmailAsync`, `getUserOrgs`, `setStreak`, `getLastPublishDate`, `autoPost`, `searchForMissingThreeHoursPosts`. |
| post failures | platform accepted then worker exit between `postPending` and `finalizePost`; check-status timeout/error with and without heartbeat details; DB write-back failure after acceptance; notification/webhook failure after publish; comment timeout after the root published. Assert no duplicate publish/comment and the unconfirmed-error state. |
| e-mail | provider failing all three `sendEmailSync` attempts; priority/bulk worker offline; restart during the legacy singleton; continue-as-new while a queue is non-empty; digest batching. |
| refresh | provider refresh failure → `refreshNeeded` + notification and no retry storm; refresh activity missing/registration; token expiry while the worker is down. |
| maintenance | missing sweep when the poke execution is already running; stale repeat anchor inside/outside the 2 h grace; autopost/missing/streak continue-as-new with in-flight loops; history >1000. |
| provider queue | old provider-queue execution without `COMPAT_WORKFLOW_QUEUES`; with the queue enabled but the activity classes missing; restart mid-workflow; activity scheduled on the provider queue. |
| continuity | workflow id / business id / namespace / search attributes (`postId`, `organizationId`) / queue names must survive every injected failure and restart; no Worker Versioning is involved. |
