/**
 * Ticket 17 scenarios: unknown-result fault injection, compatible rollback
 * coverage, and coordinated database/media/Temporal recovery.
 *
 * Every assertion reads a system seam: the stub call log (what the external
 * substitute actually received), the Temporal description/history, the
 * database row, the media file, or the worker process. The candidate backend
 * and orchestrator are the compiled processes PM2 starts; only the fault
 * preload is injected.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  describeWorkflow,
  historySummary,
  waitFor,
} from '../../15/lib/temporal-env.mjs';
import { emails } from '../../15/lib/calls.mjs';
import { seedOrganization, snapshotPost } from '../../15/lib/seed.mjs';
import {
  businessSnapshot,
  compareTrees,
  copyTree,
  digestTree,
  dumpDatabase,
  restoreDatabase,
  restoreTree,
  schemaSnapshot,
} from './correlation.mjs';
import { EVIDENCE_DIR, REPO_ROOT, WORK_DIR } from './paths.mjs';
import { seedCommentThread, seedRefreshChannel, seedStalePost } from '../../16/lib/seed16.mjs';
import { armFaults, clearFaults, killProcessGroup, processAlive, startBackend, waitForHttp } from './stack.mjs';
import { startIncompleteRefreshWorker } from './incomplete-worker.mjs';
import {
  expectEqual,
  expectTrue,
  observe,
  recordFault,
  recordQueues,
} from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;
const MINUTE = 60_000;

const faultsFor = (calls) => calls.read().filter((call) => call.method === 'fault');
const publishesFor = (calls, postId) =>
  calls
    .read()
    .filter(
      (call) =>
        (call.method === 'post' || call.method === 'postPending') &&
        call.posts?.[0]?.id === postId
    );
const methodFor = (calls, method, postId) =>
  calls
    .read()
    .filter(
      (call) =>
        call.method === method && (!postId || call.posts?.[0]?.id === postId)
    );

/** finalizePost / checkPostStatus payloads carry no post id; use the channel. */
const channelCalls = (calls, method, integrationId) =>
  calls
    .read()
    .filter(
      (call) =>
        call.method === method &&
        (!integrationId || call.integrationId === integrationId)
    );

async function startV112(context, { postId, organizationId, workflowId }) {
  const { temporal } = context;
  return temporal.client.workflow.start('postWorkflowV112', {
    workflowId: workflowId || `post_${postId}`,
    taskQueue: 'main',
    args: [{ taskQueue: 'bluesky', postId, organizationId }],
    searchAttributes: {
      postId: [postId],
      organizationId: [organizationId],
    },
  });
}

async function waitPostState(context, postId, state, timeoutMs = 120_000) {
  return waitFor(
    async () => {
      const post = await snapshotPost(context.prisma, postId);
      return post?.state === state ? post : null;
    },
    { label: `post ${postId} ${state}`, timeoutMs, intervalMs: 500 }
  );
}

async function waitPublishCount(context, postId, expected, timeoutMs = 120_000) {
  return waitFor(
    async () => {
      const list = publishesFor(context.calls, postId);
      return list.length >= expected ? list : null;
    },
    { label: `${expected} publish call(s) for ${postId}`, timeoutMs, intervalMs: 500 }
  );
}

/**
 * A database write-back and the workflow completion are two separate events:
 * the row can say ERROR/PUBLISHED while the workflow task that returns is still
 * in flight. Wait for the execution, never assume it from the row.
 */
async function waitCompleted(client, workflowId, timeoutMs = 60_000) {
  return waitFor(
    async () => {
      const description = await describeWorkflow(client, workflowId);
      return description.status === 'COMPLETED' ? description : null;
    },
    { label: `workflow ${workflowId} completed`, timeoutMs, intervalMs: 500 }
  );
}

function activityOn(history, name) {
  return (history.activityScheduled || []).find((item) => item.activity === name);
}

function recordExecutionQueues(description, history) {
  recordQueues({
    workflowTaskQueue: description?.taskQueue,
    activityScheduled: history?.activityScheduled ?? [],
  });
}

/**
 * The server's own view of a still-running activity, including the last
 * heartbeat details. This is what the workflow's TimeoutFailure will carry.
 */
async function pendingActivity(client, workflowId, activityName) {
  try {
    const raw = await client.workflowService.describeWorkflowExecution({
      namespace: 'default',
      execution: { workflowId },
    });
    return (
      (raw.pendingActivities || []).find(
        (activity) => activity.activityType?.name === activityName
      ) || null
    );
  } catch {
    return null;
  }
}

/**
 * The server's own record of a timed-out activity: which timeout fired, and
 * whether the failure carried heartbeat details. This is the evidence the
 * workflow's classification is based on.
 */
