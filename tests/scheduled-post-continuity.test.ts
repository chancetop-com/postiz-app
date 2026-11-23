import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postWorkflowV112 } from '@gitroom/orchestrator/workflows/post-workflows/post.workflow.v1.1.2';

/**
 * Ticket 15: pre-upgrade executions keep running under the candidate worker
 * while every newly started post uses V112. These assertions are the fast
 * structural net under the DB/Temporal/media rehearsal in
 * `.scratch/postiz-stable-merge-implementation/rehearsals/15/`; the rehearsal
 * proves the side effects, this keeps a refactor from silently changing the
 * entry points it exercised.
 */
const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('post start contract', () => {
  const postsService = read(
    'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts'
  );

  it('starts new posts as V112 on the main queue', () => {
    expect(postsService).toContain("workflow.start('postWorkflowV112'");
    expect(postsService).toMatch(
      /workflow\.start\('postWorkflowV112',\s*\{\s*workflowId: `post_\$\{postId\}`,/
    );
    expect(postsService).toContain("taskQueue: 'main'");
  });

  it('a reschedule or a re-queue replaces only that post execution', () => {
    // The product terminates/restarts by workflow id (post_<id>), not by
    // renaming or rebuilding unrelated executions.
    expect(postsService).toContain("workflowIdConflictPolicy: 'TERMINATE_EXISTING'");
    expect(postsService).toContain('workflowId: `post_${postId}`');
  });

  it('the missing-posts sweep pokes V112 instead of rebuilding the batch', () => {
    const activity = read('apps/orchestrator/src/activities/post.activity.ts');
    expect(activity).toContain("workflow.signalWithStart('postWorkflowV112'");
    expect(activity).toContain("signal: 'poke'");
    expect(activity).toContain("workflowIdConflictPolicy: 'USE_EXISTING'");
  });

  it('keeps the blocking postSocial contract for old versions and pending only for V112', () => {
    const v101 = read(
      'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.1.ts'
    );
    const v102 = read(
      'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.2.ts'
    );
    const v112 = read(
      'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts'
    );

    for (const old of [v101, v102]) {
      expect(old).not.toContain('postSocialPending');
      expect(old).not.toContain('finalizePost');
    }
    expect(v112).toContain('postSocialPending');
    expect(v112).toContain('finalizePost');
    expect(v112).toContain('checkPostStatus');
    expect(typeof postWorkflowV112).toBe('function');
  });
});

describe('worker registration', () => {
  it('registers workflows on main only; provider workers are activity-only', () => {
    const module = read('libraries/nestjs-libraries/src/temporal/temporal.module.ts');
    // The workflow bundle is passed for main only unless an operator opts a
    // queue in for old provider-queue histories (ticket 16).
    expect(module).toContain(
      '...(queueRunsWorkflows(taskQueue, compatWorkflowQueues)'
    );
    expect(module).toContain("const compatWorkflowQueues = parseCompatWorkflowQueues();");
    // No Worker Versioning / build ids are introduced by the upgrade.
    expect(module).not.toContain('buildId');
    expect(module).not.toContain('useVersioning');
    expect(module).toContain("taskQueue: 'main'");
  });
});
