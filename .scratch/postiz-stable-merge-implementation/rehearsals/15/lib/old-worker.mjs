/**
 * The pre-upgrade worker.
 *
 * It runs the workflow definitions extracted verbatim from commit C (shared
 * with the ticket-14 rehearsal) on the same ephemeral Temporal server. It only
 * lives long enough to create a real execution and let it reach its schedule
 * timer; the candidate worker then takes over the same execution.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import { bundleLegacy } from '../../14/lib/bundle.mjs';
import {
  LEGACY_BASE_WORKFLOWS,
  REHEARSAL_14_DIR,
} from './paths.mjs';
import { join } from 'node:path';

let cachedBundle = null;

export async function legacyBundle() {
  if (!cachedBundle) {
    cachedBundle = await bundleLegacy(LEGACY_BASE_WORKFLOWS, {
      signalDir: join(REHEARSAL_14_DIR, 'legacy/base/signals'),
    });
  }
  return cachedBundle;
}

const noop = () => undefined;

/**
 * Minimal activity stand-ins for the phase before hand-over. `getPost` /
 * `getPostsList` read the same synthetic rows the candidate worker will read,
 * so the schedule timer matches the database.
 */
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
      const post = await withIntegration(orgId, postId);
      return post ? [{ ...post, childrenPost: [] }] : [];
    },
    getIntegrationById: async (orgId, id) => {
      calls.record({ method: 'legacy.getIntegrationById', orgId, id });
      return prisma.integration.findFirst({ where: { id, organizationId: orgId } });
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

export async function startLegacyWorker({ address, prisma, calls }) {
  const bundle = await legacyBundle();
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    workflowBundle: { code: bundle.code },
    taskQueue: 'main',
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
