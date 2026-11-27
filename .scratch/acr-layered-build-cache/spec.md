# Postiz Layered Container Build Cache and Compilation Speedup

Status: resolved
Created: 2026-11-27
Resolved: 2026-11-27

## Problem Statement

When maintainers publish Postiz from a macOS workstation to AKS, even a small application code change takes roughly 10 to 15 minutes end to end. Before a container build can even begin, the current workflow copies nearly a thousand source files into a dedicated packaging subdirectory and hashes every copied file one by one, adding local sync overhead, requiring a directory-sync binary, and creating a whole class of stale-context drift errors.

Worse, remote cloud builds run on an ephemeral Standard-tier container build VM with no persistent local layer cache, and the current image definition copies all application and library source files before installing dependencies. As a result, every single release starts from scratch: installing OS packages and global CLI tools, downloading and unpacking a multi-gigabyte dependency tree from the public registry, downloading a separate online copy of Prisma during postinstall to generate the client, compiling over a hundred megabytes of unused frontend production sourcemaps when no Sentry upload token is provided, emitting hundreds of unused backend type declaration files, and then copying, compressing, pushing, and pulling the entire dependency tree (including all development dependencies) into the runtime image. This makes everyday iteration painfully slow and adds unnecessary disk pressure to AKS nodes with limited OS disk capacity.

## Solution

Unify both local builds and remote cloud publishes to build directly from the repository root context with an expanded root container ignore list, retiring the source-copying preparer and inactive legacy packaging artifacts. Introduce a three-layer content-addressed cache chain: a rarely changing OS runtime base image, a dependency-addressed builder dependencies image, and a runtime dependencies image that prunes development dependencies while keeping the pinned Prisma CLI required for container startup schema synchronization. Store the three cache layers in three separate registry repositories so the cluster's per-repository image cleanup policy never evicts active layers, and mirror the exact same layered chain locally using local container tags with zero remote registry access.

On the compilation side, gate frontend production sourcemaps and the Sentry build plugin on the presence of a Sentry auth token so standard builds skip unused sourcemap generation and bundle bloat, disable unused type declaration output for the backend and orchestrator while keeping runtime sourcemaps intact, and switch Prisma client generation to invoke the locally installed pinned CLI. Routine business-code releases keep the same operator entrypoints, automatically skip OS setup and dependency installation, compile only application code, and produce, push, and pull only tens of megabytes of incremental application layers—cutting typical deploys to a few minutes while minimizing merge conflicts with upstream releases and remaining directly reusable when Jenkins is onboarded later.

## User Stories

