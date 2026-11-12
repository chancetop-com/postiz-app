/**
 * Shared paths for the scheduled-continuity rehearsal (implementation ticket 15).
 *
 * Everything the rehearsal writes lives under `rehearsals/15/`, so no product
 * code path can depend on it. The pre-upgrade workflow sources are reused from
 * the ticket-14 rehearsal (verbatim `git show` of commit C, synthetic only).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../rehearsals/15 */
export const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository root. */
export const REPO_ROOT = join(HARNESS_DIR, '../../../..');

/** Ticket-14 legacy bundle (pre-upgrade workflow sources). */
export const REHEARSAL_14_DIR = join(
  REPO_ROOT,
  '.scratch/postiz-stable-merge-implementation/rehearsals/14'
);
export const LEGACY_BASE_WORKFLOWS = join(
  REHEARSAL_14_DIR,
  'legacy/base/workflows/index.ts'
);

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
export const COMPILED_INTEGRATION_MANAGER = join(
  REPO_ROOT,
  'apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/integration.manager.js'
);
export const COMPILED_EMAIL_SERVICE = join(
  REPO_ROOT,
  'apps/orchestrator/dist/libraries/nestjs-libraries/src/services/email.service.js'
);

export const RESULTS_DIR = join(HARNESS_DIR, 'results');
export const EVIDENCE_DIR = join(HARNESS_DIR, 'evidence');
export const WORK_DIR = join(HARNESS_DIR, 'work');
export const PRELOAD = join(HARNESS_DIR, 'lib/stub-provider.cjs');

export const SCHEMA = join(
  REPO_ROOT,
  'libraries/nestjs-libraries/src/database/prisma/schema.prisma'
);
