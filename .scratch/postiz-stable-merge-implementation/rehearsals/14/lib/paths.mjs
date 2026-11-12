/**
 * Shared paths for the Temporal replay rehearsal (ticket 14).
 *
 * Everything the rehearsal writes lives under
 * `.scratch/postiz-stable-merge-implementation/rehearsals/14/`, so no product
 * code path can depend on it.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../rehearsals/14 */
export const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository root. */
export const REPO_ROOT = join(HARNESS_DIR, '../../../..');

/** Workflows entrypoint the orchestrator worker bundles (`require.resolve('./workflows')`). */
export const CANDIDATE_WORKFLOWS = join(REPO_ROOT, 'apps/orchestrator/src/workflows/index.ts');

/** The same entrypoint after `pnpm run build` — what the running worker resolves. */
export const COMPILED_WORKFLOWS = join(
  REPO_ROOT,
  'apps/orchestrator/dist/apps/orchestrator/src/workflows/index.js'
);

/** Old (pre-upgrade) workflows entrypoint, extracted verbatim from commit C. */
export const LEGACY_BASE_WORKFLOWS = join(HARNESS_DIR, 'legacy/base/workflows/index.ts');

/** Derived "legacy + documented patch gates" workflows entrypoint. */
export const LEGACY_PATCHED_WORKFLOWS = join(HARNESS_DIR, 'legacy/patched/workflows/index.ts');

export const LEGACY_DIR = join(HARNESS_DIR, 'legacy');
export const FIXTURES_DIR = join(HARNESS_DIR, 'fixtures');
export const RESULTS_DIR = join(HARNESS_DIR, 'results');

/** Versions pinned by the harness so a result is attributable. */
export const TOOLING = {
  node: process.version,
  sdk: '1.15.0',
  testing: '1.15.0',
};
