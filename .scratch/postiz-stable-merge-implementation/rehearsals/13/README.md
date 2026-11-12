# Ticket 13 rehearsal — the candidate image really runs three processes

Local and isolated. Nothing here is pushed, deployed or pointed at real
credentials or a real database.

## What is exercised

1. The image built by `./k8s/build-local.sh` is started with its **real
   entrypoint** (`var/docker/entrypoint.sh`) and the **real PM2 config**
   (`var/docker/ecosystem.config.cjs`) against a throw-away PostgreSQL 15, a
   throw-away Redis and an isolated Temporal server, with a named volume
   mounted at `/uploads`.
2. Toolchain and native dependencies are loaded **inside** the image: Node,
   pnpm, the Prisma CLI, the generated Prisma client against the real database,
   `bcrypt`, `sharp` and the Temporal worker/core-bridge packages.
3. PM2 must report exactly `backend`, `frontend` and `orchestrator` online, on
   the real Nest output paths and the hoisted Next entry, and nginx 5000 must
   reach backend 3000 and frontend 4200.
4. HTTP contract: `/api/` returns the backend root route, `/api` is recorded
   exactly as it behaves, the frontend keeps its iframe CSP, and the API keeps
   its origin/exposed-header contract.
5. Public build configuration: a non-secret sentinel supplied at build time is
   present in the browser bundle; values supplied only at runtime never replace
   the `NEXT_PUBLIC_*` build values, while non-public values (FRONTEND_URL,
   STORAGE_PROVIDER, IS_GENERAL) do follow the runtime environment.
6. Media: an old file on the volume is readable through nginx; a new upload
   through the app's own `LocalStorage` is written with the image user, served
   through nginx, streamed with a `Range` request through the direct Next route,
   deleted through the same storage layer, and a later upload survives a
   container restart together with the old file.
7. `BUILD_PROVENANCE.json` is copied into the evidence.

## How to run

Prerequisites (all local, all throw-away):

- the Temporal CLI on `PATH` or in `TEMPORAL_BIN` (the dev server is used as the
  external Temporal substitute; **the API never finishes starting without a
  reachable Temporal server** — `TemporalRegisterMissingSearchAttributesModule`
  awaits a real operator call in `onModuleInit`, so nginx answers 502 and the
  container stays unhealthy);
- `redis:7-alpine` locally, or the script installs `redis-server` into a
  throw-away container of the candidate image instead.

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"
./k8s/prepare-build-context.sh --allow-dirty
NEXT_PUBLIC_VERSION=ticket13-build-sentinel \
  ./k8s/build-local.sh --tag postiz-ticket13:candidate

cd .scratch/postiz-stable-merge-implementation/rehearsals/13
IMAGE=postiz-ticket13:candidate ./run-rehearsal.sh
```

`NEXT_PUBLIC_VERSION` is a harmless display value; using it as the sentinel
proves the build-time-inlining channel without changing a functional address.
The rehearsal fails with a clear message if the image was built without it.

Everything is written to `evidence/`; `evidence/summary.txt` lists every
assertion with PASS/FAIL and the script exits non-zero if any failed. Containers,
network and volume are removed afterwards; the database never leaves its
container.

## Files

| File | Purpose |
| --- | --- |
| `run-rehearsal.sh` | the whole exercise, with assertions |
| `evidence/summary.txt` | one line per assertion, PASS/FAIL |
| `evidence/50-provenance.json` | the image's build provenance |

## Boundaries

- Temporal is the CLI dev server, not the deployment's `temporalio/auto-setup`
  and not the deployment's namespace/version. It is only there so the API can
  finish bootstrapping; workflow execution and history replay belong to
  ticket 14.
- Redis is either `redis:7-alpine` or a `redis-server` installed into a
  throw-away container of the candidate image (used when that image cannot be
  pulled). Queue behaviour is not asserted.
- No real OAuth/SSO account, channel or parent application is used. The parent
  origin is only checked as the build-time value in the bundle and rendered
  payload.
- Redis is started only so the API boots. Queue behaviour is not asserted.
- Uploads are exercised through the application's own storage implementation
  and the Next/nginx read entries, not through an authenticated browser upload;
  the editing/Import flows are ticket 10's.
- The image user is the image's real user (root, for the PVC permission model).