1. As a Postiz release maintainer, I want routine business-code publishes to keep using the existing publish-and-deploy command, so that release time drops from 10–15 minutes to a few minutes without changing operator muscle memory.
2. As a Postiz release maintainer, I want the publish workflow to check whether the base, builder-dependencies, and runtime-dependencies cache tags already exist in the registry before building, so that cache hits skip OS installation, dependency downloads, and Prisma client generation entirely.
3. As a Postiz release maintainer, I want cache identifiers to be computed from the lockfile, package manifests, database schema, and cache image definitions themselves, so that any relevant change automatically invalidates and rebuilds the affected cache layers.
4. As a Postiz release maintainer, I want the three cache layers stored in separate registry repositories, so that the cluster's per-repository retention policy (keeping the latest three tags per repository) never purges active base or dependency layers.
5. As a Postiz release maintainer, I want the final application image to inherit directly from the cached runtime-dependencies image, so that every code-only deploy only packages, pushes, and pulls tens of megabytes of incremental application layers instead of the full dependency tree.
6. As a Postiz release maintainer, I want pure development-only dependencies (linters, test utilities, and dev bundlers such as `eslint`, `@nestjs/testing`, `@testing-library/react`, `@temporalio/testing`, and `tsup`) pruned from the runtime-dependencies image while keeping upstream `dependencies` untouched, so that the shipped image is smaller, cold pulls are faster, and AKS node OS disk pressure is reduced.
7. As a Postiz release maintainer, I want the pruned runtime-dependencies image to keep the pinned Prisma CLI and all of its runtime dependencies intact, so that container startup schema synchronization runs offline without contacting external registries.
8. As a Postiz release maintainer, I want the pruned runtime-dependencies image to preserve the generated Prisma client and native modules (password hashing, image processing, and workflow core bridge), so that the backend, frontend, and orchestrator processes start and behave identically to before.
9. As a Postiz release maintainer, I want container builds to use the repository root layout and root ignore rules, so releases need no synchronized packaging directory, per-file hash manifest, or directory-sync utility.
10. As a Postiz release maintainer, I want the root container ignore rules to exclude build outputs, dependency trees, local environment secrets, scratch folders, docs, tests, and non-deployed sub-apps (extension, SDK, CLI commands), so that uploaded build contexts stay small and never leak local secrets.
11. As a Postiz release maintainer, I want both local builds and cloud publishes to refuse dirty working trees by default, so that accidental uncommitted local edits cannot silently ship under a clean commit tag.
12. As a Postiz release maintainer, I want an explicit flag allowing dirty working trees for both local builds and cloud publishes that automatically appends a dirty suffix to generated default tags, so that ad-hoc debug builds are clearly distinguished from clean commit artifacts.
13. As a Postiz release maintainer, I want an explicit cache-rebuild flag to force rebuilding the base, builder-dependencies, and runtime-dependencies layers even when matching tags already exist, so that OS security updates or corrupted layers can be refreshed on demand.
14. As a Postiz developer verifying builds locally, I want the local build command to use the exact same repository-root context, ignore rules, and four-layer image split as cloud publishes, so that local verification accurately reflects production packaging.
15. As a Postiz developer verifying builds locally, I want the local build command to never log in to a remote registry, never pull private remote images, and never push or deploy, so that local validation remains completely isolated and safe offline.
16. As a Postiz developer verifying builds locally, I want local builds to continue writing a provenance record capturing source commit, worktree state, pinned toolchain versions, key input digests, cache layer tags, and local image ID, so that candidate artifacts remain auditable.
17. As a Postiz frontend developer, I want frontend production sourcemaps and the Sentry build plugin disabled automatically when no Sentry auth token is provided, so that routine builds save significant compile time and memory and stop bloating output with unused map files.
18. As a Postiz frontend developer, I want frontend production sourcemaps and Sentry upload behavior to reactivate automatically whenever a Sentry auth token is supplied, so that enabling error tracking uploads in the future requires no configuration rework.
19. As a Postiz backend and orchestrator developer, I want builds to stop emitting unused TypeScript declaration files while retaining runtime sourcemaps, so that builds write fewer redundant files without losing accurate TypeScript stack trace line numbers in logs.
20. As a Postiz developer, I want Prisma client generation during install to execute the locally installed pinned Prisma binary instead of downloading a temporary online copy, so that cold builds and local installs are faster and more reliable.
21. As a maintainer who periodically merges upstream Postiz releases, I want unrelated upstream dependency placements, serial build concurrency limits, and the NestJS compiler choice left unchanged, so that future upstream merges stay low-conflict and predictable.
22. As a repository maintainer, I want retired packaging artifacts (the inactive runtime image definition, duplicate process-manager config, source-copying preparer, and subdirectory ignore file) removed cleanly, so that only one unambiguous packaging setup exists in the repository.
23. As a Postiz operator and tester, I want all automated tests and local verification runs to strictly forbid pushing images to online registries or mutating live cluster deployments, so that development and testing can never affect online environments.
24. As an engineer planning future FBR Jenkins onboarding, I want the updated build workflow to have zero directory-sync dependencies and zero build-time public environment baking, so that a future Jenkins pipeline can reuse the exact same layered build flow with no rework.

## Implementation Decisions

### Build Context and Worktree Guards

- Retire the mechanism that copies repository source trees into the packaging subdirectory and hashes every copied file. Local builds and cloud publishes export one private snapshot of the repository-root inputs per invocation. Clean builds read the pinned Git commit. Dirty builds capture the opted-in worktree contents once. All layers use the same snapshot so edits during a build cannot alter the release or its cache keys. This adds one temporary extraction per invocation and keeps Git metadata out of the Azure CLI archiver.
- Expand the root container ignore configuration so build contexts exclude dependency directories, compiled application outputs, incremental TypeScript caches, local environment files, packaging metadata and tests, version-control directories, documentation, test suites, scratch workspaces, and non-deployed sub-applications (browser extension, SDK, CLI commands).
- Retain required-input verification and the clean-worktree guard as a lightweight shared validation step invoked by both local build and publish entrypoints. Dirty working trees are rejected by default; passing an explicit allow-dirty flag permits building/publishing and automatically appends a dirty suffix to auto-generated default image tags.
- Preserve local provenance output after local builds, updating it to record source commit, worktree state, pinned toolchain versions, key input digests, resolved cache-layer tags, and local image ID without relying on a copied-context manifest.
- Preserve strict action separation across entrypoints: local build touches only the local container daemon; publish builds and pushes images only and never touches Kubernetes; deploy updates the deployment image and waits for rollout without building or pushing; the one-command wrapper supports dry-run planning and rolls out only when deployment is explicitly requested.

