/**
 * Scenario definitions for the delivery fault/recovery rehearsal (ticket 13).
 *
 * Each assertion reads a system seam: the database row, the Temporal
 * description/history, the substitute call ledger, the media file (digest) or
 * the notification/Errors rows. No product internals are asserted and no
 * platform is contacted.
 *
 * The normal-continuity samples come from ticket 12's committed evidence and
 * are loaded by run.mjs; the fault run is compared against those counts.
 */
import { readFileSync } from 'node:fs';
import {
  describeWorkflow,
  historySummary,
  listExecutions,
  terminateIfRunning,
  waitFor,
} from '../../12/lib/temporal.mjs';
import { startOrchestrator } from './stack.mjs';
import { armFaults, clearFaults, readFaults } from './faults.mjs';
import {
  errorsFor,
  notificationsFor,
  seedOrganization,
  seedPost,
  sha256,
  snapshotPost,
  ONE_PIXEL_PNG,
} from './seed.mjs';
import { expectEqual, expectTrue, observe, recordClassification } from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MINUTE = 60_000;

/** Heartbeat timeout in post.workflow.v1.1.2.ts. */
const HEARTBEAT_TIMEOUT = 3 * MINUTE;

// ---------------------------------------------------------------------------
// Boundary ledger readers. `accepted` is only true after the substitute ran
// the platform-side mutation; `phase: entered` means the activity was invoked
// but the platform had not accepted the call yet.
// ---------------------------------------------------------------------------
const acceptedCalls = (calls, method, postId) =>
  calls
    .read()
    .filter(
      (call) =>
        call.method === method &&
        call.accepted === true &&
        (!postId || call.postDbId === postId)
    );

const enteredCalls = (calls, method, postId) =>
  calls
    .read()
    .filter(
      (call) =>
        call.method === method &&
        call.phase === 'entered' &&
        (!postId || call.postDbId === postId)
    );

const methodCalls = (calls, method, postId) =>
  calls
    .read()
    .filter(
      (call) =>
        call.method === method && (!postId || call.postDbId === postId)
    );

const scanMutations = (calls) =>
  calls.read().filter((call) => call.method === 'scanMutation');

async function waitState(prisma, postId, state, timeoutMs = 120_000) {
  return waitFor(
    async () => {
      const post = await snapshotPost(prisma, postId);
      return post?.state === state ? post : null;
    },
    { label: `post ${postId} ${state}`, timeoutMs, intervalMs: 400 }
  );
}

async function waitCompleted(client, workflowId, timeoutMs = 120_000) {
  return waitFor(
    async () => {
      const description = await describeWorkflow(client, workflowId);
      return description.status === 'COMPLETED' ? description : null;
    },
    { label: `workflow ${workflowId} completed`, timeoutMs, intervalMs: 500 }
  );
}

async function waitPublishCount(calls, postId, expected, timeoutMs = 120_000) {
  return waitFor(
    async () => {
      const list = acceptedCalls(calls, 'postPending', postId);
      return list.length >= expected ? list : null;
    },
    { label: `${expected} accepted publish(es) for ${postId}`, timeoutMs }
  );
}

async function waitCall(calls, method, postId, predicate, label, timeoutMs = 60_000) {
  return waitFor(
    async () => {
      const list = methodCalls(calls, method, postId).filter(predicate);
      return list[0] ?? null;
    },
    { label, timeoutMs, intervalMs: 200 }
  );
}

