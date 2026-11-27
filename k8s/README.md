# Container Packaging & Deployment (`k8s/`)

This directory contains the layered container definitions, build/publish/deploy
scripts, shared cache helpers (`k8s/lib/`), and offline contract test suites
(`k8s/tests/`) for the single-image Postiz deployment (nginx + PM2 running
`backend`, `frontend`, and `orchestrator`).

All local builds and remote Azure Container Registry (ACR) publishes build
from a snapshot of the **repository root** (`.`) using the root `.dockerignore`
rules (see [ADR-0001](../docs/adr/0001-acr-layered-build-cache.md)). Source
files are never copied into `k8s/`, and no directory-sync utility is required.

## Actions & Manual Boundary

These are separate actions on purpose. None of them implies the next one.

| Action | Command | Touches |
| --- | --- | --- |
| local build | `./k8s/build-local.sh [--tag NAME] [--allow-dirty] [--rebuild-cache]` | local Docker daemon only |
| publish | `./k8s/build-postiz.sh [tag] [--allow-dirty] [--rebuild-cache]` or `--local <image>` | ACR (`FBRDevAcr`) |
| deploy | `./k8s/deploy-postiz.sh --image <ref> [--namespace NAME]` | Kubernetes cluster |
| one-command wrapper | `./k8s/publish-and-deploy.sh [--deploy] [--dry-run] [--allow-dirty] [--rebuild-cache] [--namespace NAME] [tag]` | publish (→ deploy only with `--deploy`) |

- **`build-local.sh`** operates strictly against the local Docker daemon. It
  never logs in to a remote registry, never pulls private ACR images, never
  pushes images, and never touches Kubernetes.
- **`build-postiz.sh`** publishes to ACR only and never deploys to Kubernetes.
- **`deploy-postiz.sh`** updates the Kubernetes deployment image and waits for
  rollout; it never builds or publishes.
- **`publish-and-deploy.sh`** runs publish by default and rolls out to
  Kubernetes only when `--deploy` is explicitly passed. `--dry-run` validates
  inputs and worktree state and prints the exact layered plan without executing
  any external commands.
- Real remote ACR publishes and live cluster rollouts are **manual operator
  actions**. Automated test suites and local verification never log in to ACR,
  push images, or mutate Kubernetes deployments. `.github/workflows` build
  automation stays disabled; no CI run is treated as build evidence.

Each build captures the repository root once. A clean build exports the selected
commit with `git archive`. With `--allow-dirty`, Git captures tracked files
and non-ignored untracked inputs in a temporary index and object directory.
The snapshot preserves tracked root files and the repository directory layout.
Dockerfiles, cache hashes, provenance and all four build contexts use that
snapshot until the run finishes. Azure CLI receives the exported tree without
the checkout's Git directory, dependency installs or Git file-monitor socket.

## Four-Layer Cache Architecture

Container packaging is split into four dedicated Dockerfiles under `k8s/` so
both local Docker and classic non-BuildKit remote builders (`az acr build`)
deterministically skip unreferenced OS and dependency installation stages:

1. **`k8s/Dockerfile.base`** — Runtime OS base starting from
   `node:22.23.4-bookworm-slim`, installing `nginx`, `curl`, pinned
   `pnpm@10.6.1`, and `pm2`, and creating the `www` system user plus writable
   `/uploads` and `/app` directories (preserving the root/PVC permission model).
2. **`k8s/Dockerfile.deps`** — Builder dependencies starting from
   `node:22.23.4-bookworm`, installing pinned `pnpm@10.6.1`, copying only
   workspace dependency manifests (`.npmrc`, root & workspace `package.json`
   files, `pnpm-lock.yaml`, `pnpm-workspace.yaml`),
   `apps/frontend/scripts/fetch-gtm.mjs`, and `schema.prisma`, running
   `pnpm install --frozen-lockfile`, generating the local Prisma `6.5.0` client,
   and ensuring `@prisma/engines` binaries exist.
