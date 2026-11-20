import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

/**
 * Ticket 13: a send outcome must be distinguishable (complete / platform
 * rejected / pending / unknown) and a recovery must not quietly re-send.
 *
 * The live proof is `.scratch/postiz-v2.26.0-implementation/rehearsals/13/`
 * (compensation-scan races, an accepted request followed by worker death or a
 * local write-back failure, finalize timeouts with and without heartbeat
 * details). These are the fast guards under it, next to ticket 12's continuity
 * tests.
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

const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start, `missing ${from}`).toBeGreaterThan(-1);
  expect(end, `missing ${to}`).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('compensation scan re-reads the post before dispatch', () => {
  it('does not dispatch a post deleted after the scan loaded it', () => {
    const lookup = slice(
      POSTS_REPOSITORY,
      'getPostState(id: string)',
      'getOldPosts('
    );
    // The second read is a joinable predicate, not a re-filter in memory: a
    // soft-deleted row returns null and the activity skips it.
    expect(lookup).toContain('deletedAt: null');
    expect(lookup).toContain('select: {');
    expect(lookup).toContain('state: true');
  });

  it('only dispatches a still-QUEUE row and reuses the V112 workflow id', () => {
    const scan = slice(
      POST_ACTIVITY,
      'async searchForMissingThreeHoursPosts(',
      'async updatePost('
    );
    expect(scan).toContain('this._postService.getPostState(post.id)');
    expect(scan).toContain("current?.state !== 'QUEUE'");
    expect(scan).toContain('signalWithStart');
    expect(scan).toContain("workflowId: `post_${post.id}`");
    expect(scan).toContain("'postWorkflowV112'");
    // A cancel/delete performed by the UI also terminates the running
    // execution, but the scan must never start one for the deleted row.
    expect(scan).not.toContain('postSocialPending');
  });

  it('keeps the original publish date through the scan dispatch and write-back', () => {
    const update = slice(
      POSTS_REPOSITORY,
      'updatePost(id: string, postId: string, releaseURL: string)',
      'updateReleaseId('
    );
    expect(update).toContain("state: 'PUBLISHED'");
    expect(update).toContain('releaseId: postId');
    expect(update).toContain('releaseURL');
    // The scheduled time is input, never rewritten by the publish write-back.
    expect(update).not.toContain('publishDate');
  });
});

describe('once the platform accepted a request, never publish it again', () => {
  it('sets the accepted flag before write-back and never retries the publish', () => {
    const publish = slice(
      POST_WORKFLOW,
      "if (i === 0) {",
      'const handle = await handleActivityError(err, undefined, heartbeats);'
    );
    const accepted = publish.indexOf('posted = true');
    const writeBack = publish.indexOf('await updatePost(');
    expect(accepted).toBeGreaterThan(-1);
    expect(writeBack).toBeGreaterThan(accepted);

    const catchBlock = POST_WORKFLOW.slice(POST_WORKFLOW.indexOf('if (posted) {'));
    expect(catchBlock.slice(0, 700)).toContain('if (!updated)');
    expect(catchBlock.slice(0, 700)).toContain('markUnconfirmed');
    expect(catchBlock.slice(0, 700)).toContain('return false;');
    // The success notification is after write-back; a failed notification
    // must not abort the flow or trigger another publish.
    expect(publish.indexOf('await updatePost(')).toBeLessThan(
      publish.indexOf('await inAppNotification(')
    );
  });

  it('classifies a write-back failure as unconfirmed ERROR, never as success', () => {
    const markUnconfirmed = slice(
      POST_WORKFLOW,
      'const markUnconfirmed',
      'const resolvePending'
    );
    expect(markUnconfirmed).toContain("changeState(postsList[0].id, 'ERROR'");
    expect(markUnconfirmed).toContain("couldn't confirm");
    expect(markUnconfirmed).toContain('before posting again to avoid duplicates');
    // ERROR is what keeps the missing-posts sweep (state QUEUE) from
    // re-publishing a post the platform already accepted.
    expect(POSTS_REPOSITORY).toMatch(
      /searchForMissingThreeHoursPosts[\s\S]*state: 'QUEUE'/
    );
  });
});

describe('V112 finalize timeout: the unknown marker', () => {
  it('stops on a heartbeating finalize timeout instead of checking again', () => {
    const resolver = slice(
      POST_WORKFLOW,
      'const resolvePending',
      '// iterate over the posts'
    );
    const branch = resolver.slice(
      resolver.indexOf("if (handle.type === 'timeout'"),
      resolver.indexOf('errorAttempts++')
    );
    expect(branch).toContain('heartbeats');
    expect(branch).toContain("patched('post-finalize-timeout-unknown')");
    expect(branch).toContain('markUnconfirmed');
    expect(branch).toContain('return false');
    // The fall-through path sleeps 20s and runs check+finalize again; the
    // patched branch must be reached before the transient-error counter.
    expect(resolver.indexOf("if (handle.type === 'timeout'")).toBeLessThan(
      resolver.indexOf('errorAttempts++')
    );
  });

  it('treats only a heartbeat timeout without details as never-started', () => {
    expect(POST_WORKFLOW).toContain(
      "err.cause.timeoutType === TimeoutType.HEARTBEAT &&\n        !err.cause.lastHeartbeatDetails"
    );
    // A timeout without details may safely retry an irreversible mutation
    // because the activity never sent the "entered" heartbeat. Any other
    // timeout is unknown.
    expect(POST_WORKFLOW).toContain("return { type: 'retry', message: '' };");
    expect(POST_WORKFLOW).toContain("return { type: 'timeout', message: '' };");
    // Both irreversible activities heartbeat; checkPostStatus never does, so
    // it cannot be classified as never-started.
    expect(POST_ACTIVITY).toMatch(
      /async finalizePost\([\s\S]*return withHeartbeat\(\(\) =>/
    );
    expect(POST_ACTIVITY).toMatch(
      /async checkPostStatus\([\s\S]*getIntegration\.checkPostStatus\(/
    );
    expect(
      POST_ACTIVITY.slice(
        POST_ACTIVITY.indexOf('async checkPostStatus('),
        POST_ACTIVITY.indexOf('async finalizePost(')
      )
    ).not.toContain('withHeartbeat');
  });

  it('keeps the three outcomes on different branches', () => {
    const resolver = slice(
      POST_WORKFLOW,
      'const resolvePending',
      '// iterate over the posts'
    );
    const badBody = resolver.slice(
      resolver.indexOf("if (handle.type === 'bad-body')"),
      resolver.indexOf("if (handle.type === 'timeout'")
    );
    expect(badBody).toContain('changeState');
    expect(badBody).toContain("'ERROR'");
    // A platform rejection is terminal and is not the unconfirmed marker.
    expect(badBody).not.toContain('markUnconfirmed');

    const exhausted = resolver.slice(resolver.indexOf('// no verdict'));
    expect(exhausted).toContain("markUnconfirmed('Could not confirm the post status')");
  });
});

describe('activity registration needed by the fault paths', () => {
  it('keeps the irreversible publish activities registered and heartbeating', () => {
    const methods = Reflect.getMetadata(
      'TEMPORAL_ACTIVITY_METHOD',
      PostActivity.prototype
    );
    for (const name of [
      'postSocialPending',
      'checkPostStatus',
      'finalizePost',
      'updatePost',
      'changeState',
      'inAppNotification',
    ]) {
      expect(methods?.[name]?.name, name).toBe(name);
    }
    // A missing finalizePost registration would leave the execution RUNNING
    // at the timeout boundary instead of reaching the unknown marker.
    expect(POST_ACTIVITY).toMatch(
      /@ActivityMethod\(\)\s+async finalizePost\(/
    );
  });

  it('does not put the publish result write-back before the platform call', () => {
    const publish = slice(
      POST_WORKFLOW,
      'postsResults.push(',
      'posted = true;'
    );
    expect(publish).toContain('postSocialPending');
    expect(publish).not.toContain('updatePost');
  });
});
