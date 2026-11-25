import { expect, it, vi } from 'vitest';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

it('dispatches only posts that are still queued when the missing-post scan reaches them', async () => {
  const states = new Map([
    ['published', { state: 'PUBLISHED' }],
    ['queued', { state: 'QUEUE' }],
  ]);
  const posts = {
    searchForMissingThreeHoursPosts: async () =>
      ['deleted', 'published', 'queued'].map((id) => ({
        id,
        organizationId: 'org-1',
        integration: { providerIdentifier: 'linkedin-page' },
      })),
    getPostState: async (id: string) => states.get(id) ?? null,
  };
  const signalWithStart = vi.fn().mockResolvedValue({});
  const temporal = {
    client: { getRawClient: () => ({ workflow: { signalWithStart } }) },
  };
  const activity = new PostActivity(
    posts as never,
    undefined!,
    undefined!,
    undefined!,
    undefined!,
    undefined!,
    temporal as never,
    undefined!
  );

  await activity.searchForMissingThreeHoursPosts();

  expect(signalWithStart).toHaveBeenCalledTimes(1);
  expect(signalWithStart).toHaveBeenCalledWith(
    'postWorkflowV112',
    expect.objectContaining({
      workflowId: 'post_queued',
      taskQueue: 'main',
      signal: 'poke',
      workflowIdConflictPolicy: 'USE_EXISTING',
      args: [
        { postId: 'queued', organizationId: 'org-1', taskQueue: 'linkedin' },
      ],
    })
  );
});