3. **`k8s/Dockerfile.runtime-deps`** — Pruned runtime dependencies inheriting
   `DEPS_IMAGE` and `BASE_IMAGE`. Because `.npmrc` uses `node-linker=hoisted`,
   pruning runs `CI=true npm_config_offline=true pnpm prune --prod --ignore-scripts`
   (preventing non-TTY interactive prompts and offline optional-package stalls)
   while explicitly saving and restoring `/app/node_modules/.prisma` and
   `/app/node_modules/@prisma/engines` binaries across the prune. Leaving
   upstream `package.json` `dependencies` untouched (per ADR-0001) prunes pure
   `devDependencies` (such as `eslint`, `@nestjs/testing`,
   `@testing-library/react`, `@temporalio/testing`, and `tsup`; ~1,132 packages),
   while `typescript` (via `@nestjs/cli`) and `vitest` (via
   `@copilotkit/runtime` → `@copilotkit/channels-core`) remain transitively
   reachable from upstream `dependencies`. The stage then layers the pruned
   `node_modules` onto `BASE_IMAGE` and verifies offline that the pinned local
   Prisma `6.5.0` CLI, Query Engine, Schema Engine, and `@prisma/client` work
   without network access.
4. **`k8s/Dockerfile`** — Single application image whose `builder` stage
   inherits `DEPS_IMAGE` to compile `frontend`, `backend`, and `orchestrator`
   (`pnpm run build`) and drop `apps/frontend/.next/cache`, and whose `runtime`
   stage inherits `RUNTIME_DEPS_IMAGE` to copy only compiled outputs, runtime
   configs (`var/docker/entrypoint.sh`, `var/docker/nginx.conf`,
   `var/docker/ecosystem.config.cjs`), `schema.prisma`, and root `package.json`.

### Cache Repositories & Tag Strategy

In ACR, the three cache layers are stored in **three separate repositories**
under `ops/` so per-repository retention policies (`acr purge --keep 3 --ago 3d`)
never evict active layers across categories. Local builds mirror the exact same
four-layer dependency order using local Docker tags:

| Layer | Local tag | ACR repository & tag | Invalidated when |
| --- | --- | --- | --- |
| Runtime OS base | `postiz-base:<base-tag>-<platform>` | `ops/postiz-base:<base-tag>` | `engines.node`, `packageManager`, or `k8s/Dockerfile.base` changes |
| Builder deps | `postiz-deps:<deps-hash>-<platform>` | `ops/postiz-deps:<deps-hash>` | `<base-tag>`, `.npmrc`, root/workspace `package.json` files, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `fetch-gtm.mjs`, `schema.prisma`, `k8s/Dockerfile.deps`, or `k8s/Dockerfile.runtime-deps` changes |
| Runtime deps | `postiz-runtime-deps:<runtime-tag>` | `ops/postiz-runtime-deps:<runtime-tag>` | same `<deps-hash>` inputs, or when base/deps cache layer is rebuilt |
| Application | `postiz-candidate:<tag>` | `app/postiz:<tag>` (+ `:latest` on clean tree only) | every application build (packages only incremental compiled layers) |

Cache tags are computed deterministically by `k8s/lib/build-cache.sh`:

- `<base-tag>`: `node<node-version>-pnpm<pnpm-version>-<12-hex-sha256(k8s/Dockerfile.base)>`
- `<deps-hash>`: 16-character lowercase hex SHA-256 over `<base-tag>` and all
  canonical dependency, Prisma schema, and cache-Dockerfile inputs.
- Local parent tags include the target OS, architecture and optional variant.
  Set `DOCKER_DEFAULT_PLATFORM` to build for a different target.
- `<runtime-tag>`: `<deps-hash>-<parents-hash>`. The suffix hashes the resolved
  base and builder-deps IDs locally, or their manifest digests in ACR. An
  interrupted refresh therefore resumes with the matching parents on retry.
  The first publish after this change builds one new runtime-deps tag.

On routine business-code changes, layers 1–3 are cache hits and only layer 4
(`k8s/Dockerfile`) builds, shipping only incremental application layers.

