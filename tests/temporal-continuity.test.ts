import { describe, expect, it, vi } from 'vitest';
import type { Integration, Post } from '@prisma/client';
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
  const registrations = [
    [PostActivity, postActivityNames],
    [EmailActivity, emailActivityNames],
    [IntegrationsActivity, ['getIntegrationsById', 'refreshToken']],
    [AutopostActivity, ['autoPost']],
  ] as const;

  for (const [activity, names] of registrations) {
    it.each([...names])(
      `${activity.name} registers %s with the worker`,
      (name) => {
        const methods = Reflect.getMetadata(
          'TEMPORAL_ACTIVITY_METHOD',
          activity.prototype
        );
        expect(methods?.[name]?.name).toBe(name);
      }
    );
  }

  it('keeps postSocial blocking while postSocialPending is the opt-in pending path', async () => {
    const provider = {
      editor: 'normal',
      post: async () => [
        {
          id: 'post-1',
          status: 'completed',
          postId: 'published',
          releaseURL: 'https://example.org/published',
        },
      ],
      postPending: async () => [
        {
          id: 'post-1',
          status: 'pending',
          postId: '',
          releaseURL: '',
          pendingData: { job: 'job-1' },
        },
      ],
    };
    const posts = [
      { id: 'post-1', content: 'Hello', settings: '{}', image: '[]' },
    ] as Post[];
    const integration = {
      providerIdentifier: 'example',
      organizationId: 'org-1',
      internalId: 'channel',
      token: 'token',
    } as Integration;
    const activity = new PostActivity(
      {
        updateTags: async (_org: string, items: Post[]) => items,
        updateMedia: async () => [],
      } as never,
      undefined!,
      { getSocialIntegration: () => provider } as never,
      { decryptTokens: async (value: Integration) => value } as never,
      undefined!,
      undefined!,
      {
        client: { getRawClient: () => ({ workflow: { start: vi.fn() } }) },
      } as never,
      { getSubscription: async () => ({}) } as never
    );

    await expect(
      activity.postSocial(integration, posts)
    ).resolves.toMatchObject([{ status: 'completed', postId: 'published' }]);
    await expect(
      activity.postSocialPending(integration, posts)
    ).resolves.toMatchObject([
      { status: 'pending', pendingData: { job: 'job-1' } },
    ]);
  });
});
