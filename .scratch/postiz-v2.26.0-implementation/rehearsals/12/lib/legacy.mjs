/**
 * The pre-upgrade worker used to create executions with the customised
 * v2.25.3 definitions (verbatim sources shared with the ticket-14 rehearsal).
 *
 * It only runs until the execution has recorded its first timer/signal handler;
 * the candidate worker then takes the same execution over. Its activities read
 * the same synthetic rows from the isolated database, so the schedule the old
 * workflow computed is the real one.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import { join } from 'node:path';
import { bundleLegacy } from '../../../../postiz-stable-merge-implementation/rehearsals/14/lib/bundle.mjs';
import { LEGACY_BASE_WORKFLOWS, LEGACY_REHEARSAL_DIR } from './paths.mjs';

let cachedBundle = null;

export async function legacyBundle() {
  if (!cachedBundle) {
    cachedBundle = await bundleLegacy(LEGACY_BASE_WORKFLOWS, {
      signalDir: join(LEGACY_REHEARSAL_DIR, 'legacy/base/signals'),
    });
  }
  return cachedBundle;
}

const noop = () => undefined;

/** Activities the old workflow can call before the hand-over point. */
export function legacyActivities(prisma, calls) {
  const withIntegration = async (orgId, postId) =>
    prisma.post.findFirst({
      where: { id: postId, organizationId: orgId },
      include: { integration: true },
    });

  return {
    getPost: async (orgId, postId) => {
      calls.record({ method: 'legacy.getPost', orgId, postId });
      return withIntegration(orgId, postId);
    },
    getPostsList: async (orgId, postId) => {
      calls.record({ method: 'legacy.getPostsList', orgId, postId });
      const post = await prisma.post.findFirst({
        where: { id: postId, organizationId: orgId, deletedAt: null },
        include: { integration: true, childrenPost: true },
      });
      if (!post) return [];
      // The old activity returned the root plus the first comment, exactly the
      // shape the pre-upgrade workflow used after its schedule timer.
      return [post, ...(post.childrenPost || [])];
    },
    getIntegrationById: async (orgId, id) => {
      calls.record({ method: 'legacy.getIntegrationById', orgId, id });
      return prisma.integration.findFirst({
        where: { id, organizationId: orgId },
      });
    },
    getIntegrationsById: async (id, orgId) => {
      calls.record({ method: 'legacy.getIntegrationsById', id, orgId });
      return prisma.integration.findFirst({
        where: { id, organizationId: orgId },
      });
    },
    isCommentable: () => false,
    postSocial: async () => {
      calls.record({ method: 'legacy.postSocial' });
      throw new Error('legacy worker must not publish in this rehearsal');
    },
    postComment: noop,
    updatePost: noop,
    inAppNotification: noop,
    changeState: noop,
    sendWebhooks: noop,
    internalPlugs: () => [],
    globalPlugs: () => [],
    processInternalPlug: noop,
    processPlug: () => false,
    refreshTokenWithCause: noop,
    checkPostStatus: noop,
    finalizePost: noop,
    searchForMissingThreeHoursPosts: noop,
    sendEmail: async (to, subject) => {
      calls.record({ method: 'legacy.sendEmail', to, subject });
    },
    sendEmailAsync: noop,
    getUserOrgs: async () => ({ users: [] }),
    setStreak: noop,
    getLastPublishDate: async () => Date.now(),
  };
}

export async function startLegacyWorker({ address, namespace = 'default', prisma, calls, taskQueue = 'main' }) {
  const bundle = await legacyBundle();
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    workflowBundle: { code: bundle.code },
    taskQueue,
    activities: legacyActivities(prisma, calls),
  });
  const run = worker.run();
  let stopped = false;
  return {
    bundleSha256: bundle.sha256,
    async stop() {
      if (stopped) return;
      stopped = true;
      worker.shutdown();
      await run.catch(() => {});
      await connection.close().catch(() => {});
    },
  };
}