Set `BUILD_ACR` to publish to another registry. The publisher looks up its
login server unless `BUILD_ACR_HOST` explicitly supplies the hostname. A
dry run displays a placeholder for a hostname or local candidate tag that
requires a live lookup.

## Worktree Guards & Cache Flags

Before invoking Docker or `az`, `k8s/lib/build-cache.sh` validates all required
repository-root inputs and enforces a clean Git working tree:

- **Clean tree by default**: uncommitted changes or untracked files cause
  `build-local.sh`, `build-postiz.sh`, and `publish-and-deploy.sh` to exit `2`
  so accidental edits cannot ship under a clean commit tag.
- **`--allow-dirty`**: explicitly permits building or publishing from a dirty
  working tree and automatically appends `-dirty` to the default 12-character
  HEAD SHA tag (`<short-sha>-dirty`). Dirty ACR publishes (both layered builds
  and `--local` pushes) push **only** `app/postiz:<tag>` and never overwrite
  `app/postiz:latest`. Local provenance also records `worktreeState: "dirty"`
  and a `worktreeDigest`. Explicit `latest` is rejected for dirty builds.
  Local candidates carry their source commit and worktree state as image labels.
  Promotion pushes the selected image ID under a per-run staging tag, then
  uses `docker buildx imagetools create --prefer-index=false` to assign the
  release tags to that registry digest. Cleanup removes the staging tag with
  `az acr repository untag`. An account lacking untag permission can still
  publish and receives a cleanup warning. Older images can use the
  matching local provenance record. Both the image and checkout must be clean
  to publish the `latest` alias. The wrapper deploys the published tag and its
  manifest digest so replacing an existing tag also triggers a rollout.
- **`--rebuild-cache`**: forces rebuilding all three cache layers
  (`base` → `deps` → `runtime-deps`) even when matching tags already exist
  locally or in ACR (for OS security updates or recovering a stale/corrupted
  layer). In `build-local.sh`, `--rebuild-cache` passes `--no-cache` to
  `docker build` for layers 1–3 so local Docker/BuildKit genuinely refreshes OS
  packages and dependencies. The two stages based on public Node images also
  pass `--pull` to fetch the current upstream base digests.

Root `.dockerignore` keeps the uploaded build context minimal and safe by
excluding `node_modules`, `.pnpm-store`, `dist`, `.next`, `*.tsbuildinfo`,
local `.env*`, `.secrets`, `.apple/`, PEM and P8 keys, `.git`, docs, tests, `.scratch`, non-deployed
sub-app source trees (`apps/commands/**`, `apps/extension/**`, `apps/sdk/**`
while preserving their `package.json` manifests for frozen-lockfile workspace
validation), and packaging scripts/tests under `k8s/**` (while keeping the four
canonical Dockerfiles and the ACR application task reachable). The development image has its own `Dockerfile.dev.dockerignore` to retain the
  extension, SDK and CLI sources. Old source copies
under `k8s/` stay Git-ignored so existing checkouts can upgrade in place.

The local GTM asset `apps/frontend/public/g.js` is excluded from both image
contexts. When `NEXT_PUBLIC_GTM_ID` is configured for a deployment, its
entrypoint fetches the matching script before Next starts. A failed download
leaves analytics disabled for that start and allows the application to run.

## Runtime Contracts & Compilation Behavior

- **Frontend**: uses plain Next.js output (no `output: 'standalone'`), started
  with `next start -p 4200` from `/app/apps/frontend` via the hoisted binary
  `/app/node_modules/next/dist/bin/next`. Production browser sourcemaps and the
  `@sentry/nextjs` build wrapper are disabled automatically when
  `SENTRY_AUTH_TOKEN` is unset or empty, and reactivate automatically when
  `SENTRY_AUTH_TOKEN` is provided. Set `SENTRY_ORG` and `SENTRY_PROJECT` for
  the upload destination. Local builds use a BuildKit secret mount. The cloud
  application stage uses `az acr run` and a secret volume in `k8s/build-app.yaml`
  to provide the token only for compilation. Both compilers receive the captured
  source commit as `SENTRY_RELEASE`. Development retains the Next.js
  default sourcemaps.
