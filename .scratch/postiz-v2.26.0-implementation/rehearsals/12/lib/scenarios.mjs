/**
 * Scenario definitions for the in-flight Temporal continuity rehearsal
 * (implementation ticket 12).
 *
 * Every assertion reads a system seam: the database row, the Temporal
 * description/history/pollers, the substitute call log, or the local media
 * file. No product internals are asserted and no platform is contacted.
 *
 * The legacy executions are created by a worker running the customised
 * v2.25.3 workflow sources; that worker is stopped before the candidate worker
 * starts, so the same execution is handed over rather than recreated.
 */
import {
  defineSearchAttributeKey,
  SearchAttributeType,
  TypedSearchAttributes,
} from '@temporalio/common';
import {
  comments,
  emails,
  publishCalls,
  refreshCalls,
} from './calls.mjs';
import {
  ONE_PIXEL_PNG,
  seedOrganization,
  seedPost,
  sha256,
  snapshotPost,
  unique,
} from './seed.mjs';
import { startLegacyWorker } from './legacy.mjs';
import { startOrchestrator } from './stack.mjs';
import {
  describeWorkflow,
  historySummary,
  listExecutions,
  taskQueuePollers,
  terminateIfRunning,
  waitFor,
} from './temporal.mjs';
import { expectEqual, expectTrue, observe } from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postIdKey = defineSearchAttributeKey('postId', SearchAttributeType.TEXT);
const organizationIdKey = defineSearchAttributeKey(
  'organizationId',
  SearchAttributeType.TEXT
);

export const searchAttributes = (postId, organizationId) =>
  new TypedSearchAttributes([
    { key: postIdKey, value: postId },
    { key: organizationIdKey, value: organizationId },
  ]);

async function waitForEvent(client, workflowId, runId, eventName, timeoutMs = 60_000) {
  return waitFor(
    async () => {
      try {
        const summary = await historySummary(client, workflowId, runId);
        return summary.eventTypes.includes(eventName) ? summary : null;
      } catch {
        return null;
      }
    },
    { label: `${workflowId} ${eventName}`, timeoutMs, intervalMs: 300 }
  );
}

async function waitCompleted(client, workflowId, runId, timeoutMs = 60_000) {
  return waitFor(
    async () => {
      const description = await describeWorkflow(client, workflowId, runId);
      return description.status && description.status !== 'RUNNING'
        ? description
        : null;
    },
    { label: `${workflowId} completed`, timeoutMs, intervalMs: 300 }
  );
}

async function waitPublished(prisma, postId, timeoutMs = 90_000) {
  return waitFor(
    async () => {
      const post = await snapshotPost(prisma, postId);
      return post?.state === 'PUBLISHED' ? post : null;
    },
    { label: `post ${postId} PUBLISHED`, timeoutMs, intervalMs: 400 }
  );
}

