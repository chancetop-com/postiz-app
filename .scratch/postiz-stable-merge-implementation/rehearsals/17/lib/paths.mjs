/**
 * Shared paths for the fault-injection / recovery rehearsal (ticket 17).
 *
 * The disposable stack (PostgreSQL 15, Redis, media origin, ephemeral Temporal)
 * and the compiled candidate processes are reused from tickets 15/16. This
 * directory only owns the fault-injection preload, the scenarios, and the
 * evidence/recovery helpers.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../rehearsals/17 */
export const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const REHEARSAL_15_DIR = join(HARNESS_DIR, '../15');
export const REHEARSAL_16_DIR = join(HARNESS_DIR, '../16');

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
export const COMPILED_WORKFLOWS = join(
  REPO_ROOT,
  'apps/orchestrator/dist/apps/orchestrator/src/workflows/index.js'
);

export const RESULTS_DIR = join(HARNESS_DIR, 'results');
export const EVIDENCE_DIR = join(HARNESS_DIR, 'evidence');
export const WORK_DIR = join(HARNESS_DIR, 'work');
export const PRELOAD = join(HARNESS_DIR, 'lib/stub-provider.cjs');
export const FAULT_FILE = join(WORK_DIR, 'faults.json');
