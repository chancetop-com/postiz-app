# Build context (`k8s/`)

This directory is the container build context for the single-image deployment
(nginx + PM2 running the frontend, the API and the orchestrator).

The repository root is the only source of business code. Everything in
`apps/`, `libraries/` and `var/docker/` here is a **generated copy** and must
never be edited directly: edit the root file and re-run the preparer.

## Actions

These are four separate actions on purpose. None of them implies the next one.

| Step | Command | Touches |
| --- | --- | --- |
| prepare | `./k8s/prepare-build-context.sh` | local files only |
| local build | `./k8s/build-local.sh [--tag NAME]` | local Docker daemon |
| publish | `./k8s/build-postiz.sh [tag]` or `--local <image>` | container registry |
| deploy | `./k8s/deploy-postiz.sh --image <ref>` | Kubernetes cluster |
| one command | `./k8s/publish-and-deploy.sh [--deploy]` | prepare → publish (→ deploy with `--deploy`) |

`publish-and-deploy.sh` is a convenience wrapper for operators who want the
former single-command flow. It always prepares and publishes; it runs the
deployment only when `--deploy` is passed, so a build never rolls out on its
own. `--dry-run` prints the plan without touching anything.

Local preparation and local builds never log in to a registry, push an image or
update a cluster. `.github/workflows` build automation stays disabled; no CI run
is treated as evidence that a build passed.

## prepare-build-context.sh

- Resolves the repository root from its own location (it is safe to call from
  any working directory) and records the full source commit.
- Fails when the working tree is dirty unless `--allow-dirty` is passed; a dirty
  candidate is recorded with a separate worktree digest and is not presented as
  a clean build of a commit. `build-local.sh --prepare` and
  `build-postiz.sh --prepare` call the preparer **without** `--allow-dirty`, so a
  dirty tree fails there too: commit first, or run the preparer with
  `--allow-dirty` explicitly and then build without `--prepare`.
- Deletes and recreates `apps/`, `libraries/` and `var/docker/`, so files that
  no longer exist in the repository root disappear instead of lingering.
- Preserves the context-only files: `Dockerfile`, `Dockerfile.runtime`,
  `.dockerignore`, the build scripts, `ecosystem.config.cjs` and `.core-ai/`.
- Fails with exit 1 when any required build input is missing, instead of
  producing an incomplete context.
- Excludes `node_modules`, `dist`, `.next`, `.nx`, `coverage`, `.git`, real
  environment files and logs.
- Writes `BUILD_CONTEXT_MANIFEST.json` (gitignored) with the source commit,
  branch, worktree state, a sha256 for every required input and a sha256 for
  every generated path.

`--check` verifies that the context already matches the repository root and
never writes anything, not even the context directory: a missing context is
reported as drift. `build-postiz.sh` uses it to refuse a stale context.

`lib/json.sh` holds the single `json_escape` used by the preparer's manifest
and by `build-local.sh`'s provenance, so both emit the same escaping. It is a
context-only file: like the build scripts, it is preserved, not regenerated.

## The candidate image

`Dockerfile` is a two-stage source build:

- **builder and runtime** both use `node:22.23.4-bookworm`(-slim), install
  pnpm `10.6.1` pinned and run `pnpm install --frozen-lockfile`; the root
  postinstall generates the Prisma 6.5.0 client without touching a database.
- **frontend**: the upstream plain Next output (no `output: 'standalone'`),
  started with `next start -p 4200` from `/app/apps/frontend` using the hoisted
  entry `/app/node_modules/next/dist/bin/next`. The image keeps the complete
  `.next` (including `.next/static`), `public`, `package.json` and
  `next.config.js`.
- **three processes** under `pm2-runtime ecosystem.config.cjs`: `backend`
  (3000), `frontend` (4200) and `orchestrator` (Temporal worker), with nginx on
  5000 in front of them.
- **HEALTHCHECK** requests `/api/`, which maps to the backend root route
  `GET /`. `/api/health` never had a controller.
- the entrypoint still runs `pnpm run prisma-db-push` before the application
  command; see `var/docker/entrypoint.sh`.

### Public build configuration

`public-build-config.env` is the allow-list of `NEXT_PUBLIC_*` values the source
actually reads. `next build` inlines them into the browser bundle, so a runtime
`envFrom` value cannot change what the browser received. `build-local.sh` and
`build-postiz.sh` pass every entry to the build as a build argument and an
exported value overrides the file for one build. No secret belongs in it.

`SSO_PARENT_ORIGINS` is not in this file: the server has no consumer for it, so
it is not an enforced server-side restriction. The client-side check reads
`NEXT_PUBLIC_SSO_PARENT_ORIGINS`.

### Provenance

`build-local.sh` writes `BUILD_PROVENANCE.json` (gitignored) with the context
commit, the input manifest digest, the lockfile, Dockerfile, PM2, nginx,
entrypoint and Next-config digests, the effective public build values, the
pinned toolchain versions, the base-image repo digest (when the local daemon
knows it), the target platform, the generated-asset state and the final local
image ID. A local build has **no registry digest**: nothing is pushed, and the
image ID is local to that Docker daemon.

## Verification

```bash
./k8s/tests/prepare-build-context.test.sh   # generated context + action separation
./k8s/tests/runtime-contract.test.sh        # toolchain, allow-list, PM2, healthcheck
```

The suites are fast and need no Docker. The behavioural proof (three processes,
`/api/`, native dependencies, media persistence over a restart) lives in
`.scratch/postiz-stable-merge-implementation/rehearsals/13/`.

## Not a verification shortcut

- `Dockerfile.runtime` and the `k8s/ecosystem.config.cjs` copy are inactive
  artefacts kept for reference. `Dockerfile` and `var/docker/ecosystem.config.cjs`
  are the ones actually used.
- `k8s/build-postiz.sh` no longer deploys. Deployment must be requested
  explicitly with `deploy-postiz.sh`.
- Preparing or building a context proves nothing about whether the image runs.
  Three-process startup, `/api/` health, media persistence, database sync and
  Temporal history compatibility are verified separately.
