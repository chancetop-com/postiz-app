# 01 — Compilation speedup and Prisma runtime dependency promotion

**What to build:** Cut avoidable compilation overhead across all three applications and prepare the root dependency manifest for production pruning without disturbing upstream dependency layout. Gate frontend production browser sourcemaps and Sentry sourcemap/upload processing on the presence of a non-empty Sentry auth token (leaving runtime public environment delivery and plain non-standalone Next output untouched). Disable unused TypeScript declaration emission for backend and orchestrator builds while retaining runtime sourcemaps for accurate stack traces. Promote only the pinned Prisma CLI from development dependencies to production dependencies (with lockfile synchronized, leaving other upstream packages untouched) and switch root Prisma client generation from an online temporary package download to invoking the locally installed pinned binary.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Evaluating the frontend build configuration with no Sentry auth token disables browser production sourcemaps, omits custom sourcemap bundler overrides, and disables Sentry sourcemap generation/upload; evaluating it with a non-empty Sentry auth token restores production sourcemaps and Sentry upload behavior.
- [x] Frontend build configuration continues to reject standalone output and preserves runtime server-to-client public configuration delivery with zero public build arguments.
- [x] Backend and orchestrator build configurations disable `.d.ts` declaration emission while keeping `.js.map` sourcemap emission enabled.
- [x] Root package manifest lists the pinned Prisma CLI under production dependencies (with lockfile updated cleanly) while leaving the remaining upstream dependency placements unchanged.
- [x] Root Prisma client generation script invokes the locally installed pinned Prisma binary rather than an online temporary download, matching the local schema-sync script.
- [x] Automated Vitest tests cover the frontend config toggle (token unset vs. set), backend/orchestrator build config assertions, and root Prisma script contract, and full local compilation (`pnpm run build`), typecheck, and existing test suites pass.
- [x] No remote container registry login, image push, or Kubernetes cluster command is executed during verification.

## Comments

- Resolved on `feat/acr-layered-build-cache` in commits `222248a8` and `97b14434` (verified with `tests/build-config.test.ts`, full Vitest, `typecheck`, `pnpm run build`, and `lint`; zero `.map` files in `.next` and zero `.d.ts` files in backend/orchestrator `dist`).
