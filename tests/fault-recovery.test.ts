import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import {
  parseCompatWorkflowQueues,
  queueRunsWorkflows,
} from '@gitroom/nestjs-libraries/temporal/worker.queues';

/**
 * Ticket 17: unknown results, compatible rollback and coordinated recovery.
 *
 * The fast structural net under the live rehearsal in
 * `.scratch/postiz-stable-merge-implementation/rehearsals/17/`. The rehearsal
 * proves the platform/DB/Temporal side effects with a killed worker and a
 * restored database; these checks pin the decisions that keep those outcomes
 * from being silently reclassified.
 */
const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const POST_WORKFLOW = read(
  'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts'
);
const POST_ACTIVITY = read('apps/orchestrator/src/activities/post.activity.ts');
const POSTS_REPOSITORY = read(
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts'
);
const REFRESH_SERVICE = read(
  'libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts'
);

describe('unknown publish results are classified, never silently retried', () => {
  it('gives the irreversible mutations no SDK retry and a heartbeat timeout', () => {
    // A retried activity whose earlier attempt published would post twice.
    const mutation = POST_WORKFLOW.slice(
      POST_WORKFLOW.indexOf('proxyMutationTaskQueue'),
      POST_WORKFLOW.indexOf('const {\n  getPostsList')
    );
    expect(mutation).toContain('maximumAttempts: 1');
    expect(mutation).toContain('heartbeatTimeout: HEARTBEAT_TIMEOUT');
    expect(POST_WORKFLOW).toContain(
      'const { postSocialPending, finalizePost } = proxyMutationTaskQueue(taskQueue);'
    );
    // checkPostStatus is read-only, so only it may be retried automatically.
    const check = POST_WORKFLOW.slice(
      POST_WORKFLOW.indexOf('proxyCheckTaskQueue'),
      POST_WORKFLOW.indexOf('// postSocialPending')
    );
    expect(check).toContain('maximumAttempts: 3');
    expect(check).not.toContain('heartbeatTimeout');
  });

  it('only treats a heartbeat timeout without details as never started', () => {
    // The exact guard: absence of details is the single signal that lets the
    // workflow run an irreversible mutation again.
    expect(POST_WORKFLOW).toContain(
      "err.cause.timeoutType === TimeoutType.HEARTBEAT &&\n        !err.cause.lastHeartbeatDetails"
    );
    expect(POST_WORKFLOW).toContain("return { type: 'retry', message: '' };");
    expect(POST_WORKFLOW).toContain("return { type: 'timeout', message: '' };");
    // Both irreversible activities heartbeat, so a live-but-stalled call keeps
    // its details and can never be mistaken for never-started.
    expect(POST_ACTIVITY).toContain('async postSocialPending(');
    expect(POST_ACTIVITY).toContain('return this.postSocialInternal(integration, posts, true);');
    expect(POST_ACTIVITY).toMatch(
      /async finalizePost\([\s\S]*return withHeartbeat\(\(\) =>/
    );
  });

  it('marks a timed-out publish as unconfirmed and never re-runs it', () => {
    const timeoutBranch = POST_WORKFLOW.slice(
      POST_WORKFLOW.indexOf("if (handle.type === 'timeout' || handle.type === 'unconfirmed')"),
      POST_WORKFLOW.indexOf("// for other errors, change state")
    );
    expect(timeoutBranch).toContain('await markUnconfirmed(err);');
    expect(timeoutBranch).toContain('return false;');
    expect(timeoutBranch).not.toContain('continue;');
    // The unconfirmed state must be ERROR, otherwise the missing-posts sweep
    // (which selects state QUEUE) would publish the post again.
    const markUnconfirmed = POST_WORKFLOW.slice(
      POST_WORKFLOW.indexOf('const markUnconfirmed'),
      POST_WORKFLOW.indexOf('const resolvePending')
    );
    expect(markUnconfirmed).toContain("'ERROR'");
    expect(POSTS_REPOSITORY).toMatch(/searchForMissingThreeHoursPosts[\s\S]*state: 'QUEUE'/);
  });

  it('keeps a failed status check inside the pending resolver', () => {
    // resolvePending handles its own errors; letting one escape would re-run
    // postSocialPending from the outer retry loop.
    const resolver = POST_WORKFLOW.slice(
      POST_WORKFLOW.indexOf('const resolvePending'),
      POST_WORKFLOW.indexOf('// iterate over the posts')
    );
    expect(resolver).toContain('await handleActivityError(err, undefined, heartbeats);');
    expect(resolver).toContain('await markUnconfirmed');
    expect(resolver).not.toContain('postSocialPending');
  });
});

describe('e-mail and refresh failures', () => {
  it('tries the mail provider exactly three times and then swallows the failure', async () => {
    const previous = {
      from: process.env.EMAIL_FROM_ADDRESS,
      name: process.env.EMAIL_FROM_NAME,
      provider: process.env.EMAIL_PROVIDER,
    };
    process.env.EMAIL_FROM_ADDRESS = 'synthetic@postiz.invalid';
    process.env.EMAIL_FROM_NAME = 'Synthetic Postiz';
    process.env.EMAIL_PROVIDER = 'empty';

    let attempts = 0;
    const service = new EmailService({} as never);
    (service as unknown as { emailService: unknown }).emailService = {
      name: 'synthetic-failing-mail',
      validateEnvKeys: [],
      sendEmail: async () => {
        attempts += 1;
        throw new Error('synthetic provider outage');
      },
    };

    await expect(
      service.sendEmailSync('somebody@synthetic.invalid', 'subject', '<p>x</p>')
    ).resolves.toBeUndefined();
    expect(attempts).toBe(3);
    process.env.EMAIL_FROM_ADDRESS = previous.from;
    process.env.EMAIL_FROM_NAME = previous.name;
    process.env.EMAIL_PROVIDER = previous.provider;
  });

  it('carries the unprocessed messages across a legacy continue-as-new', () => {
    const workflow = read('apps/orchestrator/src/workflows/send.email.workflow.ts');
    expect(workflow).toContain('if (processedThisRun >= 30) {');
    expect(workflow).toContain('return await continueAsNew({ queue });');
    // The successor is registered with the same id/type, so a non-empty queue
    // is drained by the same execution chain.
    expect(workflow).toContain('export async function sendEmailWorkflow(');
  });

  it('flags the channel once and ends the loop when a refresh fails', () => {
    expect(REFRESH_SERVICE).toContain('await this._integrationService.refreshNeeded(');
    expect(REFRESH_SERVICE).toContain('await this._integrationService.informAboutRefreshError(');
    expect(REFRESH_SERVICE).toContain('return false;');
    // refreshTokenWorkflow exits when the channel is flagged or gone.
    const workflow = read('apps/orchestrator/src/workflows/refresh.token.workflow.ts');
    expect(workflow).toMatch(
      /integration\.refreshNeeded\s*\)\s*\{[\s\S]*return false;/
    );
  });
});

describe('compatible rollback coverage', () => {
  it('keeps provider queues activity-only unless an operator opts in', () => {
    expect(parseCompatWorkflowQueues(undefined)).toEqual([]);
    expect(queueRunsWorkflows('main', [])).toBe(true);
    expect(queueRunsWorkflows('bluesky', [])).toBe(false);
    expect(queueRunsWorkflows('bluesky', ['bluesky'])).toBe(true);
    const module = read('libraries/nestjs-libraries/src/temporal/temporal.module.ts');
    // Every worker gets the same activity classes; only the workflow bundle is
    // gated, so enabling a queue cannot silently drop an activity.
    expect(module).toContain('activityClasses: activityClasses!');
    expect(module).toContain('...(queueRunsWorkflows(taskQueue, compatWorkflowQueues)');
    expect(module).not.toContain('buildId');
  });

  it('keeps the maintenance continue-as-new gates bounded', () => {
    for (const file of [
      'apps/orchestrator/src/workflows/missing.post.workflow.ts',
      'apps/orchestrator/src/workflows/autopost.workflow.ts',
    ]) {
      const source = read(file);
      expect(source).toContain('workflowInfo().historyLength > 1000');
      expect(source).toContain('loops >= 24');
      expect(source).toContain('continueAsNew');
    }
  });
});

describe('coordinated recovery invariants', () => {
  it('records the unconfirmed out-of-band result in the error table', () => {
    // changeState(ERROR, err, body) persists the failing call next to the row.
    const changeState = POSTS_REPOSITORY.slice(
      POSTS_REPOSITORY.indexOf('async changeState('),
      POSTS_REPOSITORY.indexOf('getErrorsByPostIds')
    );
    expect(changeState).toContain("if (state === 'ERROR' && err && body)");
    expect(changeState).toContain('this._errors.model.errors.create(');
  });
});