### Four Split Image Definitions and Three-Layer Cache Architecture (per ADR-0001)

- Split container packaging into four dedicated image definitions so classic non-BuildKit remote builders never execute unreferenced installation stages:
  1. **Runtime OS base image definition**: Starts from the pinned slim Node runtime image, installs the reverse proxy, health-check client, pinned pnpm, and process manager, and sets up the expected system user and writable directories (preserving the existing root/volume permission model).
  2. **Builder dependencies image definition**: Starts from the pinned full Node builder image, installs pinned pnpm, copies only dependency manifests, lockfile, workspace config, target application manifests, frontend postinstall script, and database schema, runs frozen-lockfile installation, and generates the Prisma client.
  3. **Runtime dependencies image definition**: Takes the builder dependencies image, prunes development dependencies while explicitly preserving and verifying both the generated Prisma client and executable pinned Prisma CLI, and copies the pruned dependency tree onto the runtime OS base image.
  4. **Single application image definition**: Its builder stage inherits directly from the builder dependencies image, copies application/library source and TypeScript configs, compiles the three applications, and removes the frontend build cache. Its runtime stage inherits directly from the runtime dependencies image, copies only the compiled outputs, public assets, frontend runtime config, root manifest, database schema, startup entrypoint, reverse proxy config, and process manager config, and defines health check, entrypoint, and startup command.
- Content-addressed cache tag rules:
  - The runtime OS base tag is derived from the pinned Node version, pinned pnpm version, and content digest of the base image definition.
  - The dependencies cache digest is computed from package manager config, root manifest, lockfile, workspace config, target application manifests, database schema, the base image tag, and the contents of both dependency image definitions so any change invalidates stale layers automatically.
- For cloud publishes, store the three cache layers in three independent registry repositories under the ops namespace (base, builder dependencies, runtime dependencies) to comply with the registry's per-repository latest-3 cleanup script. Before building the application image, check each cache tag in the registry and build only missing layers in order (base → builder dependencies → runtime dependencies), or rebuild all three when an explicit cache-rebuild flag is passed.
- For local builds, execute the identical check-and-build chain against local container daemon tags (never logging in to or pulling from private remote registries), also supporting the explicit cache-rebuild flag.
- Remove inactive and superseded packaging files (inactive runtime image definition, duplicate process-manager config, source-copying preparer script, and subdirectory ignore file) so only one canonical packaging pipeline remains.

### Dependency Pruning and Upstream Conflict Boundary

- Move only the pinned Prisma CLI entry from development dependencies to production dependencies in the root manifest (and update the lockfile accordingly), so standard production pruning in the runtime-dependencies image cleanly preserves Prisma CLI and all of its transitive runtime dependencies for startup schema synchronization.
- Deliberately leave the remaining upstream packages that are miscategorized in production dependencies untouched to minimize future merge conflicts with upstream releases.
- Change the root Prisma client generation script from an online temporary package execution to invoking the locally installed pinned Prisma binary, matching the existing local schema-sync script.

### Compilation Configuration and Preserved Runtime Contracts

- Gate frontend production browser sourcemaps, custom sourcemap bundler overrides, and the Sentry build plugin's sourcemap/upload behavior on whether a Sentry auth token environment variable is present and non-empty. When absent, skip sourcemap generation and Sentry sourcemap processing entirely; when present, preserve full Sentry release and sourcemap upload behavior. Keep plain non-standalone Next output and runtime server-to-client public configuration delivery unchanged, with zero public build arguments.
- Disable TypeScript declaration file emission in the backend and orchestrator build configurations while keeping sourcemap generation enabled so runtime stack traces retain TypeScript line mapping.
- Retain the serial workspace concurrency setting in the root build script and retain the standard TypeScript compiler for backend and orchestrator builds to avoid 2-vCPU build OOMs and upstream divergence.
- Preserve all existing runtime contracts: single-container reverse proxy fronting backend, frontend, and orchestrator under the process manager; root API health check; and mandatory startup database schema sync that aborts process startup on failure.

## Testing Decisions

### Testing Principles and Online Safety Boundary

- Test only external, observable behavior and contracts (CLI exit codes, stubbed command invocation logs, generated artifact contents, resolved config outputs, and local container behavior), never private script helpers or internal implementation details.
- **Hard safety boundary: no automated test or agent-driven verification may log in to a remote container registry, trigger a real cloud image build or push, or modify any live Kubernetes cluster deployment.** Real remote publishing and cluster rollout are strictly reserved for manual operator execution after local and offline verification passes.

