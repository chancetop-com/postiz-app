/**
 * Scenario definitions for ticket 16 (recurring/maintenance continuity).
 *
 * Every assertion reads a system seam: the database row, the Temporal
 * execution/history, the stub call log, or the local media file. The real
 * candidate backend/orchestrator run unmodified; only platform and e-mail are
 * substituted.
 */
import {
  describeWorkflow,
  historySummary,
  waitFor,
} from '../../15/lib/temporal-env.mjs';
import { emails, publishCalls } from '../../15/lib/calls.mjs';
import { seedOrganization } from '../../15/lib/seed.mjs';
import { createPublicPost } from './api16.mjs';
import { startLegacyPublishingWorker } from './legacy-worker.mjs';
import {
  seedAutopost,
  seedCommentThread,
  seedRefreshChannel,
  seedRepeatPost,
  seedStalePost,
  snapshotPost,
} from './seed16.mjs';
import {
  expectEqual,
  expectTrue,
  observe,
  recordQueues,
} from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const forOrg = (calls, organizationId) =>
  calls.read().filter((call) => call.organizationId === organizationId);

const publishesFor = (calls, organizationId) =>
  forOrg(calls, organizationId).filter(
    (call) => call.method === 'post' || call.method === 'postPending'
  );

const commentsFor = (calls, organizationId) =>
  forOrg(calls, organizationId).filter((call) => call.method === 'comment');

const emailsFor = (calls, to) =>
  emails(calls).filter((call) => call.to === to);

async function waitPublishCount(context, organizationId, expected, timeoutMs = 90_000) {
  return waitFor(
    async () => {
      const list = publishesFor(context.calls, organizationId);
      return list.length >= expected ? list : null;
    },
    { label: `${expected} publish call(s)`, timeoutMs }
  );
}

async function waitPublished(context, postId, timeoutMs = 90_000) {
  return waitFor(
    async () => {
      const post = await snapshotPost(context.prisma, postId);
      return post?.state === 'PUBLISHED' ? post : null;
    },
    { label: `post ${postId} PUBLISHED`, timeoutMs }
  );
}

async function waitRefresh(context, integrationId, prefix, timeoutMs = 30_000) {
  return waitFor(
    async () => {
      const row = await context.prisma.integration.findUnique({
        where: { id: integrationId },
      });
      return row?.token?.startsWith(prefix) ? row : null;
    },
    { label: `refresh ${integrationId}`, timeoutMs }
  );
}

// The platform stub records a publish before the workflow itself has processed
// the activity result and closed. Poll the workflow status so the assertion
// observes the settled execution instead of racing it.
async function waitWorkflowStatus(context, workflowId, runId, expected, timeoutMs = 30_000) {
  return waitFor(
    async () => {
      const description = await describeWorkflow(context.temporal.client, workflowId, runId);
      return description?.status === expected ? description : null;
    },
    { label: `${workflowId} ${expected}`, timeoutMs }
  );
}

function recordExecutionQueues(description, history) {
  recordQueues({
    workflowTaskQueue: description?.taskQueue,
    activityScheduled: history?.activityScheduled ?? [],
  });
}

function activityOn(history, name) {
  return (history.activityScheduled || []).find((item) => item.activity === name);
}