// ---------------------------------------------------------------------------
// Raw history helpers (the server's own view, not the workflow's decision).
// ---------------------------------------------------------------------------
async function pendingActivity(temporal, workflowId, activityName) {
  try {
    const raw = await temporal.client.workflowService.describeWorkflowExecution({
      namespace: temporal.namespace,
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
        timeline.push({
          event: id,
          kind: 'activityTaskScheduled',
          activity: a.activityType?.name,
        });
      } else if (event.activityTaskStartedEventAttributes) {
        timeline.push({
          event: id,
          kind: 'activityTaskStarted',
          activity: nameOf(event.activityTaskStartedEventAttributes),
        });
      } else if (event.activityTaskCompletedEventAttributes) {
        timeline.push({
          event: id,
          kind: 'activityTaskCompleted',
          activity: nameOf(event.activityTaskCompletedEventAttributes),
        });
      } else if (event.activityTaskFailedEventAttributes) {
        const a = event.activityTaskFailedEventAttributes;
        timeline.push({
          event: id,
          kind: 'activityTaskFailed',
          activity: nameOf(a),
          attempt: a.attempt,
          message: a.failure?.message?.slice(0, 100),
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
        });
      } else if (event.timerFiredEventAttributes) {
        timeline.push({ event: id, kind: 'timerFired' });
      } else if (event.workflowTaskFailedEventAttributes) {
        timeline.push({
          event: id,
          kind: 'workflowTaskFailed',
          message: event.workflowTaskFailedEventAttributes.failure?.message?.slice(
            0,
            120
          ),
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
      (event) =>
        event.activityTaskScheduledEventAttributes?.activityType?.name ===
        activityName
    ).length;
  } catch {
    return -1;
  }
}

const errorContains = (row, needle) =>
  String(row?.error ?? '').includes(needle);

const normalScenario = (normalSamples, id) =>
  normalSamples?.scenarios?.find((scenario) => scenario.id === id) ?? null;

export function scenarios(context) {
  const {
    prisma,
    temporal,
    calls,
    config,
    normalSamples,
    bootOrchestrator,
  } = context;

  const normalMediaSha = (() => {
    const normal = normalScenario(normalSamples, 'v112-pending-finalize');
    return normal?.assertions?.find(
      (item) => item.name === 'payload media is the local legacy image'
    )?.actual;
  })();

  const startV112 = async (post, organizationId) =>
    temporal.client.workflow.start('postWorkflowV112', {
      workflowId: `post_${post.id}`,
      taskQueue: 'main',
      args: [
        {
          taskQueue: 'bluesky',
          postId: post.id,
          organizationId,
        },
      ],
      typedSearchAttributes: context.searchAttributes(post.id, organizationId),
    });

  const stopWorkflow = async (workflowId) => {
    await terminateIfRunning(
      temporal.client,
      workflowId,
      'ticket 13 rehearsal cleanup'
    );
  };

  return [
    // -----------------------------------------------------------------------
    // 1. Compensation scan: cancel/delete/reschedule while the scan runs.
    // -----------------------------------------------------------------------
    {
      id: 'scan-mutations-during-compensation',
      description:
        'The missing-posts scan loads four stale QUEUE candidates; before dispatch one is deleted, one is canceled (state ERROR) and one is rescheduled. The activity re-read decides: only the untouched and the still-QUEUE rescheduled rows dispatch; the deleted/canceled rows send nothing and keep their original time.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const stale = new Date(Date.now() - 5 * MINUTE);
        const rescheduledAt = new Date(Date.now() + 9000);
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
          content: 'Synthetic post deleted during the scan',
        });
        const canceled = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: stale,
          content: 'Synthetic post canceled during the scan',
        });
        const rescheduled = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: stale,
          content: 'Synthetic post rescheduled during the scan',
        });
        const missingWorkflowId = `missing-post-ticket13-${org.organization.id}`;
        const callStart = calls.read().length;

        armFaults({
          scan: [
            { postId: deleted.id, action: 'delete' },
            { postId: canceled.id, action: 'cancel' },
            {
              postId: rescheduled.id,
              action: 'reschedule',
              publishDate: rescheduledAt.toISOString(),
            },
          ],
        });

        const candidate = await bootOrchestrator();
        try {
          await temporal.client.workflow.start('missingPostWorkflow', {
            workflowId: missingWorkflowId,
            taskQueue: 'main',
          });

          const publishedLive = await waitState(prisma, live.id, 'PUBLISHED', 90_000);
          observe('live post published', publishedLive);
          expectEqual('control post published once', publishedLive.state, 'PUBLISHED');
          expectEqual(
            'control post keeps its original scheduled time',
            publishedLive.publishDate,
            stale.toISOString()
          );

          const rescheduledExecution = await waitFor(
            async () => {
              const found = await describeWorkflow(
                temporal.client,
                `post_${rescheduled.id}`
              );
              return found.status && found.status !== 'NOT_FOUND' ? found : null;
            },
            { label: 'rescheduled post dispatch', timeoutMs: 60_000, intervalMs: 300 }
          );
          observe('rescheduled execution', rescheduledExecution);
          expectEqual(
            'still-QUEUE rescheduled row is dispatched as V112',
            rescheduledExecution.type,
            'postWorkflowV112'
          );

          const publishedRescheduled = await waitState(
            prisma,
            rescheduled.id,
            'PUBLISHED',
            60_000
          );
          observe('rescheduled post published', publishedRescheduled);
          expectEqual(
            'rescheduled publish keeps the new scheduled time',
            publishedRescheduled.publishDate,
            rescheduledAt.toISOString()
          );
          expectTrue(
            'rescheduled post wrote its release id back',
            !!publishedRescheduled.releaseId,
            String(publishedRescheduled.releaseId)
          );

          const rescheduledCalls = acceptedCalls(calls, 'postPending', rescheduled.id);
          expectEqual('rescheduled post sent exactly once', rescheduledCalls.length, 1);
          const earlyMs =
            Date.parse(rescheduledCalls[0].at) - rescheduledAt.getTime();
          observe('rescheduled first send relative to the new time (ms)', earlyMs);
          expectTrue(
            'rescheduled post did not send before the new time',
            earlyMs >= -1500,
            `sent ${earlyMs}ms relative to ${rescheduledAt.toISOString()}`
          );

          const afterDeleted = await snapshotPost(prisma, deleted.id);
          const afterCanceled = await snapshotPost(prisma, canceled.id);
          observe('deleted row after the scan', afterDeleted);
          observe('canceled row after the scan', afterCanceled);
          expectTrue('deleted row is still soft-deleted', !!afterDeleted.deletedAt);
          expectEqual('deleted row keeps its original time', afterDeleted.publishDate, stale.toISOString());
          expectEqual(
            'deleted row was not dispatched',
            (await describeWorkflow(temporal.client, `post_${deleted.id}`)).error
              ? 'no execution'
              : 'execution',
            'no execution'
          );
          expectEqual('canceled row is ERROR', afterCanceled.state, 'ERROR');
          expectEqual('canceled row keeps its original time', afterCanceled.publishDate, stale.toISOString());
          expectEqual(
            'canceled row was not dispatched',
            (await describeWorkflow(temporal.client, `post_${canceled.id}`)).error
              ? 'no execution'
              : 'execution',
            'no execution'
          );

          const mutations = scanMutations(calls);
          observe(
            'scan mutations recorded before dispatch',
            mutations.map((item) => ({ postId: item.postId, action: item.action }))
          );
          expectEqual('all three scan mutations applied', mutations.length, 3);
          expectEqual(
            'deleted/canceled posts sent nothing',
            acceptedCalls(calls, 'postPending', deleted.id).length +
              acceptedCalls(calls, 'postPending', canceled.id).length,
            0
          );
          const orgPublishes = [
            live.id,
            deleted.id,
            canceled.id,
            rescheduled.id,
          ].reduce(
            (total, id) => total + acceptedCalls(calls, 'postPending', id).length,
            0
          );
          observe('platform accepted sends for the four candidates', orgPublishes);
          expectEqual('only the two still-QUEUE rows sent', orgPublishes, 2);
          if (normalMediaSha) {
            expectEqual(
              'media payload matches the ticket-12 normal sample',
              acceptedCalls(calls, 'postPending', live.id)[0].posts[0].media[0].sha256,
              normalMediaSha
            );
          }

          const normal = normalScenario(normalSamples, 'missing-scan');
          observe('ticket-12 normal sample', {
            id: normal?.id,
            dispatched: normal?.assertions?.find(
              (item) => item.name === 'scan dispatched V112'
            )?.actual,
            published: normal?.assertions?.find(
              (item) => item.name === 'only the live post published'
            )?.actual,
          });
          recordClassification({
            id: 'scan-mutations-during-compensation',
            classification: 'complete',
            duplicate: false,
            summary:
              'deleted/canceled candidates were skipped by the pre-dispatch re-read; the rescheduled QUEUE row dispatched once at its new time',
          });

          await stopWorkflow(missingWorkflowId);
          await stopWorkflow(`streak_${org.organization.id}`);
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },

    // -----------------------------------------------------------------------
    // 2. The platform rejects the finalize: terminal, not unknown.
    // -----------------------------------------------------------------------
    {
      id: 'finalize-platform-rejected',
      description:
        'postPending/checkPostStatus succeed, then finalizePost throws a non-retryable bad_body failure: the post is ERROR with the serialized platform rejection, the platform records zero accepted finalizes, and nothing is classified as unknown or retried.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: new Date(Date.now() + 1500),
          content: 'Synthetic post rejected at finalize',
        });
        const callStart = calls.read().length;
        armFaults({ [`finalize:${post.id}`]: 'reject' });
        const candidate = await bootOrchestrator();
        try {
          const handle = await startV112(post, org.organization.id);
          const row = await waitState(prisma, post.id, 'ERROR', 90_000);
          observe('post after the platform rejection', row);
          expectEqual('platform-rejected post is ERROR', row.state, 'ERROR');
          expectEqual('no release id is written', row.releaseId, null);
          expectTrue(
            'the stored failure carries the bad_body type',
            errorContains(row, 'bad_body'),
            String(row.error).slice(0, 300)
          );

          const pending = acceptedCalls(calls, 'postPending', post.id);
          const finalize = methodCalls(calls, 'finalizePost', post.id);
          const rejected = finalize.filter((call) => call.accepted === false);
          observe('platform ledger', {
            pendingAccepted: pending.length,
            finalizeEntered: finalize.length,
            finalizeAccepted: finalize.filter((call) => call.accepted).length,
            finalizeRejected: rejected.length,
          });
          expectEqual('the pending call was accepted once', pending.length, 1);
          expectEqual('finalize was invoked once', finalize.length, 1);
          expectEqual('the platform rejected the finalize', rejected.length, 1);
          expectEqual(
            'the platform accepted zero finalizes',
            finalize.filter((call) => call.accepted).length,
            0
          );
          expectEqual(
            'the rejection was not retried',
            await scheduledCount(temporal.client, `post_${post.id}`, 'finalizePost'),
            1
          );

          const errors = await errorsFor(prisma, post.id);
          observe('durable Errors rows', errors.map((item) => item.message.slice(0, 120)));
          expectTrue(
            'an Errors row records the platform rejection',
            errors.some((item) => String(item.message).includes('bad_body')),
            JSON.stringify(errors.map((item) => item.message.slice(0, 80)))
          );
          const notifications = await notificationsFor(prisma, org.organization.id);
          expectTrue(
            'the user is told the platform rejected the post',
            notifications.some((item) =>
              /error occurred while posting|Error posting/i.test(item.content)
            ),
            JSON.stringify(notifications.map((item) => item.content.slice(0, 80)))
          );
          await waitCompleted(temporal.client, `post_${post.id}`);
          await stopWorkflow(`streak_${org.organization.id}`);

          recordClassification({
            id: 'finalize-platform-rejected',
            classification: 'failed',
            duplicate: false,
            summary:
              'bad_body from finalize: platform accepted no finalize, row ERROR with the rejection; not an unknown result',
          });
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },

    // -----------------------------------------------------------------------
    // 3. Pending in progress is not unknown.
    // -----------------------------------------------------------------------
    {
      id: 'pending-still-in-progress',
      description:
        'checkPostStatus keeps returning pending: the platform accepted the publish, the row stays QUEUE, the execution stays RUNNING and no finalize is attempted. This is a pending result, distinct from a platform rejection and from the unknown timeout marker.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: new Date(Date.now() + 1500),
          content: 'Synthetic pending post still processing',
        });
        armFaults({ [`check:${post.id}`]: 'pending' });
        const candidate = await bootOrchestrator();
        try {
          const handle = await startV112(post, org.organization.id);
          await waitCall(
            calls,
            'checkPostStatus',
            post.id,
            () => true,
            'first pending status check'
          );
          await waitFor(
            () => methodCalls(calls, 'checkPostStatus', post.id).length >= 2,
            { label: 'second pending status check', timeoutMs: 60_000 }
          );
          const row = await snapshotPost(prisma, post.id);
          const execution = await describeWorkflow(
            temporal.client,
            `post_${post.id}`,
            handle.firstExecutionRunId
          );
          observe('pending row', row);
          observe('pending execution', execution);
          expectEqual('pending post stays QUEUE', row.state, 'QUEUE');
          expectEqual('pending execution stays RUNNING', execution.status, 'RUNNING');
          expectEqual('no release id yet', row.releaseId, null);
          expectEqual(
            'the platform accepted the publish once',
            acceptedCalls(calls, 'postPending', post.id).length,
            1
          );
          expectEqual(
            'the status read ran at least twice',
            methodCalls(calls, 'checkPostStatus', post.id).length >= 2,
            true
          );
          expectEqual(
            'pending never finalized',
            methodCalls(calls, 'finalizePost', post.id).length,
            0
          );
          expectTrue('pending row has no error marker', !row.error, String(row.error));
          const errors = await errorsFor(prisma, post.id);
          expectEqual('pending has no Errors row', errors.length, 0);

          const normal = normalScenario(normalSamples, 'v112-pending-finalize');
          observe('ticket-12 normal V112 contract', {
            pending: normal?.assertions?.find(
              (item) => item.name === 'pending accepted exactly once'
            )?.actual,
            checks: normal?.assertions?.find(
              (item) => item.name === 'status checked exactly once'
            )?.actual,
            finalizes: normal?.assertions?.find(
              (item) => item.name === 'finalize ran exactly once'
            )?.actual,
          });
          recordClassification({
            id: 'pending-still-in-progress',
            classification: 'pending',
            duplicate: false,
            summary:
              'platform accepted once; status kept returning pending, row QUEUE, execution RUNNING, no finalize and no error marker',
          });
          await stopWorkflow(`post_${post.id}`);
          await stopWorkflow(`streak_${org.organization.id}`);
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },

    // -----------------------------------------------------------------------
    // 4. Local write-back failure, then the shipped retry recovers.
    // -----------------------------------------------------------------------
    {
      id: 'writeback-transient-recovers',
      description:
        'The platform accepts and finalizes the post, the first updatePost activity attempt fails locally, and the shipped retry writes the accepted result back. The platform send count stays one and the row ends PUBLISHED with the finalize release id.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: new Date(Date.now() + 1500),
          content: 'Synthetic post whose first write-back fails',
        });
        armFaults({ [`updatePost:${post.id}`]: 'fail-once' });
        const candidate = await bootOrchestrator();
        try {
          await startV112(post, org.organization.id);
          await waitFor(
            () => methodCalls(calls, 'updatePost', post.id).length >= 1,
            { label: 'first write-back attempt', timeoutMs: 90_000 }
          );
          const queued = await snapshotPost(prisma, post.id);
          observe('row after the failed first write-back', queued);
          expectEqual('failed write-back leaves the row QUEUE', queued.state, 'QUEUE');

          const published = await waitState(prisma, post.id, 'PUBLISHED', 4 * MINUTE);
          observe('row after the retry', published);
          expectEqual('retry writes PUBLISHED', published.state, 'PUBLISHED');
          expectTrue(
            'retry writes the finalize release id',
            !!published.releaseId,
            String(published.releaseId)
          );
          expectTrue('no error remains on the recovered row', !published.error);

          const accepted = acceptedCalls(calls, 'postPending', post.id);
          const finalizes = acceptedCalls(calls, 'finalizePost', post.id);
          observe('platform ledger after recovery', {
            publishing: accepted.length,
            finalizeAccepted: finalizes.length,
          });
          expectEqual('platform send was accepted once', accepted.length, 1);
          expectEqual('finalize was accepted once', finalizes.length, 1);
          const attempts = methodCalls(calls, 'updatePost', post.id);
          observe(
            'write-back attempts',
            attempts.map((call) => call.at)
          );
          expectEqual('write-back was attempted twice', attempts.length, 2);
          expectTrue(
            'the shipped retry waited the configured backoff',
            Date.parse(attempts[1].at) - Date.parse(attempts[0].at) >= 110_000,
            `${Date.parse(attempts[1].at) - Date.parse(attempts[0].at)}ms`
          );
          expectEqual(
            'write-back retried inside one scheduled activity',
            await scheduledCount(temporal.client, `post_${post.id}`, 'updatePost'),
            1
          );
          const timeline = await activityTimeline(temporal.client, `post_${post.id}`);
          observe(
            'write-back timeline',
            timeline.filter((item) => item.activity === 'updatePost')
          );
          expectTrue(
            'history records one updatePost task that completed after the retry',
            timeline.some(
              (item) =>
                item.kind === 'activityTaskCompleted' && item.activity === 'updatePost'
            )
          );
          await waitCompleted(temporal.client, `post_${post.id}`);
          await stopWorkflow(`streak_${org.organization.id}`);

          recordClassification({
            id: 'writeback-transient-recovers',
            classification: 'complete',
            duplicate: false,
            summary:
              'one accepted platform send; the first local write-back failed, the shipped retry wrote PUBLISHED with the finalize id',
          });
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },

    // -----------------------------------------------------------------------
    // 5. Total write-back loss: unknown stays QUEUE and the scan republishes.
    // -----------------------------------------------------------------------
    {
      id: 'writeback-permanent-sweep-duplicates',
      description:
        'updatePost and changeState both fail after the platform accepted the post, so the row stays QUEUE with no local result. The compensation scan then treats it as unpublished and sends it again: the same post is accepted twice. Evidence for reconciling the platform before re-enabling the sweep.',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate: new Date(Date.now() - 5 * MINUTE),
          content: 'Synthetic post with total write-back loss',
        });
        const missingWorkflowId = `missing-post-ticket13-${org.organization.id}`;
        armFaults({
          [`updatePost:${post.id}`]: 'fail',
          [`changeState:${post.id}`]: 'fail',
        });
        const candidate = await bootOrchestrator();
        try {
          await startV112(post, org.organization.id);
          const firstWave = await waitPublishCount(calls, post.id, 1, 90_000);
          observe('first accepted publish', firstWave.map((call) => call.pendingData));
          await waitCompleted(temporal.client, `post_${post.id}`, 90_000);
          const unknown = await snapshotPost(prisma, post.id);
          observe('row after both write-backs failed', unknown);
          expectEqual('unknown row stays QUEUE', unknown.state, 'QUEUE');
          expectEqual('unknown row has no local release id', unknown.releaseId, null);
          recordClassification({
            id: 'total-writeback-loss-before-sweep',
            classification: 'unknown',
            duplicate: false,
            summary:
              'platform accepted once; updatePost and changeState failed, the row says QUEUE and cannot be distinguished from never-published',
          });

          clearFaults();
          await temporal.client.workflow.start('missingPostWorkflow', {
            workflowId: missingWorkflowId,
            taskQueue: 'main',
          });
          const secondWave = await waitPublishCount(calls, post.id, 2, 90_000);
          observe(
            'accepted publishes after the scan',
            secondWave.map((call) => ({
              at: call.at,
              id: call.pendingData?.id,
              pid: call.pid,
            }))
          );
          expectEqual('the scan republished the same post', secondWave.length, 2);
          expectTrue(
            'the two accepts are distinct platform ids',
            secondWave[0].pendingData.id !== secondWave[1].pendingData.id,
            `${secondWave[0].pendingData.id} vs ${secondWave[1].pendingData.id}`
          );
          const published = await waitState(prisma, post.id, 'PUBLISHED', 90_000);
          observe('row after the scan republished it', published);
          const finalizeAccepts = acceptedCalls(calls, 'finalizePost', post.id);
          expectTrue(
            'the last accepted publish is written back',
            !!published.releaseId,
            String(published.releaseId)
          );
          expectEqual(
            'the local release id is the last finalize result',
            published.releaseId,
            finalizeAccepts[finalizeAccepts.length - 1].finalizedId
          );
          recordClassification({
            id: 'total-writeback-loss-sweep-duplicate',
            classification: 'unknown',
            duplicate: true,
            summary:
              'the compensation scan accepted the already-published post a second time; must reconcile the platform before re-enabling the sweep',
          });
          await stopWorkflow(missingWorkflowId);
          await stopWorkflow(`streak_${org.organization.id}`);
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },

    // -----------------------------------------------------------------------
    // 6. Worker death with finalize in flight and NO heartbeat details.
    // -----------------------------------------------------------------------
    {
      id: 'worker-death-finalize-no-details',
      description:
        'Two finalizes are in flight when the worker is SIGKILLed inside the first heartbeat interval, so neither has heartbeat details: one had not reached the platform (safe retry), the other was already accepted (retry duplicates). After restart the workflow retries both; the evidence separates the safe retry from the duplicate.',
      async run() {
        const safeOrg = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const duplicateOrg = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const safe = await seedPost(prisma, {
          organization: safeOrg.organization,
          integration: safeOrg.integration,
          media: safeOrg.media,
          publishDate: new Date(Date.now() + 1000),
          content: 'Synthetic finalize killed before the platform accept',
        });
        const duplicate = await seedPost(prisma, {
          organization: duplicateOrg.organization,
          integration: duplicateOrg.integration,
          media: duplicateOrg.media,
          publishDate: new Date(Date.now() + 1000),
          content: 'Synthetic finalize accepted then killed before a heartbeat',
        });
        armFaults({
          [`finalize:${safe.id}`]: 'delay-accept-30000',
          [`finalize:${duplicate.id}`]: 'hang-after-accept',
        });
        let candidate = await bootOrchestrator();
        try {
          await startV112(safe, safeOrg.organization.id);
          await startV112(duplicate, duplicateOrg.organization.id);

          await waitCall(
            calls,
            'finalizePost',
            safe.id,
            (call) => call.phase === 'entered',
            'safe finalize entered before the platform accept'
          );
          await waitCall(
            calls,
            'finalizePost',
            duplicate.id,
            (call) => call.accepted === true,
            'duplicate finalize accepted'
          );

          const safePending = await pendingActivity(
            temporal,
            `post_${safe.id}`,
            'finalizePost'
          );
          const duplicatePending = await pendingActivity(
            temporal,
            `post_${duplicate.id}`,
            'finalizePost'
          );
          observe('heartbeat details before the kill', {
            safe: safePending?.heartbeatDetails?.payloads?.length ?? 0,
            duplicate: duplicatePending?.heartbeatDetails?.payloads?.length ?? 0,
          });
          expectTrue(
            'the safe finalize has no heartbeat details yet',
            !safePending?.heartbeatDetails?.payloads?.length
          );
          expectTrue(
            'the accepted finalize also has no heartbeat details yet',
            !duplicatePending?.heartbeatDetails?.payloads?.length
          );

          const killed = await candidate.process.kill();
          expectTrue('worker process group was SIGKILLed', killed);
          clearFaults();

          candidate = await bootOrchestrator();
          const safeTimedOut = await waitFor(
            async () => {
              const description = await describeWorkflow(
                temporal.client,
                `post_${safe.id}`
              );
              return description.status && description.status !== 'RUNNING'
                ? description
                : null;
            },
            { label: 'safe execution resolved after the timeout', timeoutMs: 5 * MINUTE }
          );
          const duplicateTimedOut = await waitFor(
            async () => {
              const description = await describeWorkflow(
                temporal.client,
                `post_${duplicate.id}`
              );
              return description.status && description.status !== 'RUNNING'
                ? description
                : null;
            },
            { label: 'duplicate execution resolved after the timeout', timeoutMs: 5 * MINUTE }
          );
          expectEqual(
            'safe execution completed after the safe retry',
            safeTimedOut.status,
            'COMPLETED'
          );

          const safeRow = await waitState(prisma, safe.id, 'PUBLISHED', 90_000);
          const duplicateRow = await waitState(
            prisma,
            duplicate.id,
            'PUBLISHED',
            90_000
          );
          observe('safe row after the retry', safeRow);
          observe('duplicate row after the retry', duplicateRow);
          expectEqual('safe post is PUBLISHED after the retry', safeRow.state, 'PUBLISHED');
          expectEqual(
            'safe post has one platform accept (the first attempt never reached the platform)',
            acceptedCalls(calls, 'postPending', safe.id).length,
            1
          );
          expectEqual(
            'safe finalize accepted exactly once',
            acceptedCalls(calls, 'finalizePost', safe.id).length,
            1
          );
          expectEqual(
            'safe finalize was scheduled twice (failed first attempt + retry)',
            await scheduledCount(temporal.client, `post_${safe.id}`, 'finalizePost'),
            2
          );

          const duplicateAccepts = acceptedCalls(
            calls,
            'finalizePost',
            duplicate.id
          );
          const acceptId = (call) => call.finalizedId || call.pendingData.id;
          observe(
            'duplicate finalize accepts',
            duplicateAccepts.map((call) => ({
              id: acceptId(call),
              pid: call.pid,
              at: call.at,
            }))
          );
          expectEqual(
            'accepted finalize was sent twice after the no-details retry',
            duplicateAccepts.length,
            2
          );
          expectTrue(
            'the two accepts are distinct platform ids',
            acceptId(duplicateAccepts[0]) !== acceptId(duplicateAccepts[1]),
            `${acceptId(duplicateAccepts[0])} vs ${acceptId(duplicateAccepts[1])}`
          );
          expectTrue(
            'the retry came from the restarted process',
            duplicateAccepts[0].pid !== duplicateAccepts[1].pid,
            `${duplicateAccepts[0].pid} vs ${duplicateAccepts[1].pid}`
          );
          expectEqual(
            'the local result points at the second accept',
            duplicateRow.releaseId,
            acceptId(duplicateAccepts[1])
          );
          const duplicateTimeout = await timedOutActivity(
            temporal.client,
            `post_${duplicate.id}`,
            'finalizePost'
          );
          observe('duplicate finalize timeout', duplicateTimeout);
          expectEqual(
            'the timeout carried no heartbeat details',
            {
              timeoutType: duplicateTimeout?.timeoutType ?? null,
              heartbeatPayloads: duplicateTimeout?.heartbeatPayloads ?? null,
            },
            { timeoutType: 4, heartbeatPayloads: 0 }
          );
          expectEqual(
            'the no-details timeout was classified as never-started and retried',
            duplicateTimedOut.status,
            'COMPLETED'
          );

          recordClassification({
            id: 'worker-death-finalize-before-platform-accept',
            classification: 'complete',
            duplicate: false,
            summary:
              'no heartbeat details and no platform accept before the kill; the retry accepted once and wrote back',
          });
          recordClassification({
            id: 'worker-death-finalize-after-platform-accept-no-details',
            classification: 'unknown',
            duplicate: true,
            summary:
              'no heartbeat details, but the platform had already accepted the finalize; the retry sent a second accept. Residual 15s-window hazard, recorded not hidden.',
          });

          await stopWorkflow(`streak_${safeOrg.organization.id}`);
          await stopWorkflow(`streak_${duplicateOrg.organization.id}`);
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },

    // -----------------------------------------------------------------------
    // 7. Worker death after the platform accepted, WITH heartbeat details.
    // -----------------------------------------------------------------------
    {
      id: 'worker-death-finalize-with-details',
      description:
        'The platform accepted finalizePost, a heartbeat reached the server, then the worker was SIGKILLed. After restart the heartbeat timeout carries details, the workflow marks the post unconfirmed and never runs finalize again: one accepted send, no duplicate, no local release id (unknown).',
      async run() {
        const org = await seedOrganization(prisma, {
          uploadDirectory: config.uploadDirectory,
        });
        const publishDate = new Date(Date.now() + 1500);
        const post = await seedPost(prisma, {
          organization: org.organization,
          integration: org.integration,
          media: org.media,
          publishDate,
          content: 'Synthetic finalize accepted then killed with heartbeat details',
        });
        const callStart = calls.read().length;
        armFaults({ [`finalize:${post.id}`]: 'hang-after-accept' });
        let candidate = await bootOrchestrator();
        try {
          const handle = await startV112(post, org.organization.id);
          await waitCall(
            calls,
            'finalizePost',
            post.id,
            (call) => call.accepted === true,
            'finalize accepted by the platform'
          );
          const acceptedAt = Date.now();
          const pending = await waitFor(
            async () => {
              const value = await pendingActivity(
                temporal,
                `post_${post.id}`,
                'finalizePost'
              );
              return value?.heartbeatDetails?.payloads?.length ? value : null;
            },
            {
              label: 'finalize heartbeat details on the server',
              timeoutMs: 90_000,
            }
          );
          observe('heartbeat details before the kill', {
            payloads: pending.heartbeatDetails.payloads.length,
            firstHeartbeatAfterMs: Date.now() - acceptedAt,
          });
          const detailText = (() => {
            const payload = pending.heartbeatDetails.payloads[0];
            const buffer =
              typeof payload.data === 'string'
                ? Buffer.from(payload.data, 'base64')
                : Buffer.from(payload.data);
            return buffer.toString('utf8');
          })();
          observe('heartbeat detail payload', detailText);

          const beforeKill = await snapshotPost(prisma, post.id);
          const mediaDigestBefore = sha256(
            readFileSync(org.mediaAbsolutePath)
          );
          const beforeDescription = await describeWorkflow(
            temporal.client,
            `post_${post.id}`,
            handle.firstExecutionRunId
          );

          const killed = await candidate.process.kill();
          expectTrue('worker process group was SIGKILLed after the heartbeat', killed);
          clearFaults();
          candidate = await bootOrchestrator();

          const row = await waitState(prisma, post.id, 'ERROR', 5 * MINUTE);
          observe('row after the heartbeat timeout', row);
          expectEqual('post is ERROR/unconfirmed', row.state, 'ERROR');
          expectEqual('no local release id is written', row.releaseId, null);
          expectEqual(
            'the publish date is unchanged',
            row.publishDate,
            publishDate.toISOString()
          );
          expectTrue(
            'the stored failure names finalizePost',
            errorContains(row, 'finalizePost'),
            String(row.error).slice(0, 300)
          );
          expectTrue(
            'the stored failure carries the heartbeat timeout details',
            errorContains(row, 'HEARTBEAT') &&
              errorContains(row, 'lastHeartbeatDetails'),
            String(row.error).slice(0, 300)
          );

          const descriptions = await waitCompleted(
            temporal.client,
            `post_${post.id}`,
            90_000
          );
          const afterDescription = await describeWorkflow(
            temporal.client,
            `post_${post.id}`,
            handle.firstExecutionRunId
          );
          observe('execution after recovery', afterDescription);
          expectEqual(
            'same workflow id after the restart',
            afterDescription.workflowId,
            beforeDescription.workflowId
          );
          expectEqual(
            'same run id after the restart',
            afterDescription.runId,
            beforeDescription.runId
          );
          expectEqual(
            'same workflow type after the restart',
            afterDescription.type,
            'postWorkflowV112'
          );
          const changeVersions = Array.isArray(
            afterDescription.searchAttributes.TemporalChangeVersion
          )
            ? afterDescription.searchAttributes.TemporalChangeVersion
            : [afterDescription.searchAttributes.TemporalChangeVersion];
          observe('custom unknown-result marker', changeVersions);
          expectTrue(
            'the post-finalize-timeout-unknown patch marker is recorded',
            changeVersions.includes('post-finalize-timeout-unknown'),
            JSON.stringify(changeVersions)
          );

          const timeout = await timedOutActivity(
            temporal.client,
            `post_${post.id}`,
            'finalizePost'
          );
          observe('finalize timeout event', timeout);
          expectEqual(
            'one heartbeat timeout with exactly one payload',
            {
              timeoutType: timeout?.timeoutType ?? null,
              heartbeatPayloads: timeout?.heartbeatPayloads ?? null,
            },
            { timeoutType: 4, heartbeatPayloads: 1 }
          );
          const history = await historySummary(
            temporal.client,
            `post_${post.id}`,
            handle.firstExecutionRunId
          );
          const scheduledFor = (name) =>
            history.activityScheduled.filter((item) => item.activity === name)
              .length;
          observe('activity schedule counts', {
            postSocialPending: scheduledFor('postSocialPending'),
            checkPostStatus: scheduledFor('checkPostStatus'),
            finalizePost: scheduledFor('finalizePost'),
          });
          expectEqual('publish scheduled once', scheduledFor('postSocialPending'), 1);
          expectEqual('status check scheduled once', scheduledFor('checkPostStatus'), 1);
          expectEqual(
            'finalize was never scheduled again after the timeout',
            scheduledFor('finalizePost'),
            1
          );
          expectEqual(
            'exactly one finalize reached the platform',
            acceptedCalls(calls, 'finalizePost', post.id).length,
            1
          );
          expectEqual(
            'the publish was accepted exactly once',
            acceptedCalls(calls, 'postPending', post.id).length,
            1
          );

          const errors = await errorsFor(prisma, post.id);
          observe('durable Errors rows', errors.map((item) => item.message.slice(0, 160)));
          expectTrue(
            'an Errors row records the timeout',
            errors.some((item) => String(item.message).includes('HEARTBEAT')),
            JSON.stringify(errors.map((item) => item.message.slice(0, 80)))
          );
          const notifications = await notificationsFor(prisma, org.organization.id);
          observe(
            'notifications',
            notifications.map((item) => item.content.slice(0, 100))
          );
          expectTrue(
            'the user is told the result could not be confirmed',
            notifications.some((item) =>
              /couldn't confirm/i.test(item.content)
            ),
            JSON.stringify(notifications.map((item) => item.content.slice(0, 80)))
          );

          const afterKill = await snapshotPost(prisma, post.id);
          observe('media digest check', {
            before: mediaDigestBefore,
            after: sha256(readFileSync(org.mediaAbsolutePath)),
            rowChangedAfterRecovery:
              afterKill.releaseId === beforeKill.releaseId &&
              afterKill.state === row.state,
          });
          expectEqual(
            'the local media file was not changed by the recovery',
            sha256(readFileSync(org.mediaAbsolutePath)),
            mediaDigestBefore
          );

          const ledgerAfter = calls.read().slice(callStart);
          observe(
            'platform calls after recovery',
            ledgerAfter
              .filter((call) =>
                ['postPending', 'checkPostStatus', 'finalizePost'].includes(
                  call.method
                ) && call.postDbId === post.id
              )
              .map((call) => ({
                method: call.method,
                accepted: call.accepted ?? null,
                pid: call.pid,
              }))
          );

          recordClassification({
            id: 'worker-death-finalize-with-details',
            classification: 'unknown',
            duplicate: false,
            summary:
              'one accepted finalize; heartbeat timeout carried details; the workflow marked ERROR/unconfirmed and never retried finalize after the restart',
          });

          await stopWorkflow(`streak_${org.organization.id}`);
        } finally {
          await candidate.process.stop();
          clearFaults();
        }
      },
    },
  ];
}