### Verification Seams

1. **Offline CLI and Cache Orchestration Seam** (following the existing throwaway Git fixture repository + stubbed CLI harness pattern)
   - Invoke the local build, publish, deploy, and one-command wrapper entrypoints inside isolated temporary Git repositories with stubbed container, cloud CLI, and cluster CLI binaries on `PATH`.
   - Assert cache-hit skipping when tags exist, ordered layer building (base → builder dependencies → runtime dependencies → app) on cache miss or explicit cache-rebuild flag, cache digest changes when lockfile/schema/cache definitions change, default dirty-tree rejection, allow-dirty tag suffixing, and strict action separation (local build never invokes cloud CLI, push, or cluster commands; publish never invokes cluster commands; dry-run runs no external commands; wrapper without deploy flag never invokes cluster commands).
2. **Static Packaging and Build Configuration Contract Seam** (following the existing runtime-contract shell suite and startup-sync Vitest suite, plus a Vitest check for frontend build configuration)
   - Assert offline that the four split image definitions lock expected Node, pnpm, and Prisma versions, accept zero public build arguments, preserve the startup schema-sync entrypoint contract, maintain the three-process manager layout and API root health check, and exclude sensitive/unneeded paths via the root ignore rules. Update existing startup-sync checks to replace the removed inactive runtime definition with the new split definitions.
   - Import and evaluate the frontend configuration module with and without a Sentry auth token to confirm production sourcemaps and Sentry sourcemap processing toggle as specified.
   - Assert backend and orchestrator build configurations disable declaration emission while keeping sourcemaps, and that the Prisma client generation script invokes the local binary rather than an online download.
3. **Local-Only Container Build and Runtime Smoke Seam** (following the existing isolated local rehearsal pattern—strictly local container daemon, zero push)
   - Run the local build entrypoint against the local container daemon through the full four-layer chain, then re-run immediately to verify local cache hits skip dependency installation.
   - Inspect and smoke-test the resulting local candidate image in a throwaway local container: confirm pure dev-only packages (`eslint`, `@nestjs/testing`, `@testing-library/react`, `@temporalio/testing`, `tsup`) are pruned (while upstream transitive `dependencies` such as `typescript` via `@nestjs/cli` and `vitest` via `@copilotkit/runtime` remain untouched per ADR-0001) and the pinned Prisma CLI, generated Prisma client, and native dependencies load and execute cleanly; confirm frontend output contains no `.map` files and backend/orchestrator outputs contain no `.d.ts` files while keeping `.js.map` files; confirm the three processes and reverse-proxy routing contract remain intact.

## Out of Scope

- Onboarding Postiz to FBR Jenkins (including environment-repository Jenkins job templates, encrypted JCasC/Job DSL/Secret registration, GitHub deploy keys, UAT Kubernetes manifests, and fixing the readiness/liveness probe trailing slash in the environment repository).
- Migrating NestJS backend or orchestrator builds to SWC.
- Removing the serial workspace concurrency flag from the root build script.
- Reorganizing the miscategorized upstream packages in the root manifest's dependency lists.
- Switching the frontend to Next standalone output or moving static assets to Azure CDN.
- Executing real remote registry pushes or live cluster deployments during automated or agent verification.

## Further Notes

- This spec implements the decisions recorded in ADR-0001. If implementation uncovers a concrete constraint that invalidates an assumption (such as production pruning breaking generated Prisma artifacts or a native addon), stop and reconcile the ADR and spec rather than bypassing runtime contracts or pushing unverified images.
- **Implementation reconciliation (hoisted pruning & Prisma engines):** Under `.npmrc` `node-linker=hoisted`, `pnpm prune --prod` prompts interactively and skips relinking in non-TTY container builds unless run as `CI=true npm_config_offline=true pnpm prune --prod --ignore-scripts`, and requires saving and restoring both `/app/node_modules/.prisma` and `/app/node_modules/@prisma/engines` binaries across the prune. Because upstream `package.json` `dependencies` are kept untouched per ADR-0001 and Out of Scope, pruning removes ~1,132 pure `devDependencies` (including `eslint`, `@nestjs/testing`, `@testing-library/react`, `@temporalio/testing`, and `tsup`), while `typescript` (transitively required by `@nestjs/cli`) and `vitest` (transitively required by `@copilotkit/runtime` → `@copilotkit/channels-core`) remain reachable from upstream production dependencies.
- Completing this spec leaves the build pipeline free of directory-sync dependencies and decoupled from environment-specific build arguments, so a later Phase 2 FBR Jenkins integration can invoke the same layered ACR cache flow directly.
