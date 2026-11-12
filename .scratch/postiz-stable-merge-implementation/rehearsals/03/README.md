# Ticket 03 rehearsal — official startup sync and data retention

Isolated, local, synthetic. Nothing here talks to a real database, a real
Postiz deployment or a platform API.

## What is exercised

1. A **PostgreSQL 15** container is built with the frozen pre-merge schema
   (`old-schema.prisma`, 48 models, taken from `6fdf7cb5`) using the same
   Prisma 6.5.0 CLI, then seeded with synthetic records covering users,
   organizations, memberships/roles/disabled, integrations with their
   `internalId`/`rootInternalId` grouping and credentials, posts, media,
   subscriptions and a static OAuth app. `seed-spans.sql` adds the Mastra
   `mastra_ai_spans` table in its pre-merge shape (both schemas mark the model
   `@@ignore`, which keeps it out of the client but does not stop `db push`
   from creating and altering the table).
2. The **candidate image** built by `./k8s/build-local.sh` is started with its
   real entrypoint (`var/docker/entrypoint.sh`), which runs the official root
   script `pnpm run prisma-db-push` and only then the application command.
3. The same container is started again (repeated start), against an unreachable
   database (connection failure) and against a database containing an unmanaged
   table with rows (a change the official sync refuses without
   `--accept-data-loss`).
4. Retention is compared before/after on primary-key sets, per-column digests
   and relations — not row counts. Credentials are compared as digests only.
5. The duplicate `(traceId, spanId)` sample is checked against the sync and
   against the real `PostgresStore.init()` the API runs.

## How to run

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"
./k8s/prepare-build-context.sh --allow-dirty
./k8s/build-local.sh --tag postiz-ticket03:candidate

cd .scratch/postiz-stable-merge-implementation/rehearsals/03
IMAGE=postiz-ticket03:candidate ./run-rehearsal.sh
```

Everything is written to `evidence/`; `evidence/summary.txt` lists every
assertion with PASS/FAIL and the script exits non-zero if any failed. The
containers, network and volumes are removed afterwards; the database itself
never leaves the isolated container.

Files:

| File | Purpose |
| --- | --- |
| `old-schema.prisma` | frozen pre-merge schema, builds the old database |
| `seed-old.sql` | synthetic business data |
| `seed-spans.sql` / `seed-spans-duplicate.sql` | Mastra spans, including the duplicate composite key sample |
| `inventory.sql` | before/after retention digests (columns that exist in both schemas) |
| `post-checks.sql` | new defaults, new models, new indexes, spans state |
| `mastra-init.mjs` | the real `PostgresStore.init()` the API runs |
| `recover-spans.sql` | documented spans migration (mirrors `npx mastra migrate`) |
| `upgraded-sample.sql` | the upgraded synthetic database, reusable by later tickets |
| `run-rehearsal.sh` | the whole exercise, with assertions |

## Recovery paths

The startup chain is deliberately not bypassable: there is no flag, environment
variable or retry that starts the API or the worker after a failed sync. What an
operator does about a failure is a separate, explicit decision.

### 1. The sync cannot reach the database

Symptom: `P1001`/`P1003` in the container log, followed by
`[startup-sync] schema sync FAILED` and `refusing to start`; the container exits
non-zero and no application process exists.

Action: fix the connection (`DATABASE_URL`, network policy, database state),
restart. The database was not touched, so nothing else is required.

### 2. The sync refuses a destructive change

Symptom: Prisma lists the change and asks for `--accept-data-loss`; the
container exits non-zero. Typical causes: an unmanaged table/column with rows, a
narrowed type, a new required column without a default.

Do **not** add `--accept-data-loss`, do not reset, and do not drop tables to get
a green start. Instead:

1. Keep the log and capture the structure: `pg_dump --schema-only` before and
   after the failed attempt. A failed sync is not guaranteed to have changed
   nothing; the rehearsal records that diff (`14-schema-diff-after-failure.txt`).
2. Take a data backup of the affected objects.
3. Decide with the data owner what happens to the object that blocks the change
   (export it, move it to an archive schema/table, then drop it; or adapt the
   schema if the object is still used).
4. Restart. The official sync runs again and must succeed on its own.

### 3. Duplicate `(traceId, spanId)` spans

Symptom: the container syncs and starts, but `PostgresStore.init()` throws
`MIGRATION_REQUIRED: Duplicate spans detected in mastra_ai_spans`. MCP/agent
startup is non-fatal in `apps/backend/src/main.ts`, so the API stays up while
agent features are unavailable.

The official `db push` cannot fix this: the new schema adds the composite
primary key to `mastra_ai_spans`, so the sync itself fails with
`P2002 Unique constraint failed on the fields: (traceId, spanId)` and the
container never starts. The sync does not delete the duplicates.

Resolve it deliberately, with a backup of the spans table, by keeping one row
per `(traceId, spanId)` (completed/most recent, which is what
`npx mastra migrate` does) and adding the primary key under the name the Prisma
schema maps, `public_mastra_ai_spans_traceid_spanid_pk` —
`recover-spans.sql` is the exact statement set. The name matters: Prisma 6.5.0
fails to apply its own sync when it has to rename a differently named primary
key in the same `ALTER TABLE` that adds the new span columns (it emits
`ERROR: syntax error at or near ","` for
`AlterTable { changes: [RenamePrimaryKey, AddColumn, ...] }`), which blocks
every later start. After `npx mastra migrate` renamed the constraint to
Mastra's default name, rename it before the next start. Never delete traces
merely to make the start succeed.

### 4. A failed sync left a partial change

Compare the before/after schema dumps and check which statements were applied
before the failure. Re-running the same official command is safe and
idempotent; re-running the old image is not (its startup command still contains
`--accept-data-loss`), so a rollback needs a verified compatible candidate or a
coordinated database/media/Temporal restore.

## Boundaries

- PostgreSQL 15 is the version declared by the deployment manifests; the real
  server version, its extensions and its actual data are not verified here.
- Temporal, the platform APIs and real credentials are out of scope: the
  rehearsal proves database structure/data retention and the startup ordering.
- Media files are not present on disk; media rows, paths, thumbnails and the
  post JSON references are.
- Redis is not part of the isolated environment: only the candidate's startup
  ordering is asserted, so queue connections may log errors during the real
  application start. They do not affect the sync-before-start evidence.
- The rehearsal does not publish, deploy or migrate any real database.
