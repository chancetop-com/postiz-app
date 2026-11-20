# Ticket 12 — in-flight Temporal continuity rehearsal

Proof that the candidate v2.26.0 worker takes over work that the customised
v2.25.3 left behind: sleeping posts, repeat children, delayed comments, refresh
backlogs, the e-mail singleton, provider-queue executions and the hourly
maintenance sweep. The candidate processes run unmodified; only the platform
and e-mail boundaries are substituted.

Everything is synthetic and local. The rehearsal uses the isolated
`postiz-ticket-12` Temporal namespace (created on first use), a dedicated
PostgreSQL database and Redis database. It does not touch the `default`
namespace, the main checkout or any real provider.

## Run it

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

# pre-upgrade histories against the current candidate bundle (offline)
node .scratch/postiz-v2.26.0-implementation/rehearsals/12/run.mjs replay

# real workers consuming in-flight work (needs the compiled orchestrator)
node .scratch/postiz-v2.26.0-implementation/rehearsals/12/run.mjs live

# both
node .scratch/postiz-v2.26.0-implementation/rehearsals/12/run.mjs all
```

Prerequisites:

- `pnpm run build:orchestrator` (the runner starts the compiled
  `apps/orchestrator/dist/apps/orchestrator/src/main.js`);
- PostgreSQL `postiz-postgres` with a `postiz-ticket-12` database
  (`pnpm prisma-db-push` with `DATABASE_URL` pointing at it);
- Redis on `localhost:6379` (the rehearsal uses database 12);
- Temporal on `localhost:7233` (the runner creates the isolated namespace);
- the ticket-14 legacy workflow sources under
  `.scratch/postiz-stable-merge-implementation/rehearsals/14/legacy/base/`
  (read-only; their fixtures are not regenerated here).

The defaults match the ticket brief; override `DATABASE_URL`, `REDIS_URL`,
`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` or `UPLOAD_DIRECTORY` if needed.
`--only <scenario-id>` runs one scenario; `--list` prints the ids.

Results land in `results/latest.json` and `results/replay-latest.json`;
`evidence/summary.txt`, `evidence/latest.json` and `evidence/call-log.jsonl`
are the committed observations. The call ledger is the normal sample ticket 13
can compare a failure run against: every platform/e-mail call, its target,
credential, payload, media digest and timestamp.

## What is replayed and what is live

`replay` reproduces the ticket-14 proof on the candidate bundle: **16
pre-upgrade histories / 16 pass** — V101, V102 (including the delayed comment,
in-flight sleep, refresh and repeat child), the legacy e-mail singleton and
continuation, autopost, missing sweep and streak, each generated from the
customised v2.25.3 sources (or the documented patch-gated derivations), never
from the candidate. V112 has no pre-upgrade history by definition; its live
normal path is covered by the `v112-pending-finalize` scenario.

The live matrix uses a real (non-test) Temporal server:

| # | scenario | in-flight object | proves |
| --- | --- | --- | --- |
| 1 | `v101-sleep-takeover` | old-bundle V101 sleeping until `publishDate` | same workflow id/run/type after hand-over; blocking `postSocial` once; `publishDate` unchanged; result and media write-back |
| 2 | `v102-delayed-comment` | old-bundle V102 with root + one-minute comment | root publishes once; `postComment` runs once after the stored delay under the root platform id; both rows `PUBLISHED` |
| 3 | `v102-repeat-child` | old-bundle V102 parent | candidate consumes the parent and its V102 repeat child; both publish with the blocking contract; child id `post_<id>_<suffix>` |
| 4 | `v112-pending-finalize` | new V112 | `postPending` → `checkPostStatus` → `finalizePost` exactly once each; finalize result written back; publish date/timezone unchanged |
| 5 | `refresh-backlog` | old `refreshTokenWorkflow` on an expired timer | decorated `refreshToken` activity runs; `enc:v1:` tokens decrypted before the provider call; rotated tokens stored encrypted |
| 6 | `legacy-email-drain` | pre-existing `send_email` singleton with a queued message | candidate drains the backlog and a later signal through the old `sendEmail` activity on `main`; exactly two recipients |
| 7 | `compat-provider-queue` | V102 whose workflow task queue is `bluesky` | with `COMPAT_WORKFLOW_QUEUES=bluesky` the provider queue has a workflow poller and completes; unlisted `x` stays activity-only |
| 8 | `missing-scan` | `missingPostWorkflow` first sweep | re-read skips a post published after the scan loaded it; deleted and already-published rows dispatch nothing; the still-QUEUE row starts V112 and publishes |

The repeat-child fixture uses `intervalInDays = -1` only to make the one-day
repeat timer due immediately; the workflow's `startChild` branch and resulting
V102 child are unchanged. The database value is cleared after the parent has
loaded it, so the child does not create an accelerated chain.

## Architecture

| piece | what runs |
| --- | --- |
| Temporal | the isolated `postiz-ticket-12` namespace on the provided server; search attributes `postId`/`organizationId` are TEXT |
| database | `postiz-ticket-12`; synthetic orgs, users, channels, media and posts only |
| cache | Redis database 12 |
| candidate | the compiled orchestrator per scenario, with `COMPAT_WORKFLOW_QUEUES=bluesky` where relevant |
| legacy | an in-process `Worker` running the ticket-14 sources verbatim; stopped before the candidate starts, so the same execution is handed over |
| substitutions | `lib/stub-provider.cjs`, preloaded with `NODE_OPTIONS=--require`: synthetic `bluesky` post/pending/check/finalize/comment/refresh and the e-mail provider |

The maintenance race hook is the only additional injection: when
`T12_SCAN_RACE_POST` is set, the repository wrapper updates that post to
`PUBLISHED` immediately after the scan's first query, exactly as another worker
could. The activity's own second read is what skips the dispatch.

## Contract facts pinned

- New starts use `postWorkflowV112` on `main`; old executions keep
  `postWorkflowV101/V102`, their workflow id, run id, task queue, search
  attributes and history.
- V101/V102 call the blocking `postSocial`; V112 calls `postSocialPending`,
  `checkPostStatus` and `finalizePost` as separate activities.
- Provider queues are activity-only unless listed in `COMPAT_WORKFLOW_QUEUES`;
  `main` is always a workflow queue.
- `IntegrationsActivity.refreshToken` stays decorated and decrypts the stored
  credentials before refreshing.
- Old e-mail backlogs still use `send_email`/`sendEmailWorkflow` on `main`.
- The missing-post sweep re-reads the row and only dispatches an undeleted,
  still-`QUEUE` root; `signalWithStart` uses `post_<postId>` and V112.
- Platform and e-mail calls go only to the local substitutes; no provider was
  contacted.

## What this rehearsal does not prove

- real provider OAuth/token validity, rate limits and six-channel binding
  (tickets 09/11 and the final acceptance run);
- pending/finalize failure and unknown-outcome recovery (ticket 13);
- multiple workers, worker shutdown mid-publish, `EXCLUDE_QUEUE` and
  `WORKER_CONCURRENCY_DIVIDER` (tickets 13/14);
- the deployed namespace's real task-queue distribution, search-attribute
  types and Temporal server version; this rehearsal creates its own namespace;
- a real one-day repeat interval (accelerated as described above), real e-mail
  delivery and real webhook delivery.
