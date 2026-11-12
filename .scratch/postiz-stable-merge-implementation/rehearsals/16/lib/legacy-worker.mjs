/**
 * The pre-upgrade worker that runs the *first* round of an old repeat post.
 *
 * Ticket 15's legacy worker deliberately refuses to publish; this one needs a
 * real first round before the hand-over, so it implements the activities the
 * frozen V102 definition calls against the same disposable database. The
 * workflow bundle itself is still the verbatim commit-C bundle from ticket 14.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import { legacyBundle } from '../../15/lib/old-worker.mjs';

async function loadThread(prisma, orgId, rootId) {
  const root = await prisma.post.findFirst({
    where: { id: rootId, organizationId: orgId },
    include: { integration: true },
  });
  if (!root) return [];

  const result = [root];
  let parent = root.id;
  for (let depth = 0; depth < 10; depth++) {
    const children = await prisma.post.findMany({
      where: { parentPostId: parent, organizationId: orgId },
      include: { integration: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!children.length) break;
    result.push(...children);
    parent = children[children.length - 1].id;
  }
  return result;
}

export function legacyActivities(prisma, calls) {
  const noop = () => undefined;
  let resultCounter = 0;

  return {
    getPost: async (orgId, postId) => {
      const [post] = await loadThread(prisma, orgId, postId);
      calls.record({ method: 'legacy.getPost', orgId, postId });
      return post;
    },
    getPostsList: async (orgId, postId) => {
      const list = await loadThread(prisma, orgId, postId);
      calls.record({ method: 'legacy.getPostsList', orgId, postId, count: list.length });
      return list;
    },
    getIntegrationById: async (orgId, id) => {
      return prisma.integration.findFirst({ where: { id, organizationId: orgId } });
    },
    isCommentable: () => true,
    postSocial: async (integration, posts) => {
      resultCounter += 1;
      const id = `legacy-post-${resultCounter}`;
      calls.record({
        method: 'post',
        worker: 'legacy',
        internalId: integration.internalId,
        token: integration.token,
        integrationId: integration.id,
        organizationId: integration.organizationId,
        posts: posts.map((post) => ({
          id: post.id,
          message: post.content,
          intervalInDays: post.intervalInDays,
        })),
      });
      return [
        {
          id: posts[0].id,
          postId: id,
          releaseURL: `https://legacy-stub.invalid/${id}`,
          status: 'success',
        },
      ];
    },
    postComment: async (postId, lastPostId, integration, posts) => {
      resultCounter += 1;
      const id = `legacy-comment-${resultCounter}`;
      calls.record({
        method: 'comment',
        worker: 'legacy',
        postId,
        lastPostId: lastPostId ?? null,
        integrationId: integration.id,
        organizationId: integration.organizationId,
        posts: posts.map((post) => ({ id: post.id, message: post.content })),
      });
      return [
        {
          id: posts[0].id,
          postId: id,
          releaseURL: `https://legacy-stub.invalid/${id}`,
          status: 'success',
        },
      ];
    },
    updatePost: async (id, postId, releaseURL) => {
      await prisma.post.update({
        where: { id },
        data: { state: 'PUBLISHED', releaseId: postId, releaseURL },
      });
    },
    changeState: async (id, state) => {
      await prisma.post.update({ where: { id }, data: { state } });
    },
    inAppNotification: noop,
    sendWebhooks: noop,
    internalPlugs: () => [],
    globalPlugs: () => [],
    processInternalPlug: noop,
    processPlug: () => false,
    refreshToken: async () => false,
    refreshTokenWithCause: async () => false,
    checkPostStatus: noop,
    finalizePost: noop,
    searchForMissingThreeHoursPosts: noop,
    sendEmail: noop,
    sendEmailAsync: noop,
    getUserOrgs: async () => ({ users: [] }),
    setStreak: noop,
    getLastPublishDate: async () => Date.now(),
  };
}

export async function startLegacyPublishingWorker({ address, prisma, calls }) {
  const bundle = await legacyBundle();
  const connection = await NativeConnection.connect({ address });
  const activities = legacyActivities(prisma, calls);

  const mainWorker = await Worker.create({
    connection,
    workflowBundle: { code: bundle.code },
    taskQueue: 'main',
    activities,
  });
  // Old deployments ran the publishing activities on the provider queue.
  const providerWorker = await Worker.create({
    connection,
    taskQueue: 'bluesky',
    activities,
  });

  const mainRun = mainWorker.run();
  const providerRun = providerWorker.run();
  let stopped = false;

  return {
    bundleSha256: bundle.sha256,
    async stop() {
      if (stopped) return;
      stopped = true;
      mainWorker.shutdown();
      providerWorker.shutdown();
      await Promise.all([mainRun.catch(() => {}), providerRun.catch(() => {})]);
      await connection.close().catch(() => {});
    },
  };
}
