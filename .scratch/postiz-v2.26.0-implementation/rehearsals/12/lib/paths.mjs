/**
 * Shared paths for the in-flight continuity rehearsal (implementation ticket 12).
 *
 * The rehearsal lives under the v2.26.0 implementation project. It reuses the
 * pre-upgrade workflow sources extracted for the stable-merge ticket 14
 * (verbatim `git show` of the customised v2.25.3 behaviour baseline). Those
 * fixtures are read-only here: only the candidate workflow bundle is replayed.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../rehearsals/12 */
export const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository root. */
export const REPO_ROOT = join(HARNESS_DIR, '../../../..');

/** Ticket-14 rehearsal from the previous project phase (legacy sources + fixtures). */
export const LEGACY_REHEARSAL_DIR = join(
  REPO_ROOT,
  '.scratch/postiz-stable-merge-implementation/rehearsals/14'
);
export const LEGACY_BASE_WORKFLOWS = join(
  LEGACY_REHEARSAL_DIR,
  'legacy/base/workflows/index.ts'
);
export const REPLAY_LATEST = join(
  LEGACY_REHEARSAL_DIR,
  'results/replay-latest.json'
);

/** Compiled candidate entrypoints — what the deployed processes resolve. */
export const ORCHESTRATOR_MAIN = join(
  REPO_ROOT,
  'apps/orchestrator/dist/apps/orchestrator/src/main.js'
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
export const COMPILED_POSTS_REPOSITORY = join(
  REPO_ROOT,
  'apps/orchestrator/dist/libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.js'
);

export const RESULTS_DIR = join(HARNESS_DIR, 'results');
export const EVIDENCE_DIR = join(HARNESS_DIR, 'evidence');
export const WORK_DIR = join(HARNESS_DIR, 'work');
export const PRELOAD = join(HARNESS_DIR, 'lib/stub-provider.cjs');

export const SCHEMA = join(
  REPO_ROOT,
  'libraries/nestjs-libraries/src/database/prisma/schema.prisma'
);
