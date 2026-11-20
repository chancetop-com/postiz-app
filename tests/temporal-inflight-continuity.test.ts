import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';

/**
 * Ticket 12: the candidate worker takes over in-flight v2.25.3 work.
 *
 * The live proof (same workflow/run id, queues, payloads and platform calls)
 * is `.scratch/postiz-v2.26.0-implementation/rehearsals/12/`; these are the
 * fast structural guards under it.
 */
const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('in-flight refresh work', () => {
  it('keeps refreshToken registered and decrypts the stored credentials', () => {
    // The workflow's activity proxy can only call a decorated method.
    const methods = Reflect.getMetadata(
      'TEMPORAL_ACTIVITY_METHOD',
      IntegrationsActivity.prototype
    );
    expect(methods?.refreshToken?.name).toBe('refreshToken');

    const activity = read('apps/orchestrator/src/activities/integrations.activity.ts');
    const refreshToken = activity.slice(
      activity.indexOf('async refreshToken('),
      activity.indexOf('@ActivityMethod()', activity.indexOf('async refreshToken('))
    );
    // A history can carry the token as the old deployment stored it; the
    // activity has to decrypt before handing it to the refresh service.
    expect(refreshToken).toContain('this._integrationService.decryptTokens');
    expect(refreshToken).toContain('this._refreshIntegrationService.refresh');
  });
});

describe('maintenance dispatch', () => {
  it('re-reads each post and only dispatches a live QUEUE row', () => {
    const activity = read('apps/orchestrator/src/activities/post.activity.ts');
    const scan = activity.slice(
      activity.indexOf('async searchForMissingThreeHoursPosts('),
      activity.indexOf('async updatePost(')
    );
    expect(scan).toContain('this._postService.searchForMissingThreeHoursPosts()');
    // The list is a snapshot: a post may be published or deleted while the
    // scan runs. The second read decides whether it is still safe to poke.
    expect(scan).toContain('this._postService.getPostState(post.id)');
    expect(scan).toContain("current?.state !== 'QUEUE'");
    expect(scan).toContain('signalWithStart');
    expect(scan).toContain("'postWorkflowV112'");
  });

  it('queries only undeleted QUEUE roots in the last two days', () => {
    const repository = read(
      'libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts'
    );
    const scan = repository.slice(
      repository.indexOf('searchForMissingThreeHoursPosts()'),
      repository.indexOf('getPostState(')
    );
    expect(scan).toContain("state: 'QUEUE'");
    expect(scan).toContain('deletedAt: null');
    expect(scan).toContain('parentPostId: null');
    expect(scan).toContain("subtract(2, 'day')");
    expect(scan).toContain('refreshNeeded: false');
    expect(scan).toContain('disabled: false');
  });
});

describe('publish contract split', () => {
  it.each([
    ['post.workflow.v1.0.1.ts', 'postSocial'],
    ['post.workflow.v1.0.2.ts', 'postSocial'],
    ['post.workflow.v1.1.2.ts', 'postSocialPending'],
  ])('%s uses %s', (file, activity) => {
    const workflow = read(
      `apps/orchestrator/src/workflows/post-workflows/${file}`
    );
    expect(workflow).toContain(`${activity}(`);
    if (activity === 'postSocial') {
      expect(workflow).not.toContain('postSocialPending(');
    }
  });
});