export function scenarios({ prisma, temporal, calls, config }) {
  const bootCandidate = async ({ scanRacePost, compatQueues } = {}) => {
    const options = {
      databaseUrl: config.databaseUrl,
      redisUrl: config.redisUrl,
      temporalAddress: config.temporalAddress,
      temporalNamespace: config.temporalNamespace,
      uploadDirectory: config.uploadDirectory,
      frontendUrl: config.frontendUrl,
      callLog: calls.path,
      encryptionKey: config.encryptionKey,
      compatQueues: compatQueues ?? 'bluesky',
      scanRacePost,
    };
    // A worker boot is normally a few seconds; on a loaded machine it can
    // exceed the health wait once. Retry once, which keeps the hand-over
    // scenarios deterministic without weakening any assertion.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await startOrchestrator(options);
      } catch (err) {
        if (attempt === 2) throw err;
        console.warn(
          `[harness] orchestrator boot attempt ${attempt} failed; retrying: ${String(
            err.message
          ).split('\n')[0]}`
        );
      }
    }
  };

  const legacy = async () =>
    startLegacyWorker({
      address: config.temporalAddress,
      namespace: config.temporalNamespace,
      prisma,
      calls,
      taskQueue: 'main',
    });

  return [
    {
      id: 'v101-sleep-takeover',
      description:
        'A V101 execution created by the old bundle sleeps until its publish date; the candidate worker takes over the same workflow/run, publishes with the blocking postSocial contract, writes the result back and leaves the publish date unchanged.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const publishDate = new Date(Date.now() + 7000);
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic V101 post waiting for hand-over',
        });
        const workflowId = `post_${post.id}`;
        const callStart = calls.read().length;

        const oldWorker = await legacy();
        let handle;
        try {
          handle = await temporal.client.workflow.start('postWorkflowV101', {
            workflowId,
            taskQueue: 'main',
            args: [
              {
                taskQueue: 'bluesky',
                postId: post.id,
                organizationId: org.organization.id,
              },
            ],
            typedSearchAttributes: searchAttributes(
              post.id,
              org.organization.id
            ),
          });
          await waitForEvent(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId,
            'EVENT_TYPE_TIMER_STARTED'
          );
          observe('old execution before hand-over', {
            workflowId,
            runId: handle.firstExecutionRunId,
            type: 'postWorkflowV101',
          });
        } finally {
          await oldWorker.stop();
        }

        const candidate = await bootCandidate();
        try {
          const published = await waitPublished(prisma, post.id);
          observe('published row', published);
          expectEqual('state is PUBLISHED', published.state, 'PUBLISHED');
          expectEqual(
            'publish date is not rewritten',
            published.publishDate,
            publishDate.toISOString()
          );
          await waitCompleted(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          expectTrue('releaseId written', !!published.releaseId, published.releaseId);
          expectTrue('releaseURL written', !!published.releaseURL, published.releaseURL);

          const after = await describeWorkflow(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('execution after hand-over', after);
          expectEqual('workflow id is unchanged', after.workflowId, workflowId);
          expectEqual(
            'run id is unchanged (same execution)',
            after.runId,
            handle.firstExecutionRunId
          );
          expectEqual('workflow type stays V101', after.type, 'postWorkflowV101');
          expectEqual('workflow task queue stays main', after.taskQueue, 'main');
          expectEqual(
            'post business id remains a search attribute',
            after.searchAttributes.postId,
            post.id
          );

          const history = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('history after hand-over', {
            eventCount: history.eventCount,
            lastEvent: history.lastEvent,
            activities: history.activityScheduled,
          });
          expectEqual(
            'execution completed normally',
            history.lastEvent,
            'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'
          );
          expectTrue(
            'blocking postSocial ran on the provider queue',
            history.activityScheduled.some(
              (a) => a.activity === 'postSocial' && a.taskQueue === 'bluesky'
            )
          );
          expectTrue(
            'pending contract was not used by V101',
            !history.activityScheduled.some(
              (a) => a.activity === 'postSocialPending'
            )
          );

          const recent = calls.read().slice(callStart);
          const publishes = recent.filter(
            (call) =>
              (call.method === 'post' || call.method === 'postPending') &&
              call.organizationId === org.organization.id
          );
          observe('publish calls', publishes.map((call) => call.method));
          expectEqual('exactly one publish attempt', publishes.length, 1);
          expectEqual('old path uses blocking post', publishes[0].method, 'post');
          expectEqual(
            'publish targets the bound channel',
            publishes[0].integrationId,
            org.integration.id
          );
          expectEqual(
            'publish uses the stored credential',
            publishes[0].token,
            org.plainToken
          );
          const payload = publishes[0].posts[0];
          observe('payload contract', payload);
          expectEqual(
            'payload message matches the DB content',
            payload.message,
            'Synthetic V101 post waiting for hand-over'
          );
          expectEqual(
            'payload media bytes match the legacy file',
            payload.media[0].sha256,
            sha256(ONE_PIXEL_PNG)
          );
          expectEqual('provider read the whole image', payload.media[0].bytes, ONE_PIXEL_PNG.length);

          await terminateIfRunning(
            temporal.client,
            `streak_${org.organization.id}`,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'v102-delayed-comment',
      description:
        'A V102 execution created by the old bundle keeps its schedule timer, then publishes the root and, after the stored one-minute comment delay, the comment through the old postComment activity.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const publishDate = new Date(Date.now() + 6000);
        const root = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic V102 root with a delayed comment',
        });
        const comment = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic delayed comment',
          parentPostId: root.id,
          delay: 1,
        });
        const workflowId = `post_${root.id}`;
        const callStart = calls.read().length;

        const oldWorker = await legacy();
        let handle;
        try {
          handle = await temporal.client.workflow.start('postWorkflowV102', {
            workflowId,
            taskQueue: 'main',
            args: [
              {
                taskQueue: 'bluesky',
                postId: root.id,
                organizationId: org.organization.id,
              },
            ],
            typedSearchAttributes: searchAttributes(
              root.id,
              org.organization.id
            ),
          });
          await waitForEvent(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId,
            'EVENT_TYPE_TIMER_STARTED'
          );
        } finally {
          await oldWorker.stop();
        }

        const candidate = await bootCandidate();
        try {
          const publishedRoot = await waitPublished(prisma, root.id, 60_000);
          observe('root published', publishedRoot);
          const recentAfterRoot = calls
            .read()
            .slice(callStart)
            .filter(
              (call) =>
                (call.method === 'post' || call.method === 'postPending') &&
                call.organizationId === org.organization.id
            );
          expectEqual('root publish once', recentAfterRoot.length, 1);
          const rootCallAt = Date.parse(recentAfterRoot[0].at);

          const publishedComment = await waitPublished(prisma, comment.id, 100_000);
          observe('comment published', publishedComment);
          await waitCompleted(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          expectEqual('comment state is PUBLISHED', publishedComment.state, 'PUBLISHED');
          expectEqual(
            'root publish date is not rewritten',
            publishedRoot.publishDate,
            publishDate.toISOString()
          );
          expectEqual(
            'comment keeps the same scheduled date',
            publishedComment.publishDate,
            publishDate.toISOString()
          );

          const recent = calls.read().slice(callStart);
          const commentCalls = comments(recent).filter(
            (call) => call.organizationId === org.organization.id
          );
          observe('comment calls', commentCalls.map((call) => ({
            postId: call.postId,
            lastPostId: call.lastPostId,
            message: call.posts[0]?.message,
            at: call.at,
          })));
          expectEqual('exactly one comment call', commentCalls.length, 1);
          expectEqual(
            'comment is posted under the root platform id',
            commentCalls[0].postId,
            publishedRoot.releaseId
          );
          expectEqual(
            'comment payload is the delayed DB row',
            commentCalls[0].posts[0].message,
            'Synthetic delayed comment'
          );
          const delayMs = Date.parse(commentCalls[0].at) - rootCallAt;
          observe('measured comment delay (ms)', delayMs);
          expectTrue(
            'comment respected the one-minute delay',
            delayMs >= 55_000,
            `measured ${delayMs}ms`
          );

          const history = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('history', {
            eventCount: history.eventCount,
            lastEvent: history.lastEvent,
            activities: history.activityScheduled,
          });
          expectTrue(
            'postComment ran on the provider queue',
            history.activityScheduled.some(
              (a) => a.activity === 'postComment' && a.taskQueue === 'bluesky'
            )
          );
          expectTrue(
            'updatePost wrote both rows back',
            history.activityScheduled.filter((a) => a.activity === 'updatePost')
              .length >= 2
          );
          expectEqual(
            'execution completed normally',
            history.lastEvent,
            'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'
          );

          await terminateIfRunning(
            temporal.client,
            `streak_${org.organization.id}`,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'v102-repeat-child',
      description:
        'A V102 parent created by the old bundle starts a V102 repeat child; the candidate consumes both the parent and the child on the same old definition. The interval is negative only to make the repeat timer due immediately; the startChild branch is unchanged.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const publishDate = new Date(Date.now() + 6000);
        const root = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic V102 repeat parent',
          intervalInDays: -1,
        });
        const workflowId = `post_${root.id}`;
        const callStart = calls.read().length;

        const oldWorker = await legacy();
        let handle;
        try {
          handle = await temporal.client.workflow.start('postWorkflowV102', {
            workflowId,
            taskQueue: 'main',
            args: [
              {
                taskQueue: 'bluesky',
                postId: root.id,
                organizationId: org.organization.id,
              },
            ],
            typedSearchAttributes: searchAttributes(
              root.id,
              org.organization.id
            ),
          });
          await waitForEvent(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId,
            'EVENT_TYPE_TIMER_STARTED'
          );
        } finally {
          await oldWorker.stop();
        }

        // The parent already loaded intervalInDays into workflow memory before
        // the hand-over. Clearing the DB value now keeps the parent's one
        // repeat, while the child (which reads the DB when it starts) does not
        // create an endless accelerated chain.
        await prisma.post.update({
          where: { id: root.id },
          data: { intervalInDays: null },
        });

        const candidate = await bootCandidate();
        try {
          const child = await waitFor(
            async () => {
              const running = await listExecutions(
                temporal.client,
                `WorkflowId STARTS_WITH "post_${root.id}_"`
              );
              return running[0] ?? null;
            },
            { label: 'V102 repeat child', timeoutMs: 60_000, intervalMs: 500 }
          );
          observe('repeat child execution', child);
          expectEqual('child type is the old V102', child.type, 'postWorkflowV102');
          expectTrue(
            'child id uses the repeat prefix',
            child.workflowId.startsWith(`post_${root.id}_`),
            child.workflowId
          );

          await waitFor(
            async () => {
              const publishes = calls
                .read()
                .slice(callStart)
                .filter(
                  (call) =>
                    (call.method === 'post' || call.method === 'postPending') &&
                    call.organizationId === org.organization.id
                );
              return publishes.length >= 2 ? publishes : null;
            },
            { label: 'parent and child publish', timeoutMs: 60_000 }
          );

          const recent = calls.read().slice(callStart);
          const publishes = recent.filter(
            (call) =>
              (call.method === 'post' || call.method === 'postPending') &&
              call.organizationId === org.organization.id
          );
          observe('publish calls', publishes.map((call) => ({
            method: call.method,
            postId: call.postId,
          })));
          expectEqual('parent and child each published once', publishes.length, 2);
          expectTrue(
            'both generations used the old blocking contract',
            publishes.every((call) => call.method === 'post')
          );

          await waitCompleted(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          const parentHistory = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('parent history child starts', parentHistory.childWorkflows);
          expectTrue(
            'parent recorded a V102 child',
            parentHistory.childWorkflows.some(
              (childStart) =>
                childStart.workflowType === 'postWorkflowV102' &&
                childStart.workflowId.startsWith(`post_${root.id}_`)
            )
          );
          expectEqual(
            'parent completed normally',
            parentHistory.lastEvent,
            'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'
          );

          const published = await snapshotPost(prisma, root.id);
          observe('root row after repeat', published);
          expectEqual('root remains PUBLISHED', published.state, 'PUBLISHED');

          await terminateIfRunning(
            temporal.client,
            `streak_${org.organization.id}`,
            'ticket 12 rehearsal cleanup'
          );
          for (const execution of await listExecutions(
            temporal.client,
            `WorkflowId STARTS_WITH "post_${root.id}_"`
          )) {
            await terminateIfRunning(
              temporal.client,
              execution.workflowId,
              'ticket 12 rehearsal cleanup'
            );
          }
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'v112-pending-finalize',
      description:
        'A new V112 execution takes the provider through postPending, checkPostStatus and finalizePost exactly once, writes the finalize result back and keeps the requested publish date and timezone untouched.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        // A timezone-carrying wall time that is still in the near future. The
        // absolute instant must survive the workflow unchanged.
        const publishDate = new Date(Date.now() + 3000);
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic V112 pending post',
        });
        const workflowId = `post_${post.id}`;
        const callStart = calls.read().length;

        const candidate = await bootCandidate();
        try {
          const handle = await temporal.client.workflow.start(
            'postWorkflowV112',
            {
              workflowId,
              taskQueue: 'main',
              args: [
                {
                  taskQueue: 'bluesky',
                  postId: post.id,
                  organizationId: org.organization.id,
                },
              ],
              typedSearchAttributes: searchAttributes(
                post.id,
                org.organization.id
              ),
            }
          );
          const published = await waitPublished(prisma, post.id);
          observe('published row', published);
          expectEqual('state is PUBLISHED', published.state, 'PUBLISHED');
          expectEqual(
            'publish date is not converted by the workflow',
            published.publishDate,
            publishDate.toISOString()
          );
          await waitCompleted(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );

          const recent = calls.read().slice(callStart);
          const pending = recent.filter(
            (call) =>
              call.method === 'postPending' &&
              call.organizationId === org.organization.id
          );
          const checks = recent.filter(
            (call) =>
              call.method === 'checkPostStatus' &&
              call.integrationId === org.integration.id
          );
          const finalizes = recent.filter(
            (call) =>
              call.method === 'finalizePost' &&
              call.integrationId === org.integration.id
          );
          const blocking = recent.filter(
            (call) =>
              call.method === 'post' &&
              call.organizationId === org.organization.id
          );
          observe('pending/finalize calls', {
            pending: pending.length,
            checks: checks.length,
            finalizes: finalizes.length,
            blocking: blocking.length,
          });
          expectEqual('pending accepted exactly once', pending.length, 1);
          expectEqual('status checked exactly once', checks.length, 1);
          expectEqual('finalize ran exactly once', finalizes.length, 1);
          expectEqual('V112 did not use the blocking activity', blocking.length, 0);
          expectEqual(
            'releaseId is the finalize result',
            published.releaseId,
            finalizes[0].pendingData.id
          );
          expectEqual(
            'releaseURL is the finalize result',
            published.releaseURL,
            `https://stub.invalid/${finalizes[0].pendingData.id}`
          );

          const payload = pending[0].posts[0];
          observe('pending payload', payload);
          expectEqual(
            'payload message matches the DB content',
            payload.message,
            'Synthetic V112 pending post'
          );
          expectEqual(
            'payload media is the local legacy image',
            payload.media[0].sha256,
            sha256(ONE_PIXEL_PNG)
          );

          const after = await describeWorkflow(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('execution', after);
          expectEqual('new starts use V112', after.type, 'postWorkflowV112');
          expectEqual('workflow id keeps the post id', after.workflowId, workflowId);
          expectEqual('workflow queue is main', after.taskQueue, 'main');
          expectEqual(
            'post id search attribute written',
            after.searchAttributes.postId,
            post.id
          );

          const history = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('history activity queues', history.activityScheduled);
          expectTrue(
            'postPending ran on the provider queue',
            history.activityScheduled.some(
              (a) => a.activity === 'postSocialPending' && a.taskQueue === 'bluesky'
            )
          );
          expectTrue(
            'checkPostStatus ran on the provider queue',
            history.activityScheduled.some(
              (a) => a.activity === 'checkPostStatus' && a.taskQueue === 'bluesky'
            )
          );
          expectTrue(
            'finalizePost ran on the provider queue',
            history.activityScheduled.some(
              (a) => a.activity === 'finalizePost' && a.taskQueue === 'bluesky'
            )
          );
          expectTrue(
            'database write-back ran on main',
            history.activityScheduled.some(
              (a) => a.activity === 'updatePost' && a.taskQueue === 'main'
            )
          );
          expectEqual(
            'execution completed normally',
            history.lastEvent,
            'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'
          );

          await terminateIfRunning(
            temporal.client,
            `streak_${org.organization.id}`,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'refresh-backlog',
      description:
        'An old refreshTokenWorkflow created before the hand-over wakes on its expiry timer; the candidate executes the decorated refreshToken activity, decrypts the enc:v1: credentials and stores the rotated tokens.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
          encryptWithKey: config.encryptionKey,
          tokenExpiration: new Date(Date.now() + 20_000),
        });
        const workflowId = `refresh_${org.integration.id}`;
        const callStart = calls.read().length;

        const oldWorker = await legacy();
        let handle;
        try {
          handle = await temporal.client.workflow.start('refreshTokenWorkflow', {
            workflowId,
            taskQueue: 'main',
            args: [
              {
                integrationId: org.integration.id,
                organizationId: org.organization.id,
              },
            ],
          });
          await waitForEvent(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId,
            'EVENT_TYPE_TIMER_STARTED'
          );
          const before = await describeWorkflow(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('old refresh execution', before);
          expectEqual('refresh type', before.type, 'refreshTokenWorkflow');
          expectEqual('refresh workflow id', before.workflowId, workflowId);
          expectEqual('refresh runs on main', before.taskQueue, 'main');
        } finally {
          await oldWorker.stop();
        }

        const candidate = await bootCandidate();
        try {
          const refresh = await waitFor(
            async () => {
              const found = refreshCalls(calls.read().slice(callStart));
              return found[0] ?? null;
            },
            { label: 'candidate refreshToken activity', timeoutMs: 45_000 }
          );
          observe('provider refresh call', refresh);
          expectEqual(
            'candidate decrypted the stored refresh token before the provider call',
            refresh.refreshToken,
            org.plainRefreshToken
          );

          const row = await prisma.integration.findUnique({
            where: { id: org.integration.id },
          });
          observe('stored credentials after refresh', {
            tokenPrefix: row.token.slice(0, 12),
            refreshPrefix: row.refreshToken.slice(0, 12),
            tokenExpiration: row.tokenExpiration?.toISOString(),
            refreshNeeded: row.refreshNeeded,
          });
          expectTrue(
            'plaintext token replaced with an enc:v1: value',
            row.token.startsWith('enc:v1:') && row.token !== org.integration.token
          );
          expectTrue(
            'rotated refresh token stored encrypted',
            row.refreshToken.startsWith('enc:v1:')
          );
          expectTrue(
            'token expiration moved forward',
            row.tokenExpiration.getTime() > Date.now()
          );
          expectEqual('channel is not flagged for reconnect', row.refreshNeeded, false);

          const history = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('refresh history activities', history.activityScheduled);
          expectTrue(
            'decorated refreshToken activity was scheduled on main',
            history.activityScheduled.some(
              (a) => a.activity === 'refreshToken' && a.taskQueue === 'main'
            )
          );
          expectTrue(
            'getIntegrationsById also ran on main',
            history.activityScheduled.filter(
              (a) => a.activity === 'getIntegrationsById' && a.taskQueue === 'main'
            ).length >= 2
          );

          await terminateIfRunning(
            temporal.client,
            workflowId,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'legacy-email-drain',
      description:
        'A pre-existing send_email singleton with one queued message is drained by the candidate through the old sendEmail activity on main; a second signal is appended and both recipients receive exactly one message.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const workflowId = 'send_email';
        const callStart = calls.read().length;

        // Create the old singleton before any candidate worker exists, with a
        // queued backlog. The workflow type and queue shape are the pre-upgrade
        // ones; a candidate worker is what consumes the first workflow task.
        const handle = await temporal.client.workflow.start('sendEmailWorkflow', {
          workflowId,
          taskQueue: 'main',
          args: [
            {
              queue: [
                {
                  to: 'backlog-one@synthetic.invalid',
                  subject: 'Synthetic backlog one',
                  html: '<p>backlog one</p>',
                  addTo: 'bottom',
                },
              ],
            },
          ],
        });
        observe('pre-existing singleton', {
          workflowId,
          runId: handle.firstExecutionRunId,
          type: 'sendEmailWorkflow',
        });

        const candidate = await bootCandidate({ compatQueues: '' });
        try {
          await handle.signal('sendEmail', {
            to: 'backlog-two@synthetic.invalid',
            subject: 'Synthetic backlog two',
            html: '<p>backlog two</p>',
            addTo: 'top',
          });

          await waitFor(
            async () => {
              const found = emails(calls.read().slice(callStart));
              return found.length >= 2 ? found : null;
            },
            { label: 'two old-singleton emails', timeoutMs: 45_000 }
          );

          const sent = emails(calls.read().slice(callStart));
          observe('emails', sent.map((call) => ({
            to: call.to,
            subject: call.subject,
          })));
          expectEqual('exactly two emails sent', sent.length, 2);
          expectEqual(
            'both queued recipients received one message',
            sent.map((call) => call.to).sort(),
            [
              'backlog-one@synthetic.invalid',
              'backlog-two@synthetic.invalid',
            ]
          );
          expectEqual(
            'no recipient received a duplicate',
            new Set(sent.map((call) => call.to)).size,
            2
          );

          const after = await describeWorkflow(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('singleton after drain', after);
          expectEqual('old singleton type is kept', after.type, 'sendEmailWorkflow');
          expectEqual('old singleton queue is main', after.taskQueue, 'main');
          expectEqual('singleton is still running', after.status, 'RUNNING');

          const history = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('email history', {
            eventCount: history.eventCount,
            signals: history.signalWithStart,
            activities: history.activityScheduled,
          });
          expectTrue(
            'sendEmail activity ran on main',
            history.activityScheduled.some(
              (a) => a.activity === 'sendEmail' && a.taskQueue === 'main'
            )
          );
          expectTrue(
            'no per-email workflow was involved in the old singleton',
            !calls
              .read()
              .slice(callStart)
              .some((call) => call.method === 'newEmailWorkflow')
          );

          await terminateIfRunning(
            temporal.client,
            workflowId,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'compat-provider-queue',
      description:
        'With COMPAT_WORKFLOW_QUEUES=bluesky the candidate polls the provider queue for workflows as well as activities, so a V102 execution whose workflow task queue is bluesky completes; an unlisted provider queue stays activity-only.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const publishDate = new Date(Date.now() + 2500);
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic provider-queue legacy workflow',
        });
        const workflowId = `post_${post.id}`;
        const callStart = calls.read().length;

        const candidate = await bootCandidate({ compatQueues: 'bluesky' });
        try {
          const mainWorkflowPollers = await taskQueuePollers(
            temporal.client,
            'main',
            'WORKFLOW',
            config.temporalNamespace
          );
          const providerWorkflowPollers = await taskQueuePollers(
            temporal.client,
            'bluesky',
            'WORKFLOW',
            config.temporalNamespace
          );
          const unlistedWorkflowPollers = await taskQueuePollers(
            temporal.client,
            'x',
            'WORKFLOW',
            config.temporalNamespace
          );
          observe('workflow pollers', {
            main: mainWorkflowPollers.length,
            bluesky: providerWorkflowPollers.length,
            x: unlistedWorkflowPollers.length,
          });
          expectTrue('main has a workflow poller', mainWorkflowPollers.length > 0);
          expectTrue(
            'compat-listed provider queue has a workflow poller',
            providerWorkflowPollers.length > 0
          );
          expectEqual(
            'unlisted provider queue stays activity-only',
            unlistedWorkflowPollers.length,
            0
          );

          const handle = await temporal.client.workflow.start(
            'postWorkflowV102',
            {
              workflowId,
              taskQueue: 'bluesky',
              args: [
                {
                  taskQueue: 'bluesky',
                  postId: post.id,
                  organizationId: org.organization.id,
                },
              ],
              typedSearchAttributes: searchAttributes(
                post.id,
                org.organization.id
              ),
            }
          );
          const published = await waitPublished(prisma, post.id);
          observe('published row', published);
          expectEqual('state is PUBLISHED', published.state, 'PUBLISHED');
          await waitCompleted(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );

          const after = await describeWorkflow(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('execution', after);
          expectEqual('workflow type is old V102', after.type, 'postWorkflowV102');
          expectEqual(
            'workflow task queue is the compat provider queue',
            after.taskQueue,
            'bluesky'
          );

          const history = await historySummary(
            temporal.client,
            workflowId,
            handle.firstExecutionRunId
          );
          observe('history activities', history.activityScheduled);
          expectTrue(
            'blocking publish ran on the provider queue',
            history.activityScheduled.some(
              (a) => a.activity === 'postSocial' && a.taskQueue === 'bluesky'
            )
          );
          expectEqual(
            'execution completed normally',
            history.lastEvent,
            'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'
          );

          const recent = calls.read().slice(callStart);
          const publishes = publishCalls(recent).filter(
            (call) => call.organizationId === org.organization.id
          );
          expectEqual('one publish', publishes.length, 1);
          expectEqual('blocking contract used', publishes[0].method, 'post');

          await terminateIfRunning(
            temporal.client,
            `streak_${org.organization.id}`,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },

    {
      id: 'missing-scan',
      description:
        'The hourly maintenance scan re-reads each candidate before dispatching: a deleted post and an already-published post start nothing, a post published by another worker after the scan loaded it is skipped, and a still-QUEUE post starts V112 and publishes.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const stale = new Date(Date.now() - 60 * 60 * 1000);
        const live = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: stale,
          content: 'Synthetic live stale QUEUE post',
        });
        const deleted = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: stale,
          content: 'Synthetic deleted stale post',
          deletedAt: new Date(),
        });
        const alreadyPublished = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: stale,
          content: 'Synthetic already published stale post',
          state: 'PUBLISHED',
        });
        const race = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: stale,
          content: 'Synthetic post published after the scan loaded it',
        });
        const missingWorkflowId = `missing-post-${unique('scan')}`;
        const callStart = calls.read().length;

        const candidate = await bootCandidate({ scanRacePost: race.id });
        try {
          await temporal.client.workflow.start('missingPostWorkflow', {
            workflowId: missingWorkflowId,
            taskQueue: 'main',
          });

          const published = await waitPublished(prisma, live.id, 60_000);
          observe('live stale post published', published);
          expectEqual('live QUEUE post published', published.state, 'PUBLISHED');
          await waitCompleted(temporal.client, `post_${live.id}`);

          const raceRow = await snapshotPost(prisma, race.id);
          observe('race post row', raceRow);
          expectEqual(
            'race post was marked PUBLISHED after the scan loaded it',
            raceRow.state,
            'PUBLISHED'
          );

          const liveExecution = await describeWorkflow(
            temporal.client,
            `post_${live.id}`
          );
          observe('dispatched execution', liveExecution);
          expectEqual('scan dispatched V112', liveExecution.type, 'postWorkflowV112');
          expectEqual('scan used the post business id', liveExecution.workflowId, `post_${live.id}`);

          for (const [name, post] of [
            ['race', race],
            ['deleted', deleted],
            ['already published', alreadyPublished],
          ]) {
            const execution = await describeWorkflow(
              temporal.client,
              `post_${post.id}`
            );
            observe(`${name} execution`, execution);
            expectTrue(
              `scan did not dispatch the ${name} post`,
              !!execution.error
            );
          }

          const recent = calls.read().slice(callStart);
          const publishes = publishCalls(recent).filter(
            (call) => call.organizationId === org.organization.id
          );
          observe('publish calls', publishes.map((call) => call.method));
          expectEqual('only the live post published', publishes.length, 1);
          expectTrue(
            'scan race hook ran',
            recent.some((call) => call.method === 'scanRace' && call.postId === race.id)
          );

          const history = await historySummary(
            temporal.client,
            'post_' + live.id
          );
          observe('dispatched history', {
            lastEvent: history.lastEvent,
            activities: history.activityScheduled,
          });
          expectEqual(
            'dispatched V112 completed',
            history.lastEvent,
            'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'
          );

          await terminateIfRunning(
            temporal.client,
            missingWorkflowId,
            'ticket 12 rehearsal cleanup'
          );
          await terminateIfRunning(
            temporal.client,
            `streak_${org.organization.id}`,
            'ticket 12 rehearsal cleanup'
          );
        } finally {
          await candidate.process.stop();
        }
      },
    },
  ];
}
