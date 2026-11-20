/**
 * Shared paths for the delivery fault/recovery rehearsal (implementation
 * ticket 13).
 *
 * The normal-continuity evidence this ticket compares against was produced by
 * ticket 12; the harness imports its pure helpers (seed/temporal/calls) and
 * keeps its own results, evidence and fault ledger here.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../rehearsals/13 */
export const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository root. */
export const REPO_ROOT = join(HARNESS_DIR, '../../../..');

/** Ticket 12 harness (normal continuity samples and shared helpers). */
export const PREVIOUS_HARNESS = join(
  REPO_ROOT,
  '.scratch/postiz-v2.26.0-implementation/rehearsals/12'
);
export const NORMAL_SAMPLES = join(
  PREVIOUS_HARNESS,
  'evidence/normal-samples.json'
);
export const PREVIOUS_CALL_LOG = join(
  PREVIOUS_HARNESS,
  'evidence/call-log.jsonl'
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
export const COMPILED_POSTS_SERVICE = join(
  REPO_ROOT,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.js'
);
export const COMPILED_POSTS_REPOSITORY = join(
  REPO_ROOT,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.js'
);
export const COMPILED_SOCIAL_ABSTRACT = join(
  REPO_ROOT,
  'libraries/nestjs-libraries/src/integrations/social.abstract.js'
);

export const RESULTS_DIR = join(HARNESS_DIR, 'results');
export const EVIDENCE_DIR = join(HARNESS_DIR, 'evidence');
export const WORK_DIR = join(HARNESS_DIR, 'work');
export const PRELOAD = join(HARNESS_DIR, 'lib/stub-provider.cjs');
export const FAULT_FILE = join(WORK_DIR, 'faults.json');
