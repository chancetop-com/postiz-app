# 02 — Root build context ignore rules, three cache-layer image definitions, and shared guard/digest helper

**What to build:** Expand the repository so direct root-context layered builds are ready before cutting over any existing build or publish entrypoints (keeping existing scripts and tests green throughout). Expand root container ignore rules to exclude dependency trees, compiled outputs, incremental compiler caches, local environment files, packaging metadata and tests, docs, test suites, scratch folders, and non-deployed sub-applications (extension, SDK, CLI commands). Add the three dedicated cache-layer image definitions prescribed by ADR-0001: runtime OS base (pinned slim Node, reverse proxy, health-check client, pinned pnpm, process manager, system user and writable runtime directories), builder dependencies (pinned full Node, pinned pnpm, manifest-only copy before frozen-lockfile install and Prisma client generation), and runtime dependencies (pruning development dependencies from builder dependencies while explicitly preserving and verifying both the generated Prisma client and executable pinned Prisma CLI, then layering onto the runtime OS base). Add the shared content-addressed cache digest helper and clean-worktree / required-inputs validation helper.

**Blocked by:** 01 — Compilation speedup and Prisma runtime dependency promotion

**Status:** resolved

- [x] Root container ignore rules exclude dependency directories, application build outputs, TypeScript incremental build info, local environment secret files, packaging subdirectory metadata/tests, documentation, test directories, scratch workspaces, and non-deployed sub-applications while allowing all files required by the four-layer build.
- [x] Three dedicated cache-layer image definitions exist with pinned Node, pnpm, and Prisma versions, zero public build arguments, and deterministic separation so classic non-BuildKit remote builders cannot execute unreferenced install stages.
- [x] The runtime-dependencies image definition prunes development dependencies from the builder-dependencies layer, explicitly preserves the generated Prisma client, and asserts that the pinned local Prisma CLI executes offline before finishing the layer.
- [x] The shared digest helper deterministically computes a runtime OS base tag (incorporating pinned toolchain versions and the base image definition) and a dependencies cache digest (incorporating package manager config, root and target app manifests, lockfile, workspace config, database schema, base tag, and both dependency image definitions) such that editing any input changes the resulting tag.
- [x] The shared validation helper rejects missing required build inputs and rejects dirty working trees by default, while allowing dirty trees only when an explicit allow-dirty flag is supplied.
- [x] Offline automated tests verify digest invalidation across inputs, worktree guard behavior, and static toolchain/ignore contracts; all existing packaging and Vitest suites remain green; no remote registry or cluster command is executed.

## Comments

- Resolved on `feat/acr-layered-build-cache` in commits `2245cde4`, `9eb3597a`, and `97b14434` (`k8s/tests/cache-layers.test.sh`: 112/112 passed).
