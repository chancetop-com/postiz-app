# Ticket 13 — delivery faults and recovery

Live proof that once a worker may have handed a post to a platform, the outcome
can be told apart as **complete**, **platform rejected**, **pending** or
**unknown**, and that a recovery/replay does not silently send it again. It also
measures the compensation scan's pre-dispatch re-read against cancel/delete/
reschedule races.

It reuses ticket 12's normal continuity evidence (`rehearsals/12/`) and its
pure helpers: the same compiled candidate, the same synthetic `bluesky`
boundary, the same media digest and the same Post/Temporal seams. The fault run
is compared with those normal samples.

Everything is synthetic and local. The rehearsal uses the isolated
`postiz-ticket-13` Temporal namespace (created on first use), the dedicated
PostgreSQL database, Redis database 13 and a local media directory. It does not
touch the `default` namespace, the main checkout or a real provider.

## Run it

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

# prerequisites
docker exec postiz-postgres psql -U postiz-local -d postgres -c 'CREATE DATABASE "postiz-ticket-13"'   # once
DATABASE_URL=postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-ticket-13 \
  pnpm prisma-db-push
pnpm run build:orchestrator

# the whole matrix (about 12–14 minutes; most of it is the real 3-minute
# heartbeat timeout and one real 2-minute write-back backoff)
DATABASE_URL=postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-ticket-13 \
REDIS_URL=redis://localhost:6379/13 \
  node .scratch/postiz-v2.26.0-implementation/rehearsals/13/run.mjs

