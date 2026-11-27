# 04 — Local-only four-layer container build smoke verification and packaging docs

**What to build:** Prove end to end on the local container daemon—strictly without logging in to any remote registry, pushing any image, or touching any live cluster—that the new four-layer container build works, hits local cache on repeat runs, produces a pruned and functional runtime image, and preserves every runtime contract. Update the packaging documentation so operators have accurate instructions for the repository-root build context, three-layer cache architecture, `--allow-dirty`, `--rebuild-cache`, and the manual boundary for remote publishes and cluster rollouts.

**Blocked by:** 03 — Layered build, ACR publish, and wrapper cutover with legacy packaging retirement

**Status:** resolved

- [x] Running the local build entrypoint once against the local container daemon builds all four local layers cleanly from the repository root without any registry login or push, and records accurate build provenance.
- [x] Running the local build entrypoint a second time with unchanged dependencies skips rebuilding the base, builder-dependencies, and runtime-dependencies layers via local tag cache hits.
- [x] Inspecting the built local candidate image inside a throwaway local container confirms pure development-only packages (`eslint`, `@nestjs/testing`, `@testing-library/react`, `@temporalio/testing`, `tsup`) are pruned (while upstream transitive `dependencies` such as `typescript` via `@nestjs/cli` and `vitest` via `@copilotkit/runtime` remain untouched per ADR-0001), the pinned local Prisma CLI executes offline with preserved `@prisma/engines` binaries, the generated Prisma client resolves cleanly, and required native modules (password hashing, image processing, Temporal core bridge) load without error.
- [x] Inspecting compiled artifacts inside the built local candidate image confirms frontend output contains no `.map` files (under default build with no Sentry auth token), and backend and orchestrator outputs contain no `.d.ts` files while preserving `.js.map` files.
- [x] Local container smoke verification confirms the startup schema-sync entrypoint guard, reverse-proxy `/api/` routing, and three-process manager wiring remain intact, and one-command wrapper dry-run output accurately reflects the layered plan.
- [x] Packaging documentation is updated to describe the root build context, three-layer cache repositories and tag strategy, `--allow-dirty` / `--rebuild-cache` flags, and verification commands, removing all stale references to the retired preparer and inactive legacy files.
- [x] Zero remote registry logins, zero remote image builds/pushes, and zero Kubernetes cluster mutations are performed during verification.

## Comments

- Resolved on `feat/acr-layered-build-cache` in commits `588177db`, `9eb3597a`, and `97b14434` (local-only `linux/arm64` four-layer cold + warm cache-hit builds, offline container smoke checks, and `k8s/README.md` update verified; temporary smoke images and Docker build cache cleaned afterward).