export const scenarios = [
  {
    id: 'legacy-repeat-child-continuity',
    clock: 'skip',
    group: 'legacy-repeat',
    needsBackend: false,
    description:
      'An existing pre-upgrade V102 repeat execution publishes its first round, survives a worker restart, and then starts its next round as another V102 execution; the old export is still required after round one.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const publishDate = iso(3000);
      const post = await seedRepeatPost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate,
        content: 'Synthetic old repeat post',
        intervalInDays: 1,
      });

      // The pre-upgrade scheduling entry created a V102 execution on main.
      // The candidate still exports that definition, so it executes the
      // existing old run (ticket 15 proves the old-worker hand-over itself).
      const handle = await temporal.client.workflow.start('postWorkflowV102', {
        workflowId: `post_${post.id}`,
        taskQueue: 'main',
        args: [
          {
            taskQueue: 'bluesky',
            postId: post.id,
            organizationId: org.organization.id,
          },
        ],
        searchAttributes: {
          postId: [post.id],
          organizationId: [org.organization.id],
        },
      });

      await temporal.env.sleep(5000);
      const first = await waitPublished(context, post.id);
      observe('first round', first);
      await waitPublishCount(context, org.organization.id, 1);

      const parentBefore = await describeWorkflow(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      const parentHistoryBefore = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('first-round execution', parentBefore);
      observe('first-round publish calls', publishesFor(calls, org.organization.id).map((c) => c.method));
      expectEqual('first round used the old workflow type', parentBefore.type, 'postWorkflowV102');
      expectEqual('first round kept the post workflow id', parentBefore.workflowId, `post_${post.id}`);
      expectEqual('first round ran on main', parentBefore.taskQueue, 'main');
      expectEqual('first round published on the provider queue', activityOn(parentHistoryBefore, 'postSocial').taskQueue, 'bluesky');
      expectEqual('first-round publish uses the blocking contract', publishesFor(calls, org.organization.id)[0].method, 'post');
      expectEqual('old publishDate is never rewritten', first.publishDate, publishDate);
      recordExecutionQueues(parentBefore, parentHistoryBefore);

      // Stop and restart the candidate while the old parent sleeps for its
      // repeat interval: the next round must still be created after restart.
      await context.rollingRestartOrchestrator();
      observe('worker restarted before the next repeat round', true);
      await temporal.env.sleep(25 * HOUR);

      await waitPublishCount(context, org.organization.id, 2);
      const parentAfter = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      const childId = parentAfter.childWorkflows[0]?.workflowId;
      observe('repeat child workflow id', childId);
      expectEqual('round two was created as a child', parentAfter.childWorkflows[0]?.workflowType, 'postWorkflowV102');
      expectTrue('child id keeps the post prefix', childId?.startsWith(`post_${post.id}_`), childId);

      const child = await describeWorkflow(temporal.client, childId);
      const childHistory = await historySummary(temporal.client, child.workflowId, child.runId);
      observe('second-round execution', child);
      expectEqual('old repeat child is still V102', child.type, 'postWorkflowV102');
      expectEqual('old repeat child runs on main', child.taskQueue, 'main');
      expectEqual('old repeat child keeps the business post id', child.searchAttributes.postId, post.id);
      expectEqual('second round publishes with the old contract', publishesFor(calls, org.organization.id)[1].method, 'post');
      expectEqual('second round targeted the same channel', publishesFor(calls, org.organization.id)[1].integrationId, org.integration.id);
      expectEqual('second-round activity stays on the provider queue', activityOn(childHistory, 'postSocial').taskQueue, 'bluesky');
      recordExecutionQueues(child, childHistory);

      expectEqual('two rounds published twice', publishesFor(calls, org.organization.id).length, 2);
      expectEqual('database still holds the original anchor date', (await snapshotPost(prisma, post.id)).publishDate, publishDate);

      // The child is asleep waiting for a 24h interval; stop it explicitly so
      // it cannot leak into the next scenario's clock.
      if (child.status === 'RUNNING') {
        await temporal.client.workflow
          .getHandle(child.workflowId, child.runId)
          .terminate('rehearsal finished after the restarted round');
      }
    },
  },

  {
    id: 'new-repeat-child-continuity',
    clock: 'skip',
    group: 'new-repeat',
    needsBackend: false,
    description:
      'A repeating post created through the new scheduling path starts V112, publishes round one, survives a worker restart, and keeps creating V112 repeat children; the business anchor date stays put.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const publishDate = iso(3000);
      const post = await seedRepeatPost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate,
        content: 'Synthetic new repeat post',
        intervalInDays: 1,
      });
      const postId = post.id;
      const anchor = (await snapshotPost(prisma, postId)).publishDate;
      // Same start call the scheduling entry makes after saving the row.
      await temporal.client.workflow.start('postWorkflowV112', {
        workflowId: `post_${postId}`,
        taskQueue: 'main',
        args: [
          {
            taskQueue: 'bluesky',
            postId,
            organizationId: org.organization.id,
          },
        ],
        searchAttributes: {
          postId: [postId],
          organizationId: [org.organization.id],
        },
      });
      observe('created repeating post', { postId, anchor });

      const parent = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, `post_${postId}`);
          return !description.error && description.runId ? description : null;
        },
        { label: 'V112 repeat execution' }
      );
      expectEqual('new repeat starts V112', parent.type, 'postWorkflowV112');
      expectEqual('new repeat runs on main', parent.taskQueue, 'main');
      expectEqual('new repeat keeps the business post id', parent.searchAttributes.postId, postId);
      expectEqual('new repeat keeps the organization attribute', parent.searchAttributes.organizationId, org.organization.id);

      await temporal.env.sleep(5000);
      const first = await waitPublished(context, postId);
      await waitPublishCount(context, org.organization.id, 1);
      expectEqual('round one kept the anchor date', first.publishDate, anchor);

      const parentHistory = await historySummary(temporal.client, parent.workflowId, parent.runId);
      recordExecutionQueues(parent, parentHistory);
      expectEqual('round one uses pending/finalize', publishesFor(calls, org.organization.id)[0].method, 'postPending');

      await context.restartOrchestrator();
      await temporal.env.sleep(25 * HOUR);
      await waitPublishCount(context, org.organization.id, 2);
      const parentAfter = await historySummary(temporal.client, parent.workflowId, parent.runId);
      const childId = parentAfter.childWorkflows[0]?.workflowId;
      observe('V112 repeat child id', childId);
      expectEqual('new repeat child is V112', parentAfter.childWorkflows[0]?.workflowType, 'postWorkflowV112');
      const child = await describeWorkflow(temporal.client, childId);
      observe('second V112 round', child);
      expectEqual('second V112 round keeps the post id', child.searchAttributes.postId, postId);
      expectEqual('second V112 round runs on main', child.taskQueue, 'main');

      const childHistory = await historySummary(temporal.client, child.workflowId, child.runId);
      recordExecutionQueues(child, childHistory);
      expectEqual('two rounds published twice', publishesFor(calls, org.organization.id).length, 2);
      expectEqual('the anchor date never moves', (await snapshotPost(prisma, postId)).publishDate, anchor);
      expectEqual(
        'finalize ran for both rounds',
        calls
          .read()
          .filter(
            (call) =>
              call.method === 'finalizePost' &&
              call.integrationId === org.integration.id
          ).length,
        2
      );

      if (child.status === 'RUNNING') {
        await temporal.client.workflow
          .getHandle(child.workflowId, child.runId)
          .terminate('rehearsal finished after the restarted round');
      }
    },
  },

  {
    id: 'autopost-continue-as-new',
    clock: 'skip',
    group: 'autopost',
    needsBackend: false,
    description:
      'autoPostWorkflow runs its first loop for real, creates one draft, then hits the 24-loop continue-as-new boundary and continues with the same workflow id.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal, frontendUrl } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const autopost = await seedAutopost(prisma, {
        organization: org.organization,
        integration: org.integration,
        url: `${frontendUrl}/feed.xml`,
        content: 'Synthetic autopost content',
      });

      const handle = await temporal.client.workflow.start('autoPostWorkflow', {
        workflowId: `autopost-${autopost.id}`,
        taskQueue: 'main',
        args: [{ id: autopost.id, immediately: true }],
      });
      const firstRun = handle.firstExecutionRunId;

      const updated = await waitFor(
        async () => {
          const row = await prisma.autoPost.findUnique({ where: { id: autopost.id } });
          return row?.lastUrl ? row : null;
        },
        { label: 'autopost first loop', timeoutMs: 120_000 }
      );
      observe('autopost first loop', { lastUrl: updated.lastUrl });

      const draftsBefore = await prisma.post.findMany({
        where: { organizationId: org.organization.id, creationMethod: 'AUTOPOST' },
      });
      expectEqual('first loop creates one draft', draftsBefore.length, 1);
      expectEqual('draft stays a DRAFT', draftsBefore[0].state, 'DRAFT');
      expectTrue('draft carries the feed text', draftsBefore[0].content.includes('Synthetic autopost content'));
      expectEqual('autopost never publishes', publishesFor(calls, org.organization.id).length, 0);

      const before = await historySummary(temporal.client, handle.workflowId, firstRun);
      recordExecutionQueues({ taskQueue: 'main' }, before);
      expectEqual('autopost activity runs on main', activityOn(before, 'autoPost').taskQueue, 'main');

      await temporal.env.sleep(25 * HOUR);
      const completed = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, handle.workflowId, firstRun);
          if (description.status !== 'CONTINUED_AS_NEW') return null;
          const history = await historySummary(temporal.client, handle.workflowId, firstRun);
          return history.continuedAsNew ? { description, history } : null;
        },
        { label: 'autopost continue-as-new', timeoutMs: 120_000 }
      );
      observe('autopost continue-as-new history', {
        eventCount: completed.history.eventCount,
        continuedAsNew: completed.history.continuedAsNew,
      });
      expectEqual('first run continued as new once', completed.history.continuedAsNew, 1);

      const successor = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, handle.workflowId);
          return description.runId && description.runId !== firstRun ? description : null;
        },
        { label: 'autopost successor run' }
      );
      observe('autopost successor', successor);
      expectEqual('continue-as-new keeps the workflow id', successor.workflowId, handle.workflowId);
      expectEqual('continue-as-new keeps the workflow type', successor.type, 'autoPostWorkflow');
      expectTrue('successor has a new run id', successor.runId !== firstRun);

      const draftsAfter = await prisma.post.findMany({
        where: { organizationId: org.organization.id, creationMethod: 'AUTOPOST' },
      });
      expectEqual('the same feed item is not drafted twice', draftsAfter.length, 1);
      expectEqual('no platform call came from autopost', publishesFor(calls, org.organization.id).length, 0);

      await temporal.client.workflow
        .getHandle(handle.workflowId)
        .terminate('rehearsal finished with autopost continue-as-new');
    },
  },

  {
    id: 'missing-sweep-continue-as-new',
    clock: 'skip',
    group: 'missing-can',
    needsBackend: false,
    description:
      'missingPostWorkflow sweeps hourly and, after 24 loops, continues as new with the same workflow id and type.',
    async run(context) {
      const { temporal } = context;
      const handle = await temporal.client.workflow.start('missingPostWorkflow', {
        workflowId: 'missing-post-workflow',
        taskQueue: 'main',
        args: [],
      });
      const firstRun = handle.firstExecutionRunId;

      await temporal.env.sleep(25 * HOUR);
      const completed = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, handle.workflowId, firstRun);
          if (description.status !== 'CONTINUED_AS_NEW') return null;
          const history = await historySummary(temporal.client, handle.workflowId, firstRun);
          return history.continuedAsNew ? { description, history } : null;
        },
        { label: 'missing sweep continue-as-new', timeoutMs: 120_000 }
      );
      observe('missing sweep continue-as-new', {
        eventCount: completed.history.eventCount,
        continuedAsNew: completed.history.continuedAsNew,
        sweeps: completed.history.activityScheduled.filter(
          (a) => a.activity === 'searchForMissingThreeHoursPosts'
        ).length,
      });
      expectEqual('sweep continued as new once', completed.history.continuedAsNew, 1);
      expectEqual(
        'sweep keeps running on main',
        activityOn(completed.history, 'searchForMissingThreeHoursPosts').taskQueue,
        'main'
      );
      recordExecutionQueues(completed.description, completed.history);

      const successor = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, handle.workflowId);
          return description.runId && description.runId !== firstRun ? description : null;
        },
        { label: 'missing sweep successor' }
      );
      expectEqual('sweep keeps the workflow id', successor.workflowId, 'missing-post-workflow');
      expectEqual('sweep keeps the workflow type', successor.type, 'missingPostWorkflow');

      await temporal.client.workflow
        .getHandle(handle.workflowId)
        .terminate('rehearsal finished with missing sweep continue-as-new');
    },
  },

  {
    id: 'streak-patch-continue-as-new',
    clock: 'skip',
    group: 'streak',
    needsBackend: false,
    orchestratorEnv: {
      // See stub-provider.cjs: align the synthetic DB timestamp with the
      // time-skipped workflow clock so the real hand-off gate is exercised.
      T16_STREAK_LAST_POST_OFFSET_MS: String(3 * DAY),
    },
    description:
      'streakWorkflow applies both patch gates: no legacy reminder at 22h, and at 24h it continues as new into streakWorkflowV2 instead of ending the streak.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const handle = await temporal.client.workflow.start('streakWorkflow', {
        workflowId: `streak_${org.organization.id}`,
        taskQueue: 'main',
        args: [{ organizationId: org.organization.id }],
      });
      const firstRun = handle.firstExecutionRunId;

      const started = await waitFor(
        async () => {
          const row = await prisma.organization.findUnique({
            where: { id: org.organization.id },
          });
          return row?.streakSince ? row : null;
        },
        { label: 'streak start', timeoutMs: 60_000 }
      );
      expectTrue('streak start is written', !!started.streakSince);

      await temporal.env.sleep(25 * HOUR);
      const completed = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, handle.workflowId, firstRun);
          if (description.status !== 'CONTINUED_AS_NEW') return null;
          const history = await historySummary(temporal.client, handle.workflowId, firstRun);
          return history.continuedAsNew ? { description, history } : null;
        },
        { label: 'streak hand-off', timeoutMs: 120_000 }
      );
      observe('streak first run', {
        eventCount: completed.history.eventCount,
        continuedAsNew: completed.history.continuedAsNew,
        activities: completed.history.activityScheduled.map((a) => a.activity),
      });
      expectEqual('streak continued as new once', completed.history.continuedAsNew, 1);
      expectEqual(
        'streak hand-off runs on main',
        activityOn(completed.history, 'setStreak').taskQueue,
        'main'
      );
      recordExecutionQueues(completed.description, completed.history);

      const successor = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, handle.workflowId);
          return description.runId && description.runId !== firstRun ? description : null;
        },
        { label: 'streak V2 successor' }
      );
      observe('streak successor', successor);
      expectEqual('hand-off keeps the workflow id', successor.workflowId, `streak_${org.organization.id}`);
      expectEqual('hand-off switches to streakWorkflowV2', successor.type, 'streakWorkflowV2');
      expectTrue('successor has a new run id', successor.runId !== firstRun);

      const row = await prisma.organization.findUnique({
        where: { id: org.organization.id },
      });
      expectTrue('hand-off does not end the streak', !!row.streakSince);
      expectEqual(
        'no e-mail was sent on the patched path',
        emails(calls).filter((mail) => mail.to === org.user.email).length,
        0
      );

      await temporal.client.workflow
        .getHandle(handle.workflowId)
        .terminate('rehearsal finished with the streak hand-off');
    },
  },

  {
    id: 'missing-sweep-compensation',
    clock: 'real',
    group: 'real-shared',
    needsBackend: false,
    description:
      'The missing-posts sweep republishes a genuinely stale post once, re-anchors an old repeat anchor to its next occurrence instead of re-sending it, and ignores posts outside the compensation window or on refresh-needed channels.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const normalDate = new Date(Date.now() - 5 * HOUR).toISOString();
      const normal = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: normalDate,
        content: 'Synthetic genuinely stale post',
      });

      const repeatDate = new Date(Date.now() - 25 * HOUR).toISOString();
      const repeat = await seedRepeatPost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: repeatDate,
        content: 'Synthetic stale repeat anchor',
        intervalInDays: 1,
      });

      const tooOld = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: new Date(Date.now() - 3 * DAY).toISOString(),
        content: 'Synthetic post outside the sweep window',
      });

      const refreshChannel = await seedRefreshChannel(prisma, {
        organization: org.organization,
        tokenExpiration: new Date(Date.now() + DAY),
        refreshNeeded: true,
      });
      const refreshPost = await seedStalePost(prisma, {
        organization: org.organization,
        integration: refreshChannel,
        media: org.media,
        publishDate: new Date(Date.now() - 4 * HOUR).toISOString(),
        content: 'Synthetic post on a refresh-needed channel',
      });

      const handle = await temporal.client.workflow.start('missingPostWorkflow', {
        workflowId: `missing_post_${org.organization.id}`,
        taskQueue: 'main',
        args: [],
      });

      const published = await waitPublished(context, normal.id, 120_000);
      observe('swept stale post', published);
      expectEqual('genuinely stale post is published', published.state, 'PUBLISHED');
      expectEqual('sweep keeps the original past date', published.publishDate, normalDate);
      expectEqual('sweep publishes it once', publishesFor(calls, org.organization.id).length, 1);
      expectEqual('sweep uses the new V112 path', publishesFor(calls, org.organization.id)[0].method, 'postPending');

      const sweptHistory = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      recordExecutionQueues({ taskQueue: 'main' }, sweptHistory);
      expectEqual(
        'sweep activity runs on main',
        activityOn(sweptHistory, 'searchForMissingThreeHoursPosts').taskQueue,
        'main'
      );

      // Give the signalWithStart + V112 read a moment, then prove the old
      // repeat anchor was re-anchored instead of re-sent.
      await sleep(6000);
      const repeatRow = await snapshotPost(prisma, repeat.id);
      observe('repeat anchor after the sweep', repeatRow);
      expectEqual('repeat anchor is not republished', repeatRow.state, 'QUEUE');
      expectEqual('repeat anchor date is untouched in the database', repeatRow.publishDate, repeatDate);
      expectEqual(
        'no platform call for the re-anchored repeat post',
        publishesFor(calls, org.organization.id).filter(
          (call) => call.posts?.[0]?.id === repeat.id
        ).length,
        0
      );
      const repeatExecution = await describeWorkflow(temporal.client, `post_${repeat.id}`);
      observe('poked repeat execution', repeatExecution);
      expectEqual('sweep pokes V112 for the repeat post', repeatExecution.type, 'postWorkflowV112');
      const repeatHistory = await historySummary(
        temporal.client,
        repeatExecution.workflowId,
        repeatExecution.runId
      );
      recordExecutionQueues(repeatExecution, repeatHistory);
      expectTrue(
        'repeat execution waits for the next occurrence',
        repeatHistory.timers >= 1,
        JSON.stringify(repeatHistory.timers)
      );

      expectEqual(
        'post outside the two-day window is not swept',
        (await describeWorkflow(temporal.client, `post_${tooOld.id}`)).error !== undefined,
        true
      );
      expectEqual(
        'refresh-needed channel post is not swept',
        (await describeWorkflow(temporal.client, `post_${refreshPost.id}`)).error !== undefined,
        true
      );
      expectEqual('no calls for ignored posts', publishesFor(calls, org.organization.id).length, 1);

      await temporal.client.workflow
        .getHandle(handle.workflowId, handle.firstExecutionRunId)
        .terminate('rehearsal finished with the sweep');
      await temporal.client.workflow
        .getHandle(repeatExecution.workflowId, repeatExecution.runId)
        .terminate('rehearsal finished with the re-anchored repeat');
    },
  },

  {
    id: 'delayed-comments-both-generations',
    clock: 'real',
    group: 'real-shared',
    needsBackend: true,
    description:
      'A delayed comment continues under the candidate for an old V102 execution and a new V112 execution: correct account, comment target, minute delay, write-back and completed workflow.',
    async run(context) {
      const { prisma, calls, backendOrigin, uploadDirectory, temporal } = context;
      const legacyOrg = await seedOrganization(prisma, { uploadDirectory });
      const newOrg = await seedOrganization(prisma, { uploadDirectory });

      const legacyThread = await seedCommentThread(prisma, {
        organization: legacyOrg.organization,
        integration: legacyOrg.integration,
        media: legacyOrg.media,
        publishDate: iso(2500),
        rootContent: 'Synthetic legacy root',
        commentContent: 'Synthetic legacy delayed comment',
        delayMinutes: 1,
      });

      const rootPublishedAt = Date.now();
      await context.stopOrchestrator();
      const legacy = await startLegacyPublishingWorker({
        address: temporal.address,
        prisma,
        calls,
      });
      context.defer(() => legacy.stop());
      const legacyHandle = await temporal.client.workflow.start('postWorkflowV102', {
        workflowId: `post_${legacyThread.root.id}`,
        taskQueue: 'main',
        args: [
          {
            taskQueue: 'bluesky',
            postId: legacyThread.root.id,
            organizationId: legacyOrg.organization.id,
          },
        ],
        searchAttributes: {
          postId: [legacyThread.root.id],
          organizationId: [legacyOrg.organization.id],
        },
      });
      await waitPublished(context, legacyThread.root.id);
      const legacyRootRelease = (await snapshotPost(prisma, legacyThread.root.id)).releaseId;
      observe('legacy root published by the old worker', legacyRootRelease);
      await legacy.stop();
      await context.bootOrchestrator();

      const created = await createPublicPost({
        origin: backendOrigin,
        apiKey: newOrg.organization.apiKey,
        integrationId: newOrg.integration.id,
        date: iso(2000),
        values: [
          { content: 'Synthetic new root', image: [newOrg.media] },
          { content: 'Synthetic new delayed comment', image: [], delay: 1 },
        ],
      });
      expectTrue('root+comment created through the public API', created.status === 201 || created.status === 200, JSON.stringify(created.body));
      const newRootId = created.body[0].postId;
      const newComment = await prisma.post.findFirst({
        where: { parentPostId: newRootId },
      });
      expectTrue('public API created the comment row', !!newComment, newRootId);
      observe('new thread', { root: newRootId, comment: newComment.id });
      await waitPublished(context, newRootId);
      const newRootRelease = (await snapshotPost(prisma, newRootId)).releaseId;

      const commentCalls = await waitFor(
        async () => {
          const list = calls.read().filter((call) => call.method === 'comment');
          const legacyCall = list.find(
            (call) => call.organizationId === legacyOrg.organization.id
          );
          const newCall = list.find(
            (call) => call.organizationId === newOrg.organization.id
          );
          return legacyCall && newCall ? { legacyCall, newCall } : null;
        },
        { label: 'both delayed comments', timeoutMs: 120_000 }
      );

      for (const [label, org, thread, rootRelease, commentCall] of [
        ['legacy', legacyOrg, legacyThread, legacyRootRelease, commentCalls.legacyCall],
        ['new', newOrg, { root: { id: newRootId }, comment: newComment }, newRootRelease, commentCalls.newCall],
      ]) {
        observe(`${label} comment contract`, {
          postId: commentCall.postId,
          lastPostId: commentCall.lastPostId,
          message: commentCall.posts[0]?.message,
          at: commentCall.at,
        });
        expectEqual(`${label} comment targets the root release`, commentCall.postId, rootRelease);
        expectEqual(`${label} first comment has no previous comment`, commentCall.lastPostId, null);
        expectEqual(`${label} comment uses the bound channel credential`, commentCall.token, org.integration.token);
        expectEqual(`${label} comment uses the bound provider account`, commentCall.internalId, org.integration.internalId);
        expectEqual(`${label} comment message is the stored content`, commentCall.posts[0].message, thread.comment.content);
        expectTrue(
          `${label} comment respects the one-minute delay`,
          Date.parse(commentCall.at) - rootPublishedAt >= 55_000,
          `${Date.parse(commentCall.at) - rootPublishedAt}ms`
        );

        const commentRow = await snapshotPost(prisma, thread.comment.id);
        expectEqual(`${label} comment row is PUBLISHED`, commentRow.state, 'PUBLISHED');
        expectTrue(`${label} comment releaseId is written`, !!commentRow.releaseId, JSON.stringify(commentRow));
      }

      const legacyDescription = await describeWorkflow(
        temporal.client,
        legacyHandle.workflowId,
        legacyHandle.firstExecutionRunId
      );
      const legacyHistory = await historySummary(
        temporal.client,
        legacyHandle.workflowId,
        legacyHandle.firstExecutionRunId
      );
      observe('legacy comment execution', legacyDescription);
      expectEqual('legacy comment workflow completed', legacyDescription.status, 'COMPLETED');
      expectEqual('legacy comment activity runs on the provider queue', activityOn(legacyHistory, 'postComment').taskQueue, 'bluesky');
      recordExecutionQueues(legacyDescription, legacyHistory);

      const newDescription = await waitFor(
        async () => {
          const description = await describeWorkflow(temporal.client, `post_${newRootId}`);
          return description.status === 'COMPLETED' ? description : null;
        },
        { label: 'new comment workflow completed' }
      );
      const newHistory = await historySummary(temporal.client, newDescription.workflowId, newDescription.runId);
      observe('new comment execution', newDescription);
      expectEqual('new comment workflow is V112', newDescription.type, 'postWorkflowV112');
      expectEqual('new comment activity runs on the provider queue', activityOn(newHistory, 'postComment').taskQueue, 'bluesky');
      recordExecutionQueues(newDescription, newHistory);

      const comments = commentsFor(calls, legacyOrg.organization.id).length + commentsFor(calls, newOrg.organization.id).length;
      expectEqual('exactly two comment calls', comments, 2);
    },
  },

  {
    id: 'refresh-token-backlog',
    clock: 'real',
    group: 'real-shared',
    needsBackend: false,
    description:
      'The existing refreshTokenWorkflow keeps its workflow id, waits for the token expiry and refreshes through the registered refreshToken activity once; the channel is updated and the workflow keeps waiting for the next expiry.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const integration = await seedRefreshChannel(prisma, {
        organization: org.organization,
        tokenExpiration: new Date(Date.now() + 3000),
      });

      const handle = await temporal.client.workflow.start('refreshTokenWorkflow', {
        workflowId: `refresh_${integration.id}`,
        taskQueue: 'main',
        args: [
          {
            integrationId: integration.id,
            organizationId: org.organization.id,
          },
        ],
      });

      const refreshed = await waitRefresh(context, integration.id, 'synthetic-refreshed-access');
      observe('refreshed channel', {
        id: refreshed.id,
        token: refreshed.token,
        refreshToken: refreshed.refreshToken,
        tokenExpiration: refreshed.tokenExpiration,
        refreshNeeded: refreshed.refreshNeeded,
      });
      expectEqual('refresh keeps the channel id', refreshed.id, integration.id);
      expectTrue('refresh drops the old access token', refreshed.token !== integration.token);
      expectEqual('refresh rotates the refresh token', refreshed.refreshToken, 'synthetic-refresh-rotated');
      expectEqual('refresh clears refreshNeeded', refreshed.refreshNeeded, false);
      expectTrue(
        'refresh stores the new expiry',
        new Date(refreshed.tokenExpiration).getTime() > Date.now(),
        String(refreshed.tokenExpiration)
      );

      const refreshCalls = calls
        .read()
        .filter((call) => call.method === 'refreshToken');
      observe('refresh boundary calls', refreshCalls.map((call) => call.refreshToken));
      expectEqual('exactly one refresh call', refreshCalls.length, 1);
      expectEqual('refresh used the stored refresh token', refreshCalls[0].refreshToken, integration.refreshToken);

      const history = await waitFor(
        async () => {
          const summary = await historySummary(
            temporal.client,
            handle.workflowId,
            handle.firstExecutionRunId
          );
          return summary.activityScheduled.some((a) => a.activity === 'refreshToken')
            ? summary
            : null;
        },
        { label: 'refresh activity history', timeoutMs: 30_000 }
      );
      observe('refresh history', {
        activities: history.activityScheduled,
        timers: history.timers,
      });
      expectEqual('refresh activity runs on main', activityOn(history, 'refreshToken').taskQueue, 'main');
      expectEqual('getIntegrationsById runs on main', activityOn(history, 'getIntegrationsById').taskQueue, 'main');
      const description = await describeWorkflow(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('refresh workflow after the refresh', description);
      expectEqual('refresh workflow is still running for the next expiry', description.status, 'RUNNING');
      recordExecutionQueues(description, history);

      await temporal.client.workflow
        .getHandle(handle.workflowId)
        .terminate('rehearsal finished with the refreshed channel');
    },
  },

  {
    id: 'email-both-generations',
    clock: 'real',
    group: 'real-shared',
    needsBackend: false,
    description:
      'The old sendEmailWorkflow backlog drains through main, and new sendSingleEmailWorkflow runs deliver through the email and email-bulk activity queues; all five messages reach the mail stub once and the per-email workflows complete.',
    async run(context) {
      const { calls, temporal } = context;

      const backlog = await temporal.client.workflow.start('sendEmailWorkflow', {
        workflowId: 'send_email',
        taskQueue: 'main',
        args: [{ queue: [] }],
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
      for (const [to, addTo] of [
        ['legacy-top@synthetic.invalid', 'top'],
        ['legacy-bulk-one@synthetic.invalid', 'bottom'],
        ['legacy-bulk-two@synthetic.invalid', 'bottom'],
      ]) {
        await backlog.signal('sendEmail', {
          to,
          subject: `Synthetic legacy ${to}`,
          html: `<p>${to}</p>`,
          addTo,
        });
      }

      const legacySent = await waitFor(
        async () => {
          const list = emails(calls).filter((mail) => mail.to.startsWith('legacy-'));
          return list.length >= 3 ? list : null;
        },
        { label: 'legacy e-mail backlog', timeoutMs: 90_000 }
      );
      observe('legacy e-mails', legacySent.map((mail) => mail.to));
      expectEqual('legacy backlog delivered three messages', legacySent.length, 3);
      expectEqual('legacy top message is first', legacySent[0].to, 'legacy-top@synthetic.invalid');

      const legacyHistory = await historySummary(
        temporal.client,
        backlog.workflowId,
        backlog.firstExecutionRunId
      );
      recordExecutionQueues({ taskQueue: 'main' }, legacyHistory);
      expectEqual('legacy e-mail activity runs on main', activityOn(legacyHistory, 'sendEmail').taskQueue, 'main');
      const legacyDescription = await describeWorkflow(
        temporal.client,
        backlog.workflowId,
        backlog.firstExecutionRunId
      );
      expectEqual('legacy backlog stays alive for more signals', legacyDescription.status, 'RUNNING');

      const priority = await temporal.client.workflow.start('sendSingleEmailWorkflow', {
        workflowId: `send_email_priority_${Date.now().toString(36)}`,
        taskQueue: 'main',
        args: [
          {
            to: 'new-priority@synthetic.invalid',
            subject: 'Synthetic priority e-mail',
            html: '<p>priority</p>',
            addTo: 'top',
          },
        ],
      });
      const bulk = await temporal.client.workflow.start('sendSingleEmailWorkflow', {
        workflowId: `send_email_bulk_${Date.now().toString(36)}`,
        taskQueue: 'main',
        args: [
          {
            to: 'new-bulk@synthetic.invalid',
            subject: 'Synthetic bulk e-mail',
            html: '<p>bulk</p>',
            addTo: 'bottom',
          },
        ],
      });

      const scenarioSent = () =>
        emails(calls).filter(
          (mail) =>
            mail.to.startsWith('legacy-') || mail.to.startsWith('new-')
        );
      const allSent = await waitFor(
        async () => {
          const list = scenarioSent();
          return list.length >= 5 ? list : null;
        },
        { label: 'new per-email delivery', timeoutMs: 90_000 }
      );
      observe('all e-mails', allSent.map((mail) => ({ to: mail.to, subject: mail.subject })));
      expectEqual('all five scenario messages reached the mail stub', allSent.length, 5);
      expectEqual(
        'new priority e-mail delivered',
        allSent.filter((mail) => mail.to === 'new-priority@synthetic.invalid').length,
        1
      );
      expectEqual(
        'new bulk e-mail delivered',
        allSent.filter((mail) => mail.to === 'new-bulk@synthetic.invalid').length,
        1
      );

      for (const [label, handle, queue] of [
        ['priority', priority, 'email'],
        ['bulk', bulk, 'email-bulk'],
      ]) {
        const description = await waitFor(
          async () => {
            const value = await describeWorkflow(temporal.client, handle.workflowId, handle.firstExecutionRunId);
            return value.status === 'COMPLETED' ? value : null;
          },
          { label: `${label} e-mail completion` }
        );
        const history = await historySummary(temporal.client, description.workflowId, description.runId);
        observe(`${label} e-mail workflow`, description);
        expectEqual(`${label} e-mail workflow completed`, description.status, 'COMPLETED');
        expectEqual(`${label} e-mail uses the ${queue} activity queue`, activityOn(history, 'sendEmail').taskQueue, queue);
        recordExecutionQueues(description, history);
      }

      await context.restartOrchestrator();
      await sleep(4000);
      expectEqual('restart does not resend any e-mail', scenarioSent().length, 5);

      await temporal.client.workflow
        .getHandle(backlog.workflowId)
        .terminate('rehearsal finished with the legacy backlog');
    },
  },

  {
    id: 'provider-queue-workflow-compat',
    clock: 'real',
    group: 'real-shared',
    needsBackend: false,
    description:
      'A synthetic old execution whose task queue is the provider queue stays untouched while provider workers are activity-only; after COMPAT_WORKFLOW_QUEUES names that queue, the same compatible bundle consumes it and publishes once.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const publishDate = iso(2000);
      const post = await seedStalePost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate,
        content: 'Synthetic provider-queue workflow',
      });

      const handle = await temporal.client.workflow.start('postWorkflowV102', {
        workflowId: `post_${post.id}`,
        taskQueue: 'bluesky',
        args: [
          {
            taskQueue: 'bluesky',
            postId: post.id,
            organizationId: org.organization.id,
          },
        ],
        searchAttributes: {
          postId: [post.id],
          organizationId: [org.organization.id],
        },
      });

      await sleep(4000);
      const untouched = await describeWorkflow(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      const untouchedHistory = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('provider-queue execution without compat', {
        status: untouched.status,
        events: untouchedHistory.eventCount,
        activities: untouchedHistory.activityScheduled,
      });
      expectEqual('provider queue does not consume workflows by default', untouched.status, 'RUNNING');
      expectEqual('no activity was scheduled without a workflow worker', untouchedHistory.activityScheduled.length, 0);
      expectEqual('the synthetic provider workflow did not publish', publishesFor(calls, org.organization.id).length, 0);
      expectEqual('the post is still QUEUE', (await snapshotPost(prisma, post.id)).state, 'QUEUE');

      await context.stopOrchestrator();
      await context.bootOrchestrator({ COMPAT_WORKFLOW_QUEUES: 'bluesky' });
      observe('compatible provider worker enabled', 'COMPAT_WORKFLOW_QUEUES=bluesky');

      const published = await waitPublished(context, post.id);
      const publishes = await waitPublishCount(context, org.organization.id, 1);
      observe('provider-queue publish', publishes[0]);
      expectEqual('compatible worker publishes once', published.state, 'PUBLISHED');
      expectEqual('provider-queue execution keeps the old type', publishes[0].method, 'post');

      const description = await waitWorkflowStatus(
        context,
        handle.workflowId,
        handle.firstExecutionRunId,
        'COMPLETED'
      );
      const history = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('provider-queue execution after compat', description);
      expectEqual('provider-queue workflow completed', description.status, 'COMPLETED');
      expectEqual('workflow id is unchanged', description.workflowId, `post_${post.id}`);
      expectEqual('workflow type is unchanged', description.type, 'postWorkflowV102');
      expectEqual('workflow still runs on the provider queue', description.taskQueue, 'bluesky');
      expectEqual('business post id is unchanged', description.searchAttributes.postId, post.id);
      expectEqual('publishing activity stayed on the provider queue', activityOn(history, 'postSocial').taskQueue, 'bluesky');
      // A pre-existing provider-queue workflow defaults its non-proxy
      // activities to that same queue; the compatible worker must register
      // both the workflow bundle and all activity classes there.
      expectEqual(
        'database activity follows the workflow queue',
        activityOn(history, 'getPostsList').taskQueue,
        'bluesky'
      );
      recordExecutionQueues(description, history);
    },
  },
];