# one scenario / list
... run.mjs --only worker-death-finalize-with-details
... run.mjs --list
```

Each run truncates the dedicated database and terminates running executions in
the isolated namespace before starting, so previous evidence cannot leak into a
later scan. Results land in `results/latest.json`; `evidence/latest.json`,
`evidence/summary.txt`, `evidence/classifications.json`,
`evidence/call-log.jsonl` and `evidence/faults.json` are the committed
observations. `work/` (worker logs, uploads, the live fault file) stays local.

## Scenarios

| # | scenario | what happens | classification |
| --- | --- | --- | --- |
| 1 | `scan-mutations-during-compensation` | four stale QUEUE rows are loaded; one is soft-deleted, one is canceled (state ERROR) and one is rescheduled before dispatch | complete (two sends: untouched + still-QUEUE rescheduled) |
| 2 | `finalize-platform-rejected` | `finalizePost` throws a non-retryable `bad_body` | failed: platform accepted zero finalizes, row ERROR, Errors row |
| 3 | `pending-still-in-progress` | `checkPostStatus` keeps returning pending | pending: row QUEUE, execution RUNNING, no finalize, no error marker |
| 4 | `writeback-transient-recovers` | the platform accepts+finalizes, the first `updatePost` attempt fails, the shipped retry runs after the 2-minute backoff | complete: one platform send, PUBLISHED + finalize id |
| 5 | `writeback-permanent-sweep-duplicates` | `updatePost` and `changeState` both fail permanently; the row stays QUEUE; the missing-posts scan republishes | unknown, then duplicate: two accepted platform sends |
| 6 | `worker-death-finalize-no-details` | two finalizes are in flight inside the first heartbeat interval when the worker is SIGKILLed: one never reached the platform, one was already accepted | one safe retry (complete) and one duplicate (unknown) |
| 7 | `worker-death-finalize-with-details` | the platform accepts finalize, a heartbeat reaches the server, then the worker is SIGKILLed | unknown: one accepted send, timeout carries `finalizePost: entered`, no retry, no release id |

The process is killed with `SIGKILL` on its process group (hard pod eviction /
OOM), then a fresh compiled candidate starts against the same database, media
volume and Temporal execution. Every restart keeps the same workflow id, run id
and type; the rehearsal records that explicitly.

## Injection points

`lib/stub-provider.cjs` is preloaded with `NODE_OPTIONS=--require` into the
real compiled process. It does three things:

1. records the same platform/e-mail boundary as ticket 12, including payload
   media SHA-256 and the exact credential handed to the provider;
2. reads `work/faults.json` on **every** provider/write-back call, keyed by post
   id, so a fault can be armed and disarmed between phases without restarting:
   - `postPending:<id>` / `finalize:<id>`: `reject`, `hang-after-accept`,
     `delay-accept-<ms>`;
   - `check:<id>`: `pending`, `hang`;
   - `updatePost:<id>` / `changeState:<id>`: `fail-once` (retryable error,
     disarms itself) or `fail` (non-retryable `ApplicationFailure`);
3. wraps the compensation repository read so cancel/delete/reschedule happen
   after the scan loaded its list, exactly as another worker or the UI could,
   and before the activity's second read.

No product module knows about `work/faults.json`. The candidate code path is
the shipped one; only the external platform and the local service seam are
instrumented. `fail-once` is deliberately retryable: the shipped
`updatePost` proxy retries after 2 minutes and the rehearsal waits for the real
backoff. `fail` is non-retryable only to keep the permanent-outage branch
inside the disk/time budget; the README records the shipped schedule (3
attempts / 2-minute backoff).

`maxConcurrentJob` on the substitute is raised to 100 so several faulted
mutations can be in flight at once; the cap belongs to the substitute, not the
product.

## Contract facts this pins

- The compensation scan re-reads the row through `getPostState(id)`, which
  filters `deletedAt: null`; a soft-deleted row therefore returns null and is
  skipped. A canceled (`ERROR`) row is skipped by the `state !== 'QUEUE'`
  check. Neither sends anything, and both keep their original `publishDate`.
- A still-QUEUE row rescheduled after the scan loaded it is dispatched (the
  second read only proves it is not deleted and still QUEUE); the workflow reads
  the new time, sleeps to it and sends once, keeping the new `publishDate`.
- `bad_body` from `finalizePost` is a platform rejection, not an unknown
  result: zero accepted finalizes, row `ERROR`, Errors row with `bad_body`, no
  retry, and an "Error posting" notification.
- A pending status that never completes is not unknown while the workflow is
  still polling: row `QUEUE`, execution `RUNNING`, one accepted `postPending`,
  no `finalizePost`, no error marker or Errors row. The exhausted-pending
  marker is the distinct `Could not confirm the post status` string after the
  90-check budget; the structural test pins that branch (the live run does not
  wait 30 minutes).
- After the platform accepted, the workflow sets `posted = true` before write-
  back. A failure then marks the row unconfirmed (`ERROR` + "couldn't confirm"
  notification) and returns; it never re-publishes. The only shipped recovery
  is the activity retry: a transient `updatePost` failure retries after the
  configured 2-minute backoff and writes `PUBLISHED`/`releaseId` without a second
  platform call.
- If both `updatePost` and `changeState` fail, the row stays `QUEUE` and is
  indistinguishable from "never published"; the compensation scan sends it
  again (two accepted platform ids). Reconciliation must inspect the platform
  ledger before re-enabling the sweep.
- A heartbeat timeout **with** details proves the finalize mutation started:
  `resolvePending` takes the `patched('post-finalize-timeout-unknown')` branch,
  marks the row unconfirmed and stops. The execution's search attributes record
  `TemporalChangeVersion: post-finalize-timeout-unknown`; the timeout event has
  `timeoutType=HEARTBEAT` and one payload (`finalizePost: entered`); the finalize
  was scheduled once and reached the platform once.
- A heartbeat timeout **without** details is classified as never-started and
  retried. That is safe when the platform had not accepted the call (one accept
  after the retry, PUBLISHED) and a genuine duplicate when the platform had
  accepted it but the worker died inside the first 15-second heartbeat interval
  (two accepted finalize ids, the first orphaned; local result points at the
  second). This is a pre-existing 15-second-window hazard, recorded as unknown
  and handed to go-live; the spec forbids adding a global idempotency system.
- The coordinated recovery object is the compatible compiled candidate, not the
  old image. Restarting it after a kill keeps the same Temporal execution
  (id/run/type), the same media file digest, the same platform ledger and the
  same database row semantics; no activity is replayed just because the process
  restarted.

## Classification ledger

`evidence/classifications.json` separates:

- **complete** — the platform accepted the send and the local result is written;
- **failed** — the platform explicitly rejected the call (bad_body);
- **pending** — the platform accepted, the workflow is still polling;
- **unknown** — the platform may have acted, the local result is missing or
  unconfirmed; `duplicate: true` when the platform ledger holds more than one
  accepted send for the same post.

## What this does not prove

- real providers/OAuth/rate limits: only the synthetic `bluesky` boundary is
  used;
- the shipped retry schedule for a permanent `updatePost` failure (3 attempts,
  2-minute backoff): the permanent branch is compressed to one non-retryable
  attempt; the branch reached is the same;
- the full 30-minute pending budget: only two in-progress checks are observed
  live and the exhausted-pending branch is pinned structurally;
- the real operator UI for a `TemporalChangeVersion` marker and its rendering;
- multiple workers, `EXCLUDE_QUEUE`, shutdown mid-publish and real Pod/imageID
  behaviour (tickets 14/18);
- coordinated database backup/restore under a real stop-write window: ticket 17
  of the previous phase rehearsed that path; here the compatible candidate
  restart is the recovery object and the media digest is only compared, not
  restored.
- pending-payload resumption after a worker restart is not exercised: the
  pending post is terminated at the end of scenario 3.

## Fast regression net

`tests/temporal-fault-recovery.test.ts` (10 tests) runs in the normal
`pnpm test` suite and pins the scan re-read, accepted-then-write-back ordering,
the three outcome branches, the patched finalize-timeout marker and the
heartbeat/no-details guard.
