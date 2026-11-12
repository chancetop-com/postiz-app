import { describe, expect, it, vi } from 'vitest';
import * as workflows from '@gitroom/orchestrator/workflows';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import { AutopostActivity } from '@gitroom/orchestrator/activities/autopost.activity';

/**
 * Ticket 14: an upgrade may not drop a workflow type, an activity name or the
 * blocking `postSocial` contract. Existing executions (and repeat children that
 * keep creating old versions) must keep resolving after the candidate starts.
 */
const historicalWorkflowTypes = [
  // Posts: every version that can still be reachable from a recorded history
  'postWorkflowV101',
  'postWorkflowV102',
  'postWorkflowV103',
  'postWorkflowV104',
  'postWorkflowV105',
  'postWorkflowV106',
  'postWorkflowV107',
  'postWorkflowV108',
  'postWorkflowV109',
  'postWorkflowV110',
  'postWorkflowV111',
  'postWorkflowV112',
  // Long running same-named workflows and their follow-ups
  'autoPostWorkflow',
  'missingPostWorkflow',
  'streakWorkflow',
  'streakWorkflowV2',
  'refreshTokenWorkflow',
  'digestEmailWorkflow',
  // Legacy email backlog singleton plus the new per-email workflow
  'sendEmailWorkflow',
  'sendSingleEmailWorkflow',
  // Newer media workflows that already exist in the candidate
  'generateVideoWorkflow',
  'processMediaWorkflow',
  'clippingWorkflow',
  'clippingClipWorkflow',
];

describe('workflow registry', () => {
  it.each(historicalWorkflowTypes)('still exports %s', (name) => {
    expect((workflows as Record<string, unknown>)[name]).toBeTypeOf('function');
  });
});

/** Activities reachable from pre-upgrade histories. */
const postActivityNames = [
  'getPostsList',
  'getIntegrationById',
  'isCommentable',
  'postSocial',
  'postSocialPending',
  'postComment',
  'updatePost',
  'inAppNotification',
  'changeState',
  'sendWebhooks',
  'internalPlugs',
  'globalPlugs',
  'processInternalPlug',
  'processPlug',
  'refreshTokenWithCause',
  'getPost',
  'checkPostStatus',
  'finalizePost',
  'searchForMissingThreeHoursPosts',
];

const emailActivityNames = [
  'sendEmail',
  'sendEmailAsync',
  'getUserOrgs',
  'setStreak',
  'getLastPublishDate',
];

describe('activity contract', () => {
  it.each(postActivityNames)('PostActivity still implements %s', (name) => {
    expect(PostActivity.prototype[name]).toBeTypeOf('function');
  });

  it.each(emailActivityNames)('EmailActivity still implements %s', (name) => {
    expect(EmailActivity.prototype[name]).toBeTypeOf('function');
  });

  it('keeps the old refresh and autopost activity names', () => {
    expect(IntegrationsActivity.prototype.getIntegrationsById).toBeTypeOf('function');
    expect(IntegrationsActivity.prototype.refreshToken).toBeTypeOf('function');
    expect(AutopostActivity.prototype.autoPost).toBeTypeOf('function');
  });

  it('keeps postSocial blocking while postSocialPending is the opt-in pending path', async () => {
    const activity = Object.create(PostActivity.prototype);
    const seen: boolean[] = [];
    const spy = vi
      .spyOn(PostActivity.prototype, 'postSocialInternal')
      .mockImplementation(async (...args: unknown[]) => {
        seen.push(args[2] as boolean);
        return [];
      });

    try {
      await activity.postSocial({ id: 'integration' }, [{ id: 'post' }]);
      await activity.postSocialPending({ id: 'integration' }, [{ id: 'post' }]);
    } finally {
      spy.mockRestore();
    }

    // V101/V102 call postSocial and expect a blocking PostResponse[]; the
    // pending/finalize contract must stay behind a different activity name.
    expect(seen).toEqual([false, true]);
  });
});
