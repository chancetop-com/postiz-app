/**
 * Shared paths for the recurring/maintenance rehearsal (ticket 16).
 *
 * Everything this rehearsal writes lives under `rehearsals/16/`. The old
 * workflow sources and the disposable-stack helpers are reused from tickets
 * 14/15 instead of forked.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../rehearsals/16 */
export const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const REHEARSAL_14_DIR = join(HARNESS_DIR, '../14');
export const REHEARSAL_15_DIR = join(HARNESS_DIR, '../15');

/** Repository root. */
export const REPO_ROOT = join(HARNESS_DIR, '../../../..');

/** Compiled worker entrypoints — what the running processes resolve. */
export const ORCHESTRATOR_MAIN = join(
  REPO_ROOT,
  'apps/orchestrator/dist/apps/orchestrator/src/main.js'
);
export const BACKEND_MAIN = join(
  REPO_ROOT,
  'apps/backend/dist/apps/backend/src/main.js'
);

export const RESULTS_DIR = join(HARNESS_DIR, 'results');
export const EVIDENCE_DIR = join(HARNESS_DIR, 'evidence');
export const WORK_DIR = join(HARNESS_DIR, 'work');
export const PRELOAD = join(HARNESS_DIR, 'lib/stub-provider.cjs');

export const SCHEMA = join(
  REPO_ROOT,
  'libraries/nestjs-libraries/src/database/prisma/schema.prisma'
);