async function timedOutActivity(client, workflowId, activityName) {
  try {
    const history = await client.workflow.getHandle(workflowId).fetchHistory();
    const events = history.events || [];
    const scheduledNames = new Map();
    for (const event of events) {
      const scheduled = event.activityTaskScheduledEventAttributes;
      if (scheduled) {
        scheduledNames.set(String(event.eventId), scheduled.activityType?.name);
      }
    }
    for (const event of events) {
      const attributes = event.activityTaskTimedOutEventAttributes;
      if (!attributes) continue;
      // The timed-out event has no activityType: it names the scheduled event.
      const name = scheduledNames.get(String(attributes.scheduledEventId));
      if (name !== activityName) continue;
      const info = attributes.failure?.timeoutFailureInfo;
      return {
        eventId: String(event.eventId),
        activity: name,
        attempt: attributes.attempt,
        timeoutType: attributes.timeoutType ?? info?.timeoutType,
        heartbeatPayloads: info?.lastHeartbeatDetails?.payloads?.length ?? 0,
        failureMessage: attributes.failure?.message ?? null,
      };
    }
    return null;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Every activity/workflow-task event for one execution, compacted. Used when
 * the expected timeout event is missing: it shows what the server actually
 * recorded for the killed activity.
 */
async function activityTimeline(client, workflowId) {
  try {
    const history = await client.workflow.getHandle(workflowId).fetchHistory();
    const events = history.events || [];
    const scheduledNames = new Map();
    for (const event of events) {
      const scheduled = event.activityTaskScheduledEventAttributes;
      if (scheduled) {
        scheduledNames.set(String(event.eventId), scheduled.activityType?.name);
      }
    }
    const nameOf = (attributes) =>
      scheduledNames.get(String(attributes?.scheduledEventId)) ||
      attributes?.activityType?.name ||
      null;
    const timeline = [];
    for (const event of events) {
      const id = String(event.eventId);
      if (event.activityTaskScheduledEventAttributes) {
        const a = event.activityTaskScheduledEventAttributes;
        timeline.push({ event: id, kind: 'activityTaskScheduled', activity: a.activityType?.name });
      } else if (event.activityTaskStartedEventAttributes) {
        timeline.push({ event: id, kind: 'activityTaskStarted', activity: nameOf(event.activityTaskStartedEventAttributes) });
      } else if (event.activityTaskCompletedEventAttributes) {
        timeline.push({ event: id, kind: 'activityTaskCompleted', activity: nameOf(event.activityTaskCompletedEventAttributes) });
      } else if (event.activityTaskFailedEventAttributes) {
        const a = event.activityTaskFailedEventAttributes;
        timeline.push({
          event: id,
          kind: 'activityTaskFailed',
          activity: nameOf(a),
          attempt: a.attempt,
          message: a.failure?.message?.slice(0, 80),
        });
      } else if (event.activityTaskTimedOutEventAttributes) {
        const a = event.activityTaskTimedOutEventAttributes;
        const info = a.failure?.timeoutFailureInfo;
        timeline.push({
          event: id,
          kind: 'activityTaskTimedOut',
          activity: nameOf(a),
          attempt: a.attempt,
          timeoutType: a.timeoutType ?? info?.timeoutType,
          heartbeatPayloads: info?.lastHeartbeatDetails?.payloads?.length ?? 0,
          message: a.failure?.message?.slice(0, 80),
        });
      } else if (event.timerStartedEventAttributes) {
        timeline.push({ event: id, kind: 'timerStarted' });
      } else if (event.timerFiredEventAttributes) {
        timeline.push({ event: id, kind: 'timerFired' });
      } else if (event.workflowTaskFailedEventAttributes) {
        timeline.push({
          event: id,
          kind: 'workflowTaskFailed',
          message: event.workflowTaskFailedEventAttributes.failure?.message?.slice(0, 120),
        });
      }
    }
    return timeline;
  } catch (err) {
    return [{ error: err.message }];
  }
}

async function scheduledCount(client, workflowId, activityName) {
  try {
    const history = await client.workflow.getHandle(workflowId).fetchHistory();
    return (history.events || []).filter(
      (event) => event.activityTaskScheduledEventAttributes?.activityType?.name === activityName
    ).length;
  } catch {
    return -1;
  }
}

/** The arguments a run was started with (first history event). */
async function runInput(client, workflowId, runId) {
  const history = await client.workflow.getHandle(workflowId, runId).fetchHistory();
  const started = (history.events || []).find(
    (item) => item.workflowExecutionStartedEventAttributes
  );
  const payloads =
    started?.workflowExecutionStartedEventAttributes?.input?.payloads || [];
  return {
    payloadCount: payloads.length,
    input: payloads.map((payload) => {
      try {
        return JSON.parse(Buffer.from(payload.data, 'base64').toString('utf8'));
      } catch {
        return '<undecodable>';
      }
    }),
  };
}

export const scenarios = [
  // -------------------------------------------------------------------------
  // 1. Unknown results: the platform accepted, the worker died.
  // -------------------------------------------------------------------------
  {
    id: 'worker-death-unknown-results',
    clock: 'real',
    group: 'publish-faults',
    description:
      'The worker is SIGKILLed with three mutations in flight: finalizePost after a heartbeat (details present), postComment after a heartbeat, and postSocialPending before its first heartbeat. Afterwards the outcomes are compared with what the platform and Temporal actually recorded.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      clearFaults();

      // --- finalize dies with heartbeat details ---------------------------
      const finalizeOrg = await seedOrganization(prisma, { uploadDirectory });
      const finalizePostRow = await seedStalePost(prisma, {
        organization: finalizeOrg.organization,
        integration: finalizeOrg.integration,
        media: finalizeOrg.media,
        publishDate: iso(1000),
        content: 'Synthetic post killed during finalize',
      });
      armFaults({ finalizePost: 'hang' });
      await startV112(context, {
        postId: finalizePostRow.id,
        organizationId: finalizeOrg.organization.id,
      });
      await waitFor(
        () => methodFor(calls, 'postPending', finalizePostRow.id).length >= 1,
        { label: 'postPending accepted before finalize' }
      );
      await waitFor(() => methodFor(calls, 'finalizePost').length >= 1, {
        label: 'finalizePost entered and hung',
      });
      const finalizeFaultAt = Date.now();
      clearFaults();
      // Wait until the server holds a heartbeat for this activity: that detail
      // is what the timeout failure will carry, so the scenario is not guessing
      // at the 15s sender interval.
      const finalizePending = await waitFor(
        async () => {
          const pending = await pendingActivity(
            temporal.client,
            `post_${finalizePostRow.id}`,
            'finalizePost'
          );
          return pending?.heartbeatDetails?.payloads?.length ? pending : null;
        },
        { label: 'finalize heartbeat details on the server', timeoutMs: 90_000 }
      );
      observe('finalize heartbeat details before the kill', {
        payloads: finalizePending.heartbeatDetails.payloads.length,
        firstHeartbeatAfterMs: Date.now() - finalizeFaultAt,
      });
      observe('finalize hung after the platform accepted', {
        postId: finalizePostRow.id,
      });

      // --- comment dies with heartbeat details ----------------------------
      armFaults({ comment: 'hang' });
      const commentOrg = await seedOrganization(prisma, { uploadDirectory });
      const thread = await seedCommentThread(prisma, {
        organization: commentOrg.organization,
        integration: commentOrg.integration,
        media: commentOrg.media,
        publishDate: iso(1000),
        rootContent: 'Synthetic root that publishes',
        commentContent: 'Synthetic comment killed mid-flight',
        delayMinutes: 0,
      });
      await startV112(context, {
        postId: thread.root.id,
        organizationId: commentOrg.organization.id,
      });
      await waitFor(() => methodFor(calls, 'comment').length >= 1, {
        label: 'comment entered and hung',
      });
      clearFaults();
      const commentPending = await waitFor(
        async () => {
          const pending = await pendingActivity(
            temporal.client,
            `post_${thread.root.id}`,
            'postComment'
          );
          return pending?.heartbeatDetails?.payloads?.length ? pending : null;
        },
        { label: 'comment heartbeat details on the server', timeoutMs: 90_000 }
      );
      observe('comment heartbeat details before the kill', {
        payloads: commentPending.heartbeatDetails.payloads.length,
      });

      // --- publish dies before the first heartbeat ------------------------
      const pendingOrg = await seedOrganization(prisma, { uploadDirectory });
      const pendingPostRow = await seedStalePost(prisma, {
        organization: pendingOrg.organization,
        integration: pendingOrg.integration,
        media: pendingOrg.media,
        publishDate: iso(1000),
        content: 'Synthetic post accepted then killed before heartbeat',
      });
      armFaults({ postPending: 'hang' });
      await startV112(context, {
        postId: pendingPostRow.id,
        organizationId: pendingOrg.organization.id,
      });
      await waitFor(
        () => methodFor(calls, 'postPending', pendingPostRow.id).length >= 1,
        { label: 'postPending accepted before the kill' }
      );
      // The publish must still be inside its first heartbeat interval.
      const pendingPending = await pendingActivity(
        temporal.client,
        `post_${pendingPostRow.id}`,
        'postSocialPending'
      );
      observe('publish heartbeat details before the kill', {
        details: pendingPending?.heartbeatDetails ?? null,
      });
      expectTrue(
        'the publish has no heartbeat details yet',
        !pendingPending?.heartbeatDetails?.payloads?.length
      );
      // Kill well inside the first heartbeat interval.
      await sleep(700);
      const killedAt = Date.now();
      const killed = await killProcessGroup(context.orchestrator);
      expectTrue('worker process group was killed', killed);
      observe('worker killed with three mutations in flight', {
        finalize: finalizePostRow.id,
        comment: thread.comment.id,
        pending: pendingPostRow.id,
      });

      // A real pod is replaced, not resurrected: boot a fresh process and clear
      // every fault so the retried activities run the shipped code.
      clearFaults();
      await context.bootOrchestrator();

      // --- wait for the three killed activities to resolve ----------------
      const finalizeOutcome = await waitFor(
        async () => {
          const post = await snapshotPost(prisma, finalizePostRow.id);
          const scheduled = await scheduledCount(
            temporal.client,
            `post_${finalizePostRow.id}`,
            'finalizePost'
          );
          if (post?.state === 'ERROR' || scheduled >= 2) return { post, scheduled };
          return null;
        },
        { label: 'finalize outcome after the heartbeat timeout', timeoutMs: 4 * MINUTE }
      );
      const finalizeRow = finalizeOutcome.post;
      const finalizeTimeout = await timedOutActivity(
        temporal.client,
        `post_${finalizePostRow.id}`,
        'finalizePost'
      );
      observe('finalize result', finalizeRow);
      observe('finalize timeout failure', finalizeTimeout);
      observe('finalize attempts scheduled', finalizeOutcome.scheduled);
      observe(
        'finalize activity timeline',
        await activityTimeline(temporal.client, `post_${finalizePostRow.id}`)
      );
      expectEqual(
        'the timeout is a heartbeat timeout that carried details',
        {
          timeoutType: finalizeTimeout?.timeoutType ?? null,
          heartbeatPayloads: finalizeTimeout?.heartbeatPayloads ?? null,
        },
        { timeoutType: 4, heartbeatPayloads: 1 }
      );
      expectEqual(
        'finalize-with-details ends as the unconfirmed error state',
        finalizeRow.state,
        'ERROR'
      );
      expectEqual(
        'finalize published exactly once (never retried)',
        publishesFor(calls, finalizePostRow.id).length,
        1
      );
      expectEqual(
        'finalize was never run twice',
        finalizeOutcome.scheduled,
        1
      );
      const finalizeNotification = calls
        .read()
        .find(
          (call) =>
            call.method === 'newEmailWorkflow' &&
            String(call.subject).includes('couldn') &&
            call.to === finalizeOrg.user.email
        );
      expectTrue(
        'the user was told the post is unconfirmed',
        !!finalizeNotification,
        JSON.stringify(finalizeNotification)
      );
      const finalizeExecution = await waitCompleted(
        temporal.client,
        `post_${finalizePostRow.id}`
      );
      const finalizeHistory = await historySummary(
        temporal.client,
        finalizeExecution.workflowId,
        finalizeExecution.runId
      );
      observe('finalize execution after the kill', {
        status: finalizeExecution.status,
        activityScheduled: finalizeHistory.activityScheduled,
        eventCount: finalizeHistory.eventCount,
      });
      expectEqual('finalize workflow finished', finalizeExecution.status, 'COMPLETED');
      expectTrue(
        'history records the pending publish as done and the finalize once',
        finalizeHistory.activityScheduled.filter((a) => a.activity === 'postSocialPending').length === 1 &&
          finalizeHistory.activityScheduled.filter((a) => a.activity === 'finalizePost').length === 1,
        JSON.stringify(finalizeHistory.activityScheduled)
      );
      recordExecutionQueues(finalizeExecution, finalizeHistory);
      recordFault({
        id: 'accepted-then-worker-death-with-heartbeat',
        injection: 'finalizePost hung after the provider accepted the post; SIGKILL after 17s',
        platform: `postPending + finalizePost accepted once for ${finalizePostRow.id}`,
        temporal: 'heartbeat timeout with details -> timeout branch -> unconfirmed, never retried',
        local: `post ${finalizeRow.state}, error=${String(finalizeRow.error).slice(0, 80)}`,
        knowable: 'yes (heartbeat details prove the mutation started; Temporal shows one accepted publish)',
        classification: 'unknown',
        note:
          'The platform may have completed the finalize; the post is marked unconfirmed, not failed, and is not republished.',
      });

      // markUnconfirmed targets postsList[0]: the already-published root is the
      // row that is overwritten, while the timed-out comment keeps its QUEUE
      // state with no release id.
      const rootAfterComment = await waitFor(
        async () => {
          const value = await snapshotPost(prisma, thread.root.id);
          return value?.state === 'ERROR' ? value : null;
        },
        { label: 'root marked unconfirmed after the comment timeout', timeoutMs: 4 * MINUTE }
      );
      const commentTimeout = await timedOutActivity(
        temporal.client,
        `post_${thread.root.id}`,
        'postComment'
      );
      observe('comment timeout failure', commentTimeout);
      expectEqual(
        'the comment timeout also carried heartbeat details',
        {
          timeoutType: commentTimeout?.timeoutType ?? null,
          heartbeatPayloads: commentTimeout?.heartbeatPayloads ?? null,
        },
        { timeoutType: 4, heartbeatPayloads: 1 }
      );
      const commentRow = await snapshotPost(prisma, thread.comment.id);
      observe('comment result', commentRow);
      expectEqual(
        'the timed-out comment is left QUEUE with no local result',
        { state: commentRow.state, releaseId: commentRow.releaseId },
        { state: 'QUEUE', releaseId: null }
      );
      expectEqual(
        'the comment was sent to the platform exactly once',
        methodFor(calls, 'comment').length,
        1
      );
      const rootAfter = rootAfterComment;
      observe('root after the comment timeout', rootAfter);
      expectTrue(
        'the root had already been published',
        !!rootAfter.releaseId,
        JSON.stringify(rootAfter)
      );
      expectEqual(
        'the published root is overwritten with the unconfirmed error state',
        rootAfter.state,
        'ERROR'
      );
      recordFault({
        id: 'comment-accepted-then-worker-death-with-heartbeat',
        injection: 'postComment hung after the provider accepted the comment; SIGKILL after ~15s',
        platform: 'root published once, comment accepted once',
        temporal: 'heartbeat timeout with details -> timeout branch -> unconfirmed',
        local: 'comment stays QUEUE with no result; the published root is overwritten to ERROR',
        knowable: 'partly (Temporal proves the root published; the comment outcome is unknown)',
        classification: 'unknown',
        note:
          'markUnconfirmed targets postsList[0], so a timed-out comment also rewrites the already-published root as ERROR and leaves the comment row without a result. Recorded, not silently accepted.',
      });

      const pendingPublishes = await waitPublishCount(
        context,
        pendingPostRow.id,
        2,
        4 * MINUTE
      );
      observe(
        'publishes for the pre-heartbeat kill',
        pendingPublishes.map((call) => ({
          at: call.at,
          pendingData: call.pendingData,
        }))
      );
      expectEqual(
        'the accepted publish is repeated because no heartbeat details exist',
        pendingPublishes.length,
        2
      );
      expectTrue(
        'the two accepts happened in different worker processes',
        pendingPublishes[0].pid !== pendingPublishes[1].pid,
        `${pendingPublishes[0].pid} vs ${pendingPublishes[1].pid}`
      );
      const pendingTimeout = await timedOutActivity(
        temporal.client,
        `post_${pendingPostRow.id}`,
        'postSocialPending'
      );
      observe('pre-heartbeat publish timeout failure', pendingTimeout);
      observe(
        'pre-heartbeat publish timeline',
        await activityTimeline(temporal.client, `post_${pendingPostRow.id}`)
      );
      expectEqual(
        'the re-published case is a heartbeat timeout with no details',
        {
          timeoutType: pendingTimeout.timeoutType,
          heartbeatPayloads: pendingTimeout.heartbeatPayloads,
        },
        { timeoutType: 4, heartbeatPayloads: 0 }
      );
      const pendingRow = await waitPostState(
        context,
        pendingPostRow.id,
        'PUBLISHED',
        60_000
      );
      expectEqual('the retry writes one local result', pendingRow.state, 'PUBLISHED');
      expectEqual(
        'the retry finalized the second accept',
        channelCalls(calls, 'finalizePost', pendingOrg.integration.id).length,
        1
      );
      recordFault({
        id: 'accepted-then-worker-death-before-heartbeat',
        injection: 'postPending accepted then SIGKILL inside the 15s heartbeat interval',
        platform: `two accepted publishes for one post (${pendingPublishes
          .map((call) => call.pendingData?.id || call.pendingData)
          .join(', ')})`,
        temporal: 'heartbeat timeout without details -> classified never-started -> retried',
        local:
          'one PUBLISHED row pointing at the second accept; the first accept has no local record',
        knowable: 'no',
        classification: 'unknown',
        note:
          'GENUINE HAZARD: heartbeat absence is used as "never ran". An accept that returns and then loses the worker within 15s is re-published. Pre-existing upstream behaviour; the spec forbids building a global idempotency system, so this is recorded as a residual risk.',
      });

      context.state.killedAt = killedAt;
    },
  },

  // -------------------------------------------------------------------------
  // 2. checkPostStatus start-to-close timeout (no heartbeat channel at all).
  // -------------------------------------------------------------------------
  {
    id: 'check-status-timeout-unknown',
    clock: 'real',
    group: 'check-timeout',
    description:
      'checkPostStatus hangs into one real start-to-close timeout, then fails fast through the rest of the read-only error budget; the already-accepted post is classified as an unknown publish result, is never republished and never finalized, and the workflow ends.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      clearFaults();
      const org = await seedOrganization(prisma, { uploadDirectory });
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(1000),
        content: 'Synthetic post whose status check hangs',
      });
      armFaults({ checkPostStatus: 'hang' });
      await startV112(context, {
        postId: post.id,
        organizationId: org.organization.id,
      });
      // One real 2-minute start-to-close timeout is enough to exercise the
      // classification. The shipped policy then retries the read-only check
      // three times per invocation with a five-invocation error budget, so the
      // remaining attempts are failed fast to keep the rehearsal bounded; the
      // real schedule is recorded in the fault note.
      await waitFor(
        () => channelCalls(calls, 'checkPostStatus', org.integration.id).length >= 1,
        { label: 'first checkPostStatus attempt entered', timeoutMs: 60_000 }
      );
      armFaults({ checkPostStatus: 'fail' });
      const row = await waitPostState(context, post.id, 'ERROR', 12 * MINUTE);
      observe('post after the status-check timeout', row);
      expectEqual('the accepted post ends unconfirmed', row.state, 'ERROR');
      expectEqual(
        'the publish was never re-run by the check failure',
        publishesFor(calls, post.id).length,
        1
      );
      const timedOutChecks = channelCalls(
        calls,
        'checkPostStatus',
        org.integration.id
      ).length;
      const failedChecks = faultsFor(calls).filter(
        (call) => call.fault === 'checkPostStatus'
      ).length;
      observe('status-check attempts', { timedOutChecks, failedChecks });
      expectTrue(
        'the read-only check was retried more than once',
        timedOutChecks + failedChecks >= 3,
        JSON.stringify({ timedOutChecks, failedChecks })
      );
      expectEqual(
        'a timed-out check never finalizes',
        channelCalls(calls, 'finalizePost', org.integration.id).length,
        0
      );
      const execution = await waitCompleted(temporal.client, `post_${post.id}`);
      observe('check-timeout execution', execution);
      expectEqual('the workflow ended instead of republishing', execution.status, 'COMPLETED');
      recordFault({
        id: 'check-status-timeout-without-heartbeat-details',
        injection:
          'checkPostStatus hangs into a 2-minute start-to-close timeout, then fails fast for the rest of the error budget',
        platform: 'one accepted publish, no further mutation',
        temporal:
          'TimeoutFailure (START_TO_CLOSE, no details) -> bounded read-only retries -> unconfirmed',
        local: 'post ERROR/unconfirmed',
        knowable: 'yes (the publish call count stays one; only the status read is unknown)',
        classification: 'unknown',
        note:
          'checkPostStatus never heartbeats and its proxy has no heartbeatTimeout, so a with-details timeout cannot occur for it. The with-details case is exercised on finalizePost in worker-death-unknown-results. Shipped schedule: 3 attempts x 2-minute start-to-close per invocation, 5 invocations with a 20-second pause, so a persistently hanging check keeps the post QUEUE for roughly 30 minutes before it is marked unconfirmed (the sweep does not restart it because the execution still exists).',
      });
      clearFaults();
    },
  },

  // -------------------------------------------------------------------------
  // 3. Local write-back failures after the platform accepted.
  // -------------------------------------------------------------------------
  {
    id: 'db-writeback-fails-after-accept',
    clock: 'real',
    group: 'writeback-faults',
    description:
      'The platform accepts and returns a completed result, then the PUBLISHED write-back fails permanently: the post is recorded as unconfirmed instead of being republished, and only one platform call exists.',
    async run(context) {
      const { prisma, calls, uploadDirectory } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(500),
        content: 'Synthetic post whose DB write-back fails',
      });
      armFaults({ updatePost: 'fail' });
      await startV112(context, {
        postId: post.id,
        organizationId: org.organization.id,
      });
      const row = await waitPostState(context, post.id, 'ERROR', 120_000);
      observe('post after the failed write-back', row);
      expectTrue(
        'the unconfirmed error is stored',
        String(row.error).includes('updatePost'),
        String(row.error)
      );
      expectEqual(
        'the accepted post was not republished',
        publishesFor(calls, post.id).length,
        1
      );
      expectEqual(
        'one finalize only',
        channelCalls(calls, 'finalizePost', org.integration.id).length,
        1
      );
      const execution = await waitCompleted(context.temporal.client, `post_${post.id}`);
      expectEqual('workflow finished', execution.status, 'COMPLETED');
      recordFault({
        id: 'db-writeback-fails-after-accept',
        injection: 'PostsService.updatePost throws permanently after the provider completed',
        platform: 'one accepted+finalized publish',
        temporal: 'activity failure after posted=true/updated=false -> markUnconfirmed',
        local: `post ${row.state} with the write-back error, no releaseId`,
        knowable: 'yes (Temporal shows the publish completed; the row says unconfirmed)',
        classification: 'unknown',
        note:
          'Shipped retry schedule for updatePost is 3 attempts / 2-minute backoff; injected as non-retryable to bound the rehearsal. The branch reached is the same.',
      });
      clearFaults();
    },
  },

  {
    id: 'total-writeback-loss-is-republished-by-the-sweep',
    clock: 'real',
    group: 'writeback-faults',
    description:
      'Both the PUBLISHED write and the ERROR write fail, so the row stays QUEUE while the platform holds a published post. The missing-posts sweep then re-publishes the same post: the pre-existing hazard of judging the platform by the local row.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      // The sweep only picks posts older than a moment and inside two days.
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(-5 * MINUTE),
        content: 'Synthetic post with total write-back loss',
      });
      armFaults({ updatePost: 'fail', changeState: 'fail' });
      await startV112(context, {
        postId: post.id,
        organizationId: org.organization.id,
      });
      await waitPublishCount(context, post.id, 1, 120_000);
      await waitFor(
        async () => {
          const execution = await describeWorkflow(temporal.client, `post_${post.id}`);
          return execution.status === 'COMPLETED' ? execution : null;
        },
        { label: 'workflow finished with the row left QUEUE' }
      );
      const untouched = await snapshotPost(prisma, post.id);
      observe('row after both writes failed', untouched);
      expectEqual('the row is still QUEUE', untouched.state, 'QUEUE');
      expectEqual('no local release id', untouched.releaseId, null);
      clearFaults();

      // The sweep is the shipped compensation for a QUEUE row.
      const sweep = await temporal.client.workflow.start('missingPostWorkflow', {
        workflowId: `missing_post_${org.organization.id}`,
        taskQueue: 'main',
        args: [],
      });
      const republished = await waitPublishCount(context, post.id, 2, 120_000);
      observe(
        'publishes after the sweep',
        republished.map((call) => ({ at: call.at, pendingData: call.pendingData }))
      );
      expectEqual(
        'the sweep republishes a post the platform already accepted',
        republished.length,
        2
      );
      const finalRow = await waitPostState(context, post.id, 'PUBLISHED', 60_000);
      expectTrue('the second publish is written back', !!finalRow.releaseId);
      await temporal.client.workflow
        .getHandle(sweep.workflowId, sweep.firstExecutionRunId)
        .terminate('rehearsal finished with the sweep');
      recordFault({
        id: 'db-total-writeback-loss',
        injection: 'updatePost and changeState both fail after the provider completed',
        platform: 'two accepted publishes for the same post',
        temporal: 'first workflow completed with the row untouched; the sweep started a second run',
        local: 'QUEUE row -> sweep -> second publish -> PUBLISHED',
        knowable: 'no from the database (it said QUEUE); only the platform substitution shows the duplicate',
        classification: 'unknown',
        note:
          'GENUINE HAZARD, pre-existing: a total write-back outage makes the local row indistinguishable from "not published", and the missing-posts sweep is a republish. Any recovery must reconcile the platform before re-running the sweep.',
      });
    },
  },

  {
    id: 'notification-writeback-fails',
    clock: 'real',
    group: 'writeback-faults',
    description:
      'The post publishes and is written back, then the success notification fails permanently: the workflow still completes with one publish and no duplicate, but the user is never told.',
    async run(context) {
      const { prisma, calls, uploadDirectory } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(500),
        content: 'Synthetic post whose notification fails',
      });
      armFaults({ inAppNotification: 'fail' });
      await startV112(context, {
        postId: post.id,
        organizationId: org.organization.id,
      });
      const row = await waitPostState(context, post.id, 'PUBLISHED', 120_000);
      observe('post after the notification failure', row);
      expectTrue('the release result was written', !!row.releaseId, String(row.releaseId));
      expectEqual(
        'the publish was not repeated',
        publishesFor(calls, post.id).length,
        1
      );
      const notifications = await prisma.notifications.count({
        where: { organizationId: org.organization.id },
      });
      expectEqual('no notification row exists', notifications, 0);
      expectEqual(
        'no e-mail was sent either',
        emails(calls).filter((mail) => mail.to === org.user.email).length,
        0
      );
      const execution = await waitCompleted(context.temporal.client, `post_${post.id}`);
      expectEqual('the workflow still completed', execution.status, 'COMPLETED');
      recordFault({
        id: 'notification-writeback-fails',
        injection: 'NotificationService.inAppNotification throws permanently after the publish',
        platform: 'one publish',
        temporal: 'webhook/plugs continue; workflow completed',
        local: 'post PUBLISHED with releaseId, no notification row, no e-mail',
        knowable: 'yes for the post, no for the user notification',
        classification: 'complete',
        note: 'A notification failure cannot duplicate or hide the post itself.',
      });
      clearFaults();
    },
  },

  {
    id: 'webhook-writeback-fails',
    clock: 'real',
    group: 'writeback-faults',
    description:
      'The seeded webhook target is unreachable (127.0.0.1:9); sendWebhooks swallows the failure, the workflow completes and the post is published once.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(500),
        content: 'Synthetic post whose webhook target is down',
      });
      await startV112(context, {
        postId: post.id,
        organizationId: org.organization.id,
      });
      const row = await waitPostState(context, post.id, 'PUBLISHED', 120_000);
      const execution = await waitFor(
        async () => {
          const value = await describeWorkflow(temporal.client, `post_${post.id}`);
          return value.status === 'COMPLETED' ? value : null;
        },
        { label: 'workflow completed despite the webhook target being down' }
      );
      const history = await historySummary(
        temporal.client,
        execution.workflowId,
        execution.runId
      );
      observe('webhook execution', {
        status: execution.status,
        sendWebhooks: activityOn(history, 'sendWebhooks'),
      });
      expectTrue('the release result was written', !!row.releaseId);
      expectEqual('one publish only', publishesFor(calls, post.id).length, 1);
      expectTrue(
        'the webhook activity was scheduled on main and completed',
        !!activityOn(history, 'sendWebhooks'),
        JSON.stringify(history.activityScheduled)
      );
      recordExecutionQueues(execution, history);
      recordFault({
        id: 'webhook-writeback-fails',
        injection: 'webhook URL 127.0.0.1:9 (connection refused) after the publish',
        platform: 'one publish; no webhook HTTP call succeeded',
        temporal: 'activity completed (failure swallowed inside sendWebhooks)',
        local: 'post PUBLISHED',
        knowable: 'no for the webhook delivery (no receiver record); yes for the post',
        classification: 'complete',
        note: 'Webhook delivery is best-effort by design; losing it is invisible locally.',
      });
    },
  },

  // -------------------------------------------------------------------------
  // 4. Refresh: failure sets refreshNeeded once, no retry storm.
  // -------------------------------------------------------------------------
  {
    id: 'refresh-fails-no-retry-storm',
    clock: 'real',
    group: 'refresh-mail',
    description:
      'A provider token refresh fails; the channel is flagged refreshNeeded, the user is notified, and the workflow ends after one refresh call with no repeated attempts.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const integration = await seedRefreshChannel(prisma, {
        organization: org.organization,
        tokenExpiration: new Date(Date.now() + 2500),
      });
      armFaults({ refreshToken: 'fail' });
      const handle = await temporal.client.workflow.start('refreshTokenWorkflow', {
        workflowId: `refresh_${integration.id}`,
        taskQueue: 'main',
        args: [{ integrationId: integration.id, organizationId: org.organization.id }],
      });
      const row = await waitFor(
        async () => {
          const value = await prisma.integration.findUnique({
            where: { id: integration.id },
          });
          return value?.refreshNeeded ? value : null;
        },
        { label: 'channel flagged refreshNeeded', timeoutMs: 60_000 }
      );
      observe('channel after the failed refresh', {
        refreshNeeded: row.refreshNeeded,
        tokenUnchanged: row.token === integration.token,
      });
      expectEqual('the token is not replaced', row.token, integration.token);
      expectTrue(
        'the refresh failure is recorded on the channel',
        row.refreshNeeded === true
      );
      const refreshCalls = faultsFor(calls).filter(
        (call) => call.fault === 'refreshToken'
      );
      expectEqual('exactly one refresh attempt', refreshCalls.length, 1);
      const execution = await waitFor(
        async () => {
          const value = await describeWorkflow(temporal.client, `refresh_${integration.id}`);
          return value.status === 'COMPLETED' ? value : null;
        },
        { label: 'refresh workflow ended after the failure' }
      );
      expectEqual('the loop exits instead of retrying', execution.status, 'COMPLETED');
      expectTrue(
        'the user was notified',
        calls
          .read()
          .filter(
            (call) =>
              call.method === 'newEmailWorkflow' &&
              String(call.subject).includes('Could not refresh')
          ).length >= 1,
        JSON.stringify(emails(calls).map((mail) => mail.to))
      );
      recordFault({
        id: 'refresh-fails',
        injection: 'provider refreshToken throws',
        platform: 'no refreshed token',
        temporal: 'activity returns false (handled), workflow completes',
        local: 'integration.refreshNeeded=true, token unchanged, one notification',
        knowable: 'yes',
        classification: 'failed',
        note: 'No retry storm and no duplicate refresh workflow run.',
      });
      clearFaults();
    },
  },

  // -------------------------------------------------------------------------
  // 5. Mail: all attempts fail, offline queue, continue-as-new with a queue.
  // -------------------------------------------------------------------------
  {
    id: 'mail-all-attempts-fail',
    clock: 'real',
    group: 'refresh-mail',
    description:
      'The mail provider fails all three sendEmailSync attempts; the activity still reports success, so the per-email workflow completes and the message is silently lost.',
    async run(context) {
      const { calls, temporal } = context;
      clearFaults();
      armFaults({ email: 'fail' });
      const handle = await temporal.client.workflow.start('sendSingleEmailWorkflow', {
        workflowId: `send_email_fail_${Date.now().toString(36)}`,
        taskQueue: 'main',
        args: [
          {
            to: 'mail-fail@synthetic.invalid',
            subject: 'Synthetic mail that always fails',
            html: '<p>fail</p>',
            addTo: 'bottom',
          },
        ],
      });
      const execution = await waitFor(
        async () => {
          const value = await describeWorkflow(temporal.client, handle.workflowId);
          return value.status === 'COMPLETED' ? value : null;
        },
        { label: 'workflow completed after the mail failure', timeoutMs: 60_000 }
      );
      const attempts = faultsFor(calls).filter((call) => call.fault === 'email');
      observe('mail attempts', attempts.length);
      expectEqual('exactly three provider attempts', attempts.length, 3);
      expectEqual(
        'no message was delivered',
        emails(calls).filter((mail) => mail.to === 'mail-fail@synthetic.invalid').length,
        0
      );
      expectEqual('the workflow still completed', execution.status, 'COMPLETED');
      recordFault({
        id: 'mail-three-attempts-fail',
        injection: 'mail provider throws on every call',
        platform: 'three failed attempts, zero deliveries',
        temporal: 'activity succeeded after swallowing the failure; no Temporal retry',
        local: 'no delivery record, no error row',
        knowable: 'no (the local system records success)',
        classification: 'failed',
        note:
          'sendEmailSync swallows the failure after three attempts, so the workflow cannot retry. Pre-existing behaviour; recorded as a delivery gap, not a duplicate hazard.',
      });
      clearFaults();
    },
  },

  {
    id: 'mail-worker-offline-queue',
    clock: 'real',
    group: 'refresh-mail',
    description:
      'The e-mail workflow is started while every worker is down; nothing is delivered until the candidate returns, then the message is delivered exactly once.',
    async run(context) {
      const { calls, temporal } = context;
      clearFaults();
      await context.stopOrchestrator();
      const handle = await temporal.client.workflow.start('sendSingleEmailWorkflow', {
        workflowId: `send_email_offline_${Date.now().toString(36)}`,
        taskQueue: 'main',
        args: [
          {
            to: 'mail-offline@synthetic.invalid',
            subject: 'Synthetic mail queued while offline',
            html: '<p>offline</p>',
            addTo: 'bottom',
          },
        ],
      });
      await sleep(3000);
      expectEqual(
        'nothing is delivered while the workers are down',
        emails(calls).filter((mail) => mail.to === 'mail-offline@synthetic.invalid').length,
        0
      );
      await context.bootOrchestrator();
      const delivered = await waitFor(
        async () => {
          const list = emails(calls).filter(
            (mail) => mail.to === 'mail-offline@synthetic.invalid'
          );
          return list.length ? list : null;
        },
        { label: 'queued mail delivered after the worker returns', timeoutMs: 60_000 }
      );
      expectEqual('delivered exactly once', delivered.length, 1);
      const execution = await waitCompleted(temporal.client, handle.workflowId);
      expectEqual('the workflow completed', execution.status, 'COMPLETED');
      recordFault({
        id: 'mail-offline-queue',
        injection: 'all workers stopped before the per-email workflow was started',
        platform: 'delivery only after the worker returned',
        temporal: 'activity task waited durably; exactly one execution',
        local: 'one delivery record',
        knowable: 'yes',
        classification: 'complete',
      });
    },
  },

  {
    id: 'legacy-mail-continue-as-new-non-empty-queue',
    clock: 'real',
    group: 'refresh-mail',
    description:
      'The legacy send_email singleton processes 30 messages, continues as new while its queue still holds two, and the successor delivers them exactly once with the same workflow id and type.',
    async run(context) {
      const { calls, temporal } = context;
      clearFaults();
      const backlog = await temporal.client.workflow.start('sendEmailWorkflow', {
        workflowId: 'send_email',
        taskQueue: 'main',
        args: [{ queue: [] }],
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
      const total = 32;
      for (let index = 0; index < total; index++) {
        await backlog.signal('sendEmail', {
          to: `legacy-can-${index}@synthetic.invalid`,
          subject: `Synthetic legacy CAN ${index}`,
          html: `<p>${index}</p>`,
          addTo: 'bottom',
        });
      }
      const delivered = await waitFor(
        async () => {
          const list = emails(calls).filter((mail) =>
            String(mail.to).startsWith('legacy-can-')
          );
          return list.length >= total ? list : null;
        },
        { label: `${total} legacy e-mails`, timeoutMs: 180_000, intervalMs: 1000 }
      );
      expectEqual('every message is delivered', delivered.length, total);
      expectEqual(
        'no message is delivered twice',
        new Set(delivered.map((mail) => mail.to)).size,
        total
      );
      const firstRun = await describeWorkflow(
        temporal.client,
        backlog.workflowId,
        backlog.firstExecutionRunId
      );
      expectEqual('the singleton continued as new', firstRun.status, 'CONTINUED_AS_NEW');
      const successor = await waitFor(
        async () => {
          const value = await describeWorkflow(temporal.client, backlog.workflowId);
          return value.runId && value.runId !== backlog.firstExecutionRunId
            ? value
            : null;
        },
        { label: 'successor run' }
      );
      const successorInput = await runInput(
        temporal.client,
        backlog.workflowId,
        successor.runId
      );
      const remaining = successorInput.input?.[0]?.queue?.length ?? -1;
      observe('successor start input', {
        payloadCount: successorInput.payloadCount,
        remaining,
      });
      expectEqual('the successor carries the two remaining messages', remaining, 2);
      expectEqual('same workflow id', successor.workflowId, 'send_email');
      expectEqual('same workflow type', successor.type, 'sendEmailWorkflow');
      const firstHistory = await historySummary(
        temporal.client,
        backlog.workflowId,
        backlog.firstExecutionRunId
      );
      expectEqual(
        'the first run stopped after 30 sends',
        firstHistory.activityScheduled.filter((a) => a.activity === 'sendEmail').length,
        30
      );
      recordExecutionQueues(firstRun, firstHistory);
      recordFault({
        id: 'legacy-mail-continue-as-new-non-empty',
        injection: '32 signals; continue-as-new after 30 processed',
        platform: '32 deliveries, no duplicates',
        temporal: 'CONTINUED_AS_NEW with the remaining queue in the input payload',
        local: 'send_email id/type unchanged',
        knowable: 'yes (the successor input carries exactly the unprocessed messages)',
        classification: 'complete',
      });
      await temporal.client.workflow
        .getHandle(backlog.workflowId)
        .terminate('rehearsal finished with the legacy backlog');
    },
  },

  // -------------------------------------------------------------------------
  // 6. Maintenance continue-as-new after a worker restart mid-life.
  // -------------------------------------------------------------------------
  {
    id: 'maintenance-continue-as-new-after-restart',
    clock: 'skip',
    group: 'maintenance',
    description:
      'missingPostWorkflow publishes one genuinely stale post, the worker restarts while the workflow is in its hourly loop, and at the 24-loop boundary it continues as new with the same id and type; the stale post is not republished.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      clearFaults();
      const org = await seedOrganization(prisma, { uploadDirectory });
      const stale = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(-5 * 60_000),
        content: 'Synthetic post found by the maintenance sweep',
      });
      const handle = await temporal.client.workflow.start('missingPostWorkflow', {
        workflowId: 'missing-post-workflow',
        taskQueue: 'main',
        args: [],
      });
      await waitPublishCount(context, stale.id, 1, 120_000);
      const firstRow = await waitPostState(context, stale.id, 'PUBLISHED', 60_000);
      observe('stale post after the first sweep', firstRow);

      await context.rollingRestartOrchestrator();
      observe('worker replaced while the maintenance workflow sleeps', true);
      await temporal.env.sleep(25 * HOUR);

      const completed = await waitFor(
        async () => {
          const value = await describeWorkflow(
            temporal.client,
            handle.workflowId,
            handle.firstExecutionRunId
          );
          if (value.status !== 'CONTINUED_AS_NEW') return null;
          const history = await historySummary(
            temporal.client,
            handle.workflowId,
            handle.firstExecutionRunId
          );
          return history.continuedAsNew ? { value, history } : null;
        },
        { label: 'maintenance continue-as-new', timeoutMs: 120_000 }
      );
      observe('maintenance first run', {
        eventCount: completed.history.eventCount,
        continuedAsNew: completed.history.continuedAsNew,
        sweeps: completed.history.activityScheduled.filter(
          (activity) => activity.activity === 'searchForMissingThreeHoursPosts'
        ).length,
      });
      expectEqual('continued as new once', completed.history.continuedAsNew, 1);
      const successor = await waitFor(
        async () => {
          const value = await describeWorkflow(temporal.client, handle.workflowId);
          return value.runId && value.runId !== handle.firstExecutionRunId
            ? value
            : null;
        },
        { label: 'maintenance successor' }
      );
      expectEqual('workflow id unchanged', successor.workflowId, 'missing-post-workflow');
      expectEqual('workflow type unchanged', successor.type, 'missingPostWorkflow');
      expectEqual(
        'the successor runs the immediate sweep first',
        !!(
          await waitFor(
            async () => {
              const summary = await historySummary(
                temporal.client,
                successor.workflowId,
                successor.runId
              );
              return summary.activityScheduled.some(
                (activity) => activity.activity === 'searchForMissingThreeHoursPosts'
              )
                ? summary
                : null;
            },
            { label: 'successor immediate sweep', timeoutMs: 60_000 }
          )
        ),
        true
      );
      expectEqual(
        'the stale post is not republished by the successor',
        publishesFor(calls, stale.id).length,
        1
      );
      recordExecutionQueues(completed.value, completed.history);
      recordFault({
        id: 'maintenance-continue-as-new-after-restart',
        injection: 'worker restart mid-life; 24-loop continue-as-new',
        platform: 'one publish for the stale post',
        temporal: `${completed.history.eventCount} events before continue-as-new; same id/type`,
        local: 'publication row unchanged',
        knowable: 'yes',
        classification: 'complete',
        note:
          'Measured ~11 events/loop: the 24-loop gate fires at ~270 events, so the historyLength > 1000 clause cannot fire first in this release. It is a guard for a different cadence, not an exercised boundary.',
      });
      await temporal.client.workflow
        .getHandle(handle.workflowId)
        .terminate('rehearsal finished with the maintenance successor');
    },
  },

  // -------------------------------------------------------------------------
  // 7. Compatible rollback: old and new types, provider queue, missing
  //    @ActivityMethod() annotation.
  // -------------------------------------------------------------------------
  {
    id: 'compatible-rollback-covers-old-and-new',
    clock: 'real',
    group: 'rollback',
    description:
      'One candidate bundle runs an old V102 execution and a new V112 execution with unchanged type/id/queue/business ids; a provider-queue execution is skipped until COMPAT_WORKFLOW_QUEUES names its queue; an undecorated activity leaves the workflow stuck instead of half-running.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      clearFaults();

      const oldOrg = await seedOrganization(prisma, { uploadDirectory });
      const oldPost = await seedStalePost(prisma, {
        organization: oldOrg.organization,
        integration: oldOrg.integration,
        media: oldOrg.media,
        publishDate: iso(500),
        content: 'Synthetic old workflow after rollback',
      });
      const oldHandle = await temporal.client.workflow.start('postWorkflowV102', {
        workflowId: `post_${oldPost.id}`,
        taskQueue: 'main',
        args: [
          {
            taskQueue: 'bluesky',
            postId: oldPost.id,
            organizationId: oldOrg.organization.id,
          },
        ],
        searchAttributes: {
          postId: [oldPost.id],
          organizationId: [oldOrg.organization.id],
        },
      });

      const newOrg = await seedOrganization(prisma, { uploadDirectory });
      const newPost = await seedStalePost(prisma, {
        organization: newOrg.organization,
        integration: newOrg.integration,
        media: newOrg.media,
        publishDate: iso(500),
        content: 'Synthetic new workflow after rollback',
      });
      await startV112(context, {
        postId: newPost.id,
        organizationId: newOrg.organization.id,
      });

      const oldRow = await waitPostState(context, oldPost.id, 'PUBLISHED', 120_000);
      const newRow = await waitPostState(context, newPost.id, 'PUBLISHED', 120_000);
      observe('both generations published', {
        old: { state: oldRow.state, releaseId: oldRow.releaseId },
        new: { state: newRow.state, releaseId: newRow.releaseId },
      });
      const oldDescription = await describeWorkflow(temporal.client, oldHandle.workflowId);
      const newDescription = await describeWorkflow(temporal.client, `post_${newPost.id}`);
      expectEqual('old type kept', oldDescription.type, 'postWorkflowV102');
      expectEqual('new type kept', newDescription.type, 'postWorkflowV112');
      expectEqual('old queue kept', oldDescription.taskQueue, 'main');
      expectEqual('new queue kept', newDescription.taskQueue, 'main');
      expectEqual('old business id kept', oldDescription.searchAttributes.postId, oldPost.id);
      expectEqual('new business id kept', newDescription.searchAttributes.postId, newPost.id);
      expectEqual(
        'old contract used the blocking publish',
        publishesFor(calls, oldPost.id)[0].method,
        'post'
      );
      expectEqual(
        'new contract used pending/finalize',
        publishesFor(calls, newPost.id)[0].method,
        'postPending'
      );
      const oldHistory = await historySummary(
        temporal.client,
        oldDescription.workflowId,
        oldDescription.runId
      );
      const newHistory = await historySummary(
        temporal.client,
        newDescription.workflowId,
        newDescription.runId
      );
      expectEqual(
        'old activity stays on the provider queue',
        activityOn(oldHistory, 'postSocial').taskQueue,
        'bluesky'
      );
      expectEqual(
        'new mutation stays on the provider queue',
        activityOn(newHistory, 'postSocialPending').taskQueue,
        'bluesky'
      );
      recordExecutionQueues(oldDescription, oldHistory);
      recordExecutionQueues(newDescription, newHistory);

      // Provider-queue workflow without the compatibility opt-in.
      const providerOrg = await seedOrganization(prisma, { uploadDirectory });
      const providerPost = await seedStalePost(prisma, {
        organization: providerOrg.organization,
        integration: providerOrg.integration,
        media: providerOrg.media,
        publishDate: iso(500),
        content: 'Synthetic old provider-queue execution',
      });
      const providerHandle = await temporal.client.workflow.start('postWorkflowV102', {
        workflowId: `post_${providerPost.id}`,
        taskQueue: 'bluesky',
        args: [
          {
            taskQueue: 'bluesky',
            postId: providerPost.id,
            organizationId: providerOrg.organization.id,
          },
        ],
      });
      await sleep(4000);
      const untouched = await describeWorkflow(
        temporal.client,
        providerHandle.workflowId,
        providerHandle.firstExecutionRunId
      );
      expectEqual(
        'provider workers are activity-only by default',
        untouched.status,
        'RUNNING'
      );
      expectEqual(
        'no activity is scheduled without a workflow worker',
        (await historySummary(temporal.client, providerHandle.workflowId, providerHandle.firstExecutionRunId))
          .activityScheduled.length,
        0
      );
      expectEqual(
        'nothing was published',
        publishesFor(calls, providerPost.id).length,
        0
      );
      await context.stopOrchestrator();
      await context.bootOrchestrator({ COMPAT_WORKFLOW_QUEUES: 'bluesky' });
      const providerRow = await waitPostState(context, providerPost.id, 'PUBLISHED', 120_000);
      observe('provider-queue execution after the opt-in', providerRow);
      expectEqual('the compatible worker publishes it once', publishesFor(calls, providerPost.id).length, 1);
      const providerDescription = await waitCompleted(
        temporal.client,
        providerHandle.workflowId
      );
      expectEqual('provider-queue type unchanged', providerDescription.type, 'postWorkflowV102');
      expectEqual('provider-queue queue unchanged', providerDescription.taskQueue, 'bluesky');
      expectEqual('provider-queue execution completed', providerDescription.status, 'COMPLETED');

      // A worker whose activity set is missing refreshToken (what an
      // undecorated @ActivityMethod() produces): the execution is taken over,
      // the workflow task fails, and no mutation runs.
      await context.stopOrchestrator();
      const dropOrg = await seedOrganization(prisma, { uploadDirectory });
      const dropIntegration = await seedRefreshChannel(prisma, {
        organization: dropOrg.organization,
        tokenExpiration: new Date(Date.now() + 5000),
      });
      const probe = await startIncompleteRefreshWorker({
        address: temporal.address,
        prisma,
      });
      context.defer(() => probe.stop());
      const refreshCallsBefore = calls
        .read()
        .filter((call) => call.method === 'refreshToken').length;
      const dropHandle = await temporal.client.workflow.start('refreshTokenWorkflow', {
        workflowId: `refresh_${dropIntegration.id}`,
        taskQueue: 'main',
        args: [
          { integrationId: dropIntegration.id, organizationId: dropOrg.organization.id },
        ],
      });
      const scheduledTimeline = await waitFor(
        async () => {
          const timeline = await activityTimeline(
            temporal.client,
            dropHandle.workflowId
          );
          return timeline.some(
            (event) => event.kind === 'activityTaskScheduled' && event.activity === 'refreshToken'
          )
            ? timeline
            : null;
        },
        { label: 'refreshToken scheduled on the incomplete worker', timeoutMs: 90_000 }
      );
      await sleep(4000);
      const blockedTimeline = await activityTimeline(
        temporal.client,
        dropHandle.workflowId
      );
      observe('incomplete-worker timeline', blockedTimeline.slice(-6));
      expectTrue(
        'the missing activity is scheduled but never starts or completes',
        !blockedTimeline.some(
          (event) =>
            event.activity === 'refreshToken' &&
            ['activityTaskStarted', 'activityTaskCompleted', 'activityTaskFailed'].includes(
              event.kind
            )
        ),
        JSON.stringify(blockedTimeline.slice(-6))
      );
      const stuck = await describeWorkflow(temporal.client, dropHandle.workflowId);
      const stuckRow = await prisma.integration.findUnique({
        where: { id: dropIntegration.id },
      });
      const refreshCallsAfter = calls
        .read()
        .filter((call) => call.method === 'refreshToken').length;
      expectEqual('the execution stays running', stuck.status, 'RUNNING');
      expectEqual('the token was not refreshed', stuckRow.token, dropIntegration.token);
      expectEqual('no refresh call was made', refreshCallsAfter, refreshCallsBefore);
      expectTrue(
        'the worker names the unregistered activity',
        probe.logs.some((line) => /not registered/i.test(line)),
        JSON.stringify(probe.logs.slice(0, 1))
      );
      recordFault({
        id: 'activity-method-annotation-missing',
        injection: 'worker registers the compiled bundle without the refreshToken activity',
        platform: 'no refresh performed',
        temporal: 'the activity task stays scheduled; execution RUNNING (no half-run)',
        local: 'channel untouched',
        knowable: 'yes (the worker names the unregistered activity; the execution is still there)',
        classification: 'failed',
        note:
          'A rollback candidate must be assembled from the annotated activity classes. A missing registration blocks instead of silently skipping the mutation, and it does not resume instantly when the annotated worker starts: the pending activity task stays leased until its start-to-close timeout (10 min, up to 3 attempts), so recovery must wait or explicitly re-drive the execution.',
      });

      // The annotated candidate is required; the stuck execution itself is not
      // re-driven here (its activity task would only be re-dispatched after the
      // 10-minute start-to-close). Stop the probe and clean the execution up.
      await probe.stop();
      await temporal.client.workflow
        .getHandle(dropHandle.workflowId)
        .terminate('rehearsal finished: execution blocked on an unregistered activity');
    },
  },

  // -------------------------------------------------------------------------
  // 8. Coordinated database + media recovery and Temporal correlation.
  // -------------------------------------------------------------------------
  {
    id: 'sync-failure-and-no-new-writes',
    clock: 'real',
    group: 'recovery',
    description:
      'A schema sync against an unreachable database fails non-zero and leaves rows, columns, indexes and media untouched; no execution exists, so there is nothing to compensate; the same command then succeeds with the data intact.',
    async run(context) {
      const { prisma, uploadDirectory, postgres, temporal } = context;
      clearFaults();
      const org = await seedOrganization(prisma, { uploadDirectory });
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(-1 * HOUR),
        content: 'Synthetic pre-upgrade row retained across a failed sync',
      });
      const before = {
        business: await businessSnapshot(prisma, [org.organization.id]),
        schema: await schemaSnapshot(prisma),
        media: digestTree(uploadDirectory),
      };
      observe('snapshot before the failed sync', {
        tables: before.schema.tables,
        columns: before.schema.columns,
        indexes: before.schema.indexes,
        businessDigest: before.business.digest.slice(0, 16),
      });

      let failure = null;
      try {
        execFileSync('pnpm', ['run', 'prisma-db-push', '--skip-generate'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            DATABASE_URL: 'postgresql://postgres:postiz@127.0.0.1:1/postiz',
          },
          stdio: 'pipe',
        });
      } catch (err) {
        failure = {
          status: err.status ?? null,
          message: String(err.stderr || err.message).slice(0, 200),
        };
      }
      observe('failed sync', failure);
      expectTrue('the sync exits non-zero', failure && failure.status !== 0, JSON.stringify(failure));

      const afterFailure = {
        business: await businessSnapshot(prisma, [org.organization.id]),
        schema: await schemaSnapshot(prisma),
        media: digestTree(uploadDirectory),
      };
      expectEqual(
        'the failed sync changed no rows',
        afterFailure.business.digest,
        before.business.digest
      );
      expectEqual(
        'the failed sync changed no column or index',
        afterFailure.schema.digest,
        before.schema.digest
      );
      expectEqual(
        'the failed sync changed no media file',
        afterFailure.media,
        before.media
      );
      expectEqual(
        'no new execution was produced',
        (await describeWorkflow(temporal.client, `post_${post.id}`)).error !== undefined,
        true
      );

      // Retry the same command against the real database: schema and data are
      // already current, so the second sync succeeds without touching rows.
      postgres.push();
      const afterRetry = {
        business: await businessSnapshot(prisma, [org.organization.id]),
        schema: await schemaSnapshot(prisma),
        media: digestTree(uploadDirectory),
      };
      expectEqual(
        'the retried sync keeps the rows',
        afterRetry.business.digest,
        before.business.digest
      );
      expectEqual(
        'the retried sync keeps the schema',
        afterRetry.schema.digest,
        before.schema.digest
      );
      recordFault({
        id: 'sync-failure-no-new-writes',
        injection: 'prisma db push against 127.0.0.1:1, then against the real database',
        platform: 'n/a',
        temporal: 'no execution created; nothing to resume',
        local: 'rows, schema and media identical before/after; retry succeeds',
        knowable: 'yes (the failed sync is non-zero and every digest still matches)',
        classification: 'failed',
        note:
          'A failed sync does not prove the schema is unchanged; this run keeps the snapshot and shows no change for this input. A partial change must be inspected from the retained error and structure, not assumed absent.',
      });
    },
  },

  {
    id: 'coordinated-db-media-temporal-recovery',
    clock: 'real',
    group: 'recovery',
    needsBackend: true,
    description:
      'A quiesced database dump and media copy are taken, new external effects and new rows are produced, then both are restored together; identifiers, column digests and files are re-compared while Temporal keeps the executions and the platform keeps its side effects.',
    async run(context) {
      let { prisma } = context;
      const { calls, uploadDirectory, postgres, temporal } = context;
      clearFaults();
      const org = await seedOrganization(prisma, { uploadDirectory });
      // The success notification is opt-out per user; enable it so the
      // notification is a real external effect in the backup/restore账目.
      await prisma.user.update({
        where: { id: org.user.id },
        data: { sendSuccessEmails: true },
      });
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(-5 * MINUTE),
        content: 'Synthetic post produced after the backup',
      });
      const refreshChannel = await seedRefreshChannel(prisma, {
        organization: org.organization,
        tokenExpiration: new Date(Date.now() + HOUR),
      });

      // 1. Quiesce every writer, then take the backup.
      await context.stopOrchestrator();
      if (context.backend) await context.backend.process.stop().catch(() => {});
      const businessBefore = await businessSnapshot(prisma, [org.organization.id]);
      await prisma.$disconnect();
      const backupDir = join(WORK_DIR, 'recovery-backup');
      const databaseFile = join(WORK_DIR, 'recovery.sql');
      const database = dumpDatabase(postgres.name, databaseFile);
      copyTree(uploadDirectory, backupDir);
      const mediaBefore = digestTree(uploadDirectory);
      observe('backup taken', {
        databaseBytes: database.bytes,
        mediaFiles: Object.keys(mediaBefore).length,
        businessDigest: businessBefore.digest.slice(0, 16),
        integrations: businessBefore.integrations.map((integration) => ({
          id: integration.id,
          tokenDigest: integration.tokenDigest.slice(0, 16),
        })),
      });
      prisma = context.prisma = postgres.client();

      // 2. Produce new state: refresh a token, publish, notify.
      await context.bootOrchestrator();
      // The channel was backed up with a future expiry; bring it inside the
      // workflow's window now so the refresh happens while the backup keeps the
      // original token.
      await prisma.integration.update({
        where: { id: refreshChannel.id },
        data: { tokenExpiration: new Date(Date.now() + 2500) },
      });
      const refreshHandle = await temporal.client.workflow.start('refreshTokenWorkflow', {
        workflowId: `refresh_${refreshChannel.id}`,
        taskQueue: 'main',
        args: [
          { integrationId: refreshChannel.id, organizationId: org.organization.id },
        ],
      });
      const refreshed = await waitFor(
        async () => {
          const value = await prisma.integration.findUnique({
            where: { id: refreshChannel.id },
          });
          return value?.token?.startsWith('synthetic-refreshed-access') ? value : null;
        },
        { label: 'external token refresh before the restore', timeoutMs: 60_000 }
      );
      await startV112(context, {
        postId: post.id,
        organizationId: org.organization.id,
      });
      const published = await waitPostState(context, post.id, 'PUBLISHED', 120_000);
      // The success notification is a digest: it records a notification row and
      // signals the long-lived digest e-mail workflow. Wait for both; they are
      // external state a database restore cannot undo.
      const notificationCount = await waitFor(
        async () => {
          const count = await prisma.notifications.count({
            where: { organizationId: org.organization.id },
          });
          return count >= 1 ? count : null;
        },
        { label: 'success notification recorded', timeoutMs: 60_000 }
      );
      const digestExecution = await waitFor(
        async () => {
          const description = await describeWorkflow(
            temporal.client,
            `digest_email_workflow_${org.organization.id}`
          );
          return description.error ? null : description;
        },
        { label: 'digest e-mail execution', timeoutMs: 30_000 }
      );
      const externalBefore = {
        publishes: publishesFor(calls, post.id).length,
        notifications: notificationCount,
        digestWorkflowId: digestExecution.workflowId,
        refreshCalls: calls
          .read()
          .filter((call) => call.method === 'refreshToken').length,
        releaseId: published.releaseId,
        rotatedToken: refreshed.token,
      };
      observe('new state produced after the backup', {
        ...externalBefore,
        rotatedToken: '<redacted>',
      });

      // 3. Quiesce again and restore database + media together.
      await context.stopOrchestrator();
      await prisma.$disconnect();
      restoreDatabase(postgres.name, databaseFile);
      restoreTree(backupDir, uploadDirectory);
      prisma = context.prisma = postgres.client();
      const mediaAfter = digestTree(uploadDirectory);
      const businessAfter = await businessSnapshot(prisma, [org.organization.id]);
      observe('restored state', {
        businessDigest: businessAfter.digest.slice(0, 16),
        mediaFiles: Object.keys(mediaAfter).length,
      });
      expectEqual(
        'the database is identical to the backup digest',
        businessAfter.digest,
        businessBefore.digest
      );
      expectEqual(
        'the media volume is identical to the backup',
        compareTrees(mediaBefore, mediaAfter),
        { added: [], removed: [], changed: [], identical: true }
      );
      expectEqual(
        'the post is back to QUEUE with no release id',
        {
          state: (await snapshotPost(prisma, post.id)).state,
          releaseId: (await snapshotPost(prisma, post.id)).releaseId,
        },
        { state: 'QUEUE', releaseId: null }
      );
      const restoredRefresh = await prisma.integration.findUnique({
        where: { id: refreshChannel.id },
      });
      expectEqual(
        'the rotated token is rolled back locally',
        restoredRefresh.token,
        refreshChannel.token
      );
      expectTrue(
        'but the platform substitute still shows the refresh happened',
        externalBefore.refreshCalls >= 1,
        String(externalBefore.refreshCalls)
      );

      // 4. Temporal still holds the execution and the platform still holds the
      //    publish: the restored database is not the truth.
      const execution = await waitCompleted(temporal.client, `post_${post.id}`);
      observe('Temporal execution after the restore', execution);
      expectEqual('the execution is still there', execution.workflowId, `post_${post.id}`);
      expectEqual('the execution type is unchanged', execution.type, 'postWorkflowV112');
      expectEqual(
        'the business id search attribute is unchanged',
        execution.searchAttributes.postId,
        post.id
      );
      expectEqual('the execution completed', execution.status, 'COMPLETED');
      expectEqual(
        'the platform substitute still shows the published post',
        publishesFor(calls, post.id).length,
        1
      );
      expectEqual(
        'the notification row is rolled back by the restore',
        await prisma.notifications.count({
          where: { organizationId: org.organization.id },
        }),
        0
      );
      const digestAfterRestore = await describeWorkflow(
        temporal.client,
        externalBefore.digestWorkflowId
      );
      expectTrue(
        'but the digest e-mail execution still exists in Temporal',
        !digestAfterRestore.error,
        JSON.stringify(digestAfterRestore)
      );
      await temporal.client.workflow
        .getHandle(refreshHandle.workflowId)
        .terminate('rehearsal finished with the refreshed channel');

      // 5. The restored row is indistinguishable from "never posted", and the
      //    sweep republishes it. That is why recovery must reconcile first.
      await context.bootOrchestrator();
      const sweep = await temporal.client.workflow.start('missingPostWorkflow', {
        workflowId: `missing_post_${org.organization.id}`,
        taskQueue: 'main',
        args: [],
      });
      const republished = await waitPublishCount(context, post.id, 2, 120_000);
      observe('publishes after the restore and sweep', republished.length);
      expectEqual(
        'the sweep republishes the restored QUEUE row',
        republished.length,
        2
      );
      await temporal.client.workflow
        .getHandle(sweep.workflowId, sweep.firstExecutionRunId)
        .terminate('rehearsal finished with the sweep');
      recordFault({
        id: 'coordinated-db-media-restore',
        injection: 'quiesced dump+media snapshot restored after new effects were produced',
        platform:
          'the refresh, the publish and the digest notification are not undone; the sweep adds a second publish',
        temporal: 'same execution id/type/business id, completed, still visible',
        local: 'rows and files match the backup exactly',
        knowable: 'no (the restored row says QUEUE while the platform has a post)',
        classification: 'unknown',
        note:
          'A simultaneous DB+media restore is consistent internally and correlates with Temporal, but it silently rolls back local knowledge of external effects. Reconcile the platform and stop re-driving sweeps before restoring under a live namespace.',
      });
    },
  },

  // -------------------------------------------------------------------------
  // 9. Readiness: process alive is not API ready.
  // -------------------------------------------------------------------------
  {
    id: 'readiness-process-vs-api',
    clock: 'real',
    group: 'recovery',
    description:
      'The backend is started against an unreachable Temporal: the process stays alive (so a supervisor reports online) while /api/ never answers; with the real Temporal the same binary becomes ready.',
    async run(context) {
      const { postgres, uploadDirectory, mediaServer } = context;
      clearFaults();
      const broken = await startBackend({
        databaseUrl: postgres.url,
        temporalAddress: '127.0.0.1:1',
        uploadDirectory,
        frontendUrl: mediaServer.origin,
        callLog: context.calls.path,
        jwtSecret: context.jwtSecret,
        redisUrl: context.redis.url,
        waitForReady: false,
      });
      const pid = broken.process.child.pid;
      let apiReady = false;
      try {
        await waitForHttp(`http://127.0.0.1:${broken.port}/api/`, {
          timeoutMs: 20_000,
          name: 'backend-without-temporal',
        });
        apiReady = true;
      } catch {
        apiReady = false;
      }
      const alive = processAlive(pid);
      observe('backend without Temporal', { alive, apiReady });
      expectEqual('the process is alive', alive, true);
      expectEqual('the API never became ready', apiReady, false);
      await broken.process.stop().catch(() => {});

      const healthy = await startBackend({
        databaseUrl: postgres.url,
        temporalAddress: context.temporal.address,
        uploadDirectory,
        frontendUrl: mediaServer.origin,
        callLog: context.calls.path,
        jwtSecret: context.jwtSecret,
        redisUrl: context.redis.url,
      });
      const response = await waitForHttp(`http://127.0.0.1:${healthy.port}/api/`, {
        timeoutMs: 90_000,
        name: 'backend-with-temporal',
      });
      expectTrue('the same binary becomes ready with Temporal', response.status < 500);
      await healthy.process.stop().catch(() => {});
      recordFault({
        id: 'readiness-process-alive-not-api-ready',
        injection: 'backend pointed at 127.0.0.1:1',
        platform: 'n/a',
        temporal: 'unreachable',
        local: 'process alive, no listener on the API port',
        knowable: 'yes (readiness probe distinguishes the two)',
        classification: 'failed',
        note: 'Any recovery assertion must probe the API, not the supervisor state.',
      });
    },
  },
];

export { join as _join };