- **Backend & Orchestrator**: `tsconfig.build.json` disables unused `.d.ts`
  declaration emission while retaining `.js.map` sourcemaps for runtime stack
  traces. Workspace builds remain serial (`--workspace-concurrency=1`) to stay
  within 2 vCPU / 4 GB heap limits.
- **Three processes & healthcheck**: `nginx` listens on port `5000` (proxying
  `/api/` to `backend` on `3000`, serving `/uploads/`, and proxying `/` to
  `frontend` on `4200`) alongside `pm2-runtime ecosystem.config.cjs` running
  `backend`, `frontend`, and `orchestrator`. `HEALTHCHECK` probes
  `http://localhost:5000/api/` (backend root `GET /`; `/api/health` is not used).
- **Startup schema sync**: `ENTRYPOINT ["/app/var/docker/entrypoint.sh"]` runs
  `pnpm run prisma-db-push` via the pruned local pinned Prisma `6.5.0` CLI
  before starting nginx and PM2, failing closed if schema sync fails.

### Runtime Configuration (Zero `NEXT_PUBLIC_*` Build Args)

No `NEXT_PUBLIC_*` value is baked into any image. Server components in
`apps/frontend/src/app/*/layout.tsx` read `process.env` at request time and
deliver public values to client modules through `VariableContext`. Changing a
ConfigMap/Secret value requires only a pod restart, not an image rebuild, and
the same image runs across environments. `build-local.sh` and `build-postiz.sh`
pass cache image references and optional Sentry upload settings to the builder.

### Local Provenance (`k8s/BUILD_PROVENANCE.json`)

Every `build-local.sh` run writes gitignored `k8s/BUILD_PROVENANCE.json`
(schema v2) recording `imageTag`, local `imageId`, `published: false`,
`registryDigest: null`, target OS/architecture, source commit/ref/worktree state
and digest, resolved `cacheLayers` (`baseTag`, `depsHash`, image IDs, and
`hit`/`built`/`rebuilt` status), SHA-256 digests of repository-root build
inputs and pinned toolchain versions (`node`, `pnpm`, `prisma`). The recorded
Node base references have null upstream digests and IDs. The observed image
IDs belong to the Postiz cache layers. GTM is acquired at startup, so the
candidate records an empty `generatedAssets` list.

## Verification

Offline contract and CLI orchestration suites (fast; require no Docker, ACR, or
Kubernetes access):

```bash
./k8s/tests/cache-layers.test.sh       # cache keys, required inputs and worktree validation
./k8s/tests/build-pipeline.test.sh     # stubbed local build, publish and deployment flows
./k8s/tests/runtime-contract.test.sh   # toolchain pins, no NEXT_PUBLIC_* build args, plain Next, PM2, healthcheck
```

To verify the rendered ACR task for all combinations of Sentry and `latest`,
run `ruby k8s/tests/acr-task.test.rb` with Ruby and kubectl installed. It uses
client-side template rendering and an empty kubeconfig.

With a local Docker daemon, run `./k8s/tests/docker-context.test.sh` to check
which files Docker includes for release and development builds. It exports
two scratch images from synthetic files to a temporary directory.

Local-only four-layer daemon verification and dry-run planning (zero push, zero
cluster changes):

```bash
./k8s/build-local.sh                       # cold build of all 4 local layers + BUILD_PROVENANCE.json
./k8s/build-local.sh                       # repeat build confirming local cache hits on layers 1-3
./k8s/publish-and-deploy.sh --dry-run      # inspect layered ACR publish plan without executing commands
```

## Not a Verification Shortcut

- `k8s/build-postiz.sh` never deploys. Rollout requires an explicit
  `./k8s/deploy-postiz.sh --image <ref>` or
  `./k8s/publish-and-deploy.sh --deploy`.
- Static checks and local container builds do not replace full end-to-end
  runtime verification (three-process startup, `/api/` readiness, database
  schema sync, media persistence across restarts, and Temporal workflow
  compatibility).
