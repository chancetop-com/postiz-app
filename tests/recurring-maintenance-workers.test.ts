import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import {
  parseCompatWorkflowQueues,
  queueRunsWorkflows,
} from '@gitroom/nestjs-libraries/temporal/worker.queues';
import { emailQueues } from '@gitroom/nestjs-libraries/temporal/email.queues';

/**
 * Ticket 16: recurring/maintenance work keeps running under the candidate.
 *
 * These are the fast structural checks under the live rehearsal in
 * `.scratch/postiz-stable-merge-implementation/rehearsals/16/`; the rehearsal
 * proves the database, Temporal and stub-provider side effects.
 */
const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('refresh backlog', () => {
  it('registers refreshToken as a Temporal activity, not only a class method', () => {
    // nestjs-temporal-core discovers activities from @ActivityMethod metadata;
    // an undecorated method is never registered and refreshTokenWorkflow fails.
    const methods = Reflect.getMetadata(
      'TEMPORAL_ACTIVITY_METHOD',
      IntegrationsActivity.prototype
    );
    expect(methods?.refreshToken?.name).toBe('refreshToken');
    expect(methods?.getIntegrationsById?.name).toBe('getIntegrationsById');
  });

  it('keeps the old refresh workflow id and main queue', () => {
    const service = read(
      'libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts'
    );
    expect(service).toContain('workflowId: `refresh_${id}`');
    expect(service).toContain("workflow.start(`refreshTokenWorkflow`");
    expect(service).toMatch(
      /workflow\.start\(`refreshTokenWorkflow`,\s*\{[\s\S]*taskQueue: 'main'/
    );
  });
});

describe('provider-queue workflow compatibility', () => {
  it('is activity-only unless an operator lists the queue', () => {
    expect(parseCompatWorkflowQueues(undefined)).toEqual([]);
    expect(parseCompatWorkflowQueues('')).toEqual([]);
    expect(parseCompatWorkflowQueues(' bluesky, x ,bluesky ')).toEqual([
      'bluesky',
      'x',
    ]);

    expect(queueRunsWorkflows('main', [])).toBe(true);
    expect(queueRunsWorkflows('bluesky', [])).toBe(false);
    expect(queueRunsWorkflows('bluesky', ['bluesky'])).toBe(true);
    expect(queueRunsWorkflows('x', ['bluesky'])).toBe(false);
    // The e-mail workers stay activity-only: their workflows run on main.
    expect(queueRunsWorkflows('email', ['bluesky'])).toBe(false);
    expect(queueRunsWorkflows('email-bulk', ['bluesky'])).toBe(false);
  });

  it('is wired into worker registration without touching the main queue', () => {
    const module = read(
      'libraries/nestjs-libraries/src/temporal/temporal.module.ts'
    );
    expect(module).toContain('parseCompatWorkflowQueues');
    expect(module).toContain('queueRunsWorkflows');
    expect(module).toContain("COMPAT_WORKFLOW_QUEUES");
    expect(module).toContain("taskQueue: 'main'");
    // No Worker Versioning is introduced by this compatibility gate.
    expect(module).not.toContain('buildId');
    expect(module).not.toContain('useVersioning');
  });

  it('does not move newly started workflows off main', () => {
    const posts = read(
      'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts'
    );
    const email = read('libraries/nestjs-libraries/src/services/email.service.ts');
    const missing = read('apps/orchestrator/src/activities/post.activity.ts');
    expect(posts).toContain("workflow.start('postWorkflowV112'");
    expect(posts).toContain("taskQueue: 'main'");
    expect(email).toContain("workflow.start('sendSingleEmailWorkflow'");
    expect(email).toContain("taskQueue: 'main'");
    expect(missing).toContain("workflow.signalWithStart('postWorkflowV112'");
    expect(missing).toContain("taskQueue: 'main'");
  });
});

describe('both e-mail generations stay registered', () => {
  it('exports the deprecated backlog singleton and the per-email workflow', async () => {
    const workflows = await import('@gitroom/orchestrator/workflows');
    expect((workflows as Record<string, unknown>).sendEmailWorkflow).toBeTypeOf(
      'function'
    );
    expect(
      (workflows as Record<string, unknown>).sendSingleEmailWorkflow
    ).toBeTypeOf('function');
    expect(emailQueues).toEqual({
      priority: { taskQueue: 'email', perSecond: 3 },
      bulk: { taskQueue: 'email-bulk', perSecond: 2 },
    });
  });

  it('sends priority and bulk e-mail through distinct task queues', () => {
    const workflow = read(
      'apps/orchestrator/src/workflows/send.email.workflow.ts'
    );
    expect(workflow).toContain(
      "const send = email.addTo === 'top' ? sendPriorityEmail : sendBulkEmail;"
    );
    expect(workflow).toContain('emailQueues.priority.taskQueue');
    expect(workflow).toContain('emailQueues.bulk.taskQueue');
    expect(workflow).toContain("taskQueue: 'main'");
  });
});

describe('recurring post versions and maintenance patches', () => {
  it('keeps each repeat child on the version that created it', () => {
    for (const [file, type] of [
      ['post.workflow.v1.0.1.ts', 'postWorkflowV101'],
      ['post.workflow.v1.0.2.ts', 'postWorkflowV102'],
      ['post.workflow.v1.1.2.ts', 'postWorkflowV112'],
    ]) {
      const source = read(`apps/orchestrator/src/workflows/post-workflows/${file}`);
      expect(source).toContain(`await startChild(${type}, {`);
      expect(source).toContain("parentClosePolicy: 'ABANDON'");
      expect(source).toContain('workflowId: `post_${post.id}_${makeId(10)}`');
    }
  });

  it('keeps the maintenance continue-as-new and streak hand-off gates', () => {
    const missing = read('apps/orchestrator/src/workflows/missing.post.workflow.ts');
    const autopost = read('apps/orchestrator/src/workflows/autopost.workflow.ts');
    const streak = read('apps/orchestrator/src/workflows/streak.workflow.ts');
    expect(missing).toContain("patched('missing-post-continue-as-new')");
    expect(missing).toContain('continueAsNew<typeof missingPostWorkflow>');
    expect(autopost).toContain("patched('autopost-continue-as-new')");
    expect(autopost).toContain('continueAsNew<typeof autoPostWorkflow>');
    expect(streak).toContain("patched('reminder')");
    expect(streak).toContain("patched('streak-last-post')");
    expect(streak).toContain("workflowType: 'streakWorkflowV2'");
  });

  it('keeps the missing-sweep compensation based on the repeat anchor', () => {
    const activity = read('apps/orchestrator/src/activities/post.activity.ts');
    expect(activity).toContain('REANCHOR_GRACE_MS');
    expect(activity).toContain('reanchorInterval');
    expect(activity).toContain('post.state !== State.QUEUE');
    expect(activity).toContain('post.intervalInDays * 24 * 60 * 60 * 1000');
  });
});
