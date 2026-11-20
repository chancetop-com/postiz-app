# Ticket 10 rehearsal — start the candidate image on a v2.25.3 database

Isolated, local, synthetic. Nothing here touches a real database, deployment or
platform API. The image is built by `./k8s/build-local.sh`; this directory only
runs it.

## What is exercised

1. **Old database.** A throw-away PostgreSQL 15 is created with the frozen
   v2.25.3 schema from commit `838843077` (`old-schema.prisma`, the same file
   the v2.25.3 image shipped) using the pinned Prisma 6.5.0 CLI from the
   candidate image. The candidate schema differs from that file by exactly the
   five v2.26.0 indexes, which is checked again against a reference database
   pushed from the candidate schema.
2. **Synthetic data.** `seed-old.sql` inserts identity, organization membership
   with roles/disabled, channels with their `internalId`/`rootInternalId`
   grouping and credentials, posts with `state`/`publishDate`/`parentPostId`/
   `deletedAt`, users with integer and IANA timezones, notifications, errors,
   media rows and a static OAuth app. 200 000 posts / 80 000 notifications /
   50 000 errors exist only so the index build and lock waits are measurable.
3. **Real startup.** The candidate image runs with its real entrypoint
   (`pnpm run prisma-db-push` then nginx + PM2). Redis and a Temporal
   auto-setup server are isolated substitutes for the deployment services; the
   API does not finish bootstrapping without Temporal.
4. **Retention.** Before and after every start, the rehearsal compares primary
   key sets and whole-row digests for identity, membership, channels, posts,
   notifications, errors, subscriptions and media. Credentials are compared as
   a digest only; no plaintext is printed. A normalized `pg_dump --schema-only`
   diff must contain exactly the five `CREATE INDEX` statements and nothing
   else.
5. **Media.** A real named volume mounted at `/uploads` holds the old
   `uploads/2025/01/launch.png` and its thumbnail. The old row must still point
   at it and nginx must serve the exact bytes. A new file is uploaded through
   the application's own `LocalStorage` and both files are read again after a
   container restart.
6. **Idempotence.** A second start must report the database as already in sync,
   run no DDL, leave the schema and every digest identical and keep all three
   PM2 processes online.
7. **Failure exits.** One sample points at an unreachable database; another
   points at a copy of the upgraded database with an unmanaged table that holds
   rows, so the official sync refuses without `--accept-data-loss`. Both must
   exit non-zero, and neither API nor worker may start.
8. **Measurements.** The PostgreSQL log records every DDL statement and lock
   wait. The first sync runs under a controlled `ROW EXCLUSIVE` lock on `Post`
   so the index build has a real wait. Pure build times are then measured on a
   copy of the upgraded sample, and a concurrent writer shows that writes block
   during `CREATE INDEX`.

The inactive `k8s/Dockerfile.runtime` is attempted and its missing artifact
path is recorded; it is not claimed as verified (see the build log).

## How to run

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"

# from the repository root, on a committed clean tree
./k8s/prepare-build-context.sh
./k8s/build-local.sh --tag postiz-ticket10:<sha>

cd .scratch/postiz-v2.26.0-implementation/rehearsals/10
IMAGE=postiz-ticket10:<sha> ./run-rehearsal.sh
```

The script exits non-zero if any assertion failed. It leaves evidence under
`evidence/` and removes its containers, network and volume; `evidence/summary.txt`
is the per-assertion result. No registry login, push or deployment is performed.

## Files

| File | Purpose |
| --- | --- |
| `old-schema.prisma` | frozen v2.25.3 schema from `838843077` |
| `seed-old.sql` | curated old rows + the volume sample |
| `inventory.sql` | primary-key sets and column digests (no plaintext) |
| `indexes.sql` | the five expected index names/definitions |
| `sample-size.sql` | row counts and table/database size |
| `legacy-launch.png` / `.thumb.png` | the old media bytes placed in the volume |
| `run-rehearsal.sh` | the whole exercise, with assertions |
| `evidence/` | logs, dumps, timings and `summary.txt` |

## Notes

- The old schema is a committed historical file, not a claim about any real
  deployment's extensions, data shape or upgrade history.
- PostgreSQL 15, Redis and Temporal are local substitutes, not the deployment
  versions. Temporal, KMS and real channels are out of scope for this ticket.
- The image is local: the image ID is meaningful for this Docker daemon only.
  There is no registry digest because nothing was pushed.

## Findings from the run

- **Temporal testing attributes.** `temporalio/auto-setup` registers
  `CustomStringField`/`CustomTextField` "for testing". Together with the
  backend's `organizationId`/`postId` that exceeds the substitute's 3-Text
  limit, so the backend cannot listen (the API stays 502 while PM2 says
  `online`). The rehearsal removes the two unused testing attributes after the
  default namespace exists and before the application starts, then proves the
  real startup add path registers both attributes. The deployment Temporal
  already has an attribute budget; ticket 12/13 should check the real namespace
  budget. This is an environment/substitute finding, not a database/media
  regression.
- **Startup sync also generates the client.** The entrypoint's
  `pnpm run prisma-db-push` runs `prisma db push` and then Prisma generate
  (no `--skip-generate`), which writes the client inside the image after the
  schema is in sync. The database sync still finishes first and the application
  command waits for it; this is existing root-script behaviour, not a new
  delivery script.
- **Inactive runtime image.** `k8s/Dockerfile.runtime` cannot be built from the
  prepared context: `k8s/.dockerignore` excludes `node_modules`,
  `apps/backend/dist`, `apps/orchestrator/dist` and `apps/frontend/.next`, the
  preparer deletes or excludes the same paths, and no repository script
  produces Linux build artifacts into `k8s/`. The host `node_modules` is a
  macOS hardlink copy, so copying it into a Linux image would be invalid. The
  build attempt and exact error are in `evidence/70-runtime-image-build.log`;
  it is recorded as unverified and was not used as a substitute for the
  source-built image.
- **HTTP multipart upload.** The new file is written through the application's
  own `LocalStorage` class (the same implementation the HTTP upload routes
  call), not through an authenticated multipart request. Ticket 13 covers the
  HTTP route; this ticket's evidence is about the mounted volume and retention.

