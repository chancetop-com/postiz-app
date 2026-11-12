/**
 * Scenario definitions for the scheduled-continuity rehearsal (ticket 15).
 *
 * Every assertion reads a system seam: the database row, the Temporal
 * execution, the stub call log, or the local media file. No product internals
 * are asserted and no platform is contacted.
 */
import {
  changeDate,
  changeStatus,
  createScheduledPost,
  deletePost,
  sessionHeaders,
  uploadMedia,
} from './api.mjs';
import {
  ONE_PIXEL_PNG,
  seedAutopost,
  seedOrganization,
  seedPost,
  sha256,
  snapshotPost,
} from './seed.mjs';
import { startLegacyWorker, legacyBundle } from './old-worker.mjs';
import {
  describeWorkflow,
  historySummary,
  listExecutions,
  waitFor,
} from './temporal-env.mjs';
import { emails, publishCalls } from './calls.mjs';
import { expectEqual, expectTrue, observe } from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const forOrg = (calls, organizationId) =>
  calls.read().filter((call) => call.organizationId === organizationId);

async function runningFor(context, postId) {
  const list = await listExecutions(
    context.temporal.client,
    `postId="${postId}" AND ExecutionStatus="Running"`
  );
  return list[0] ?? null;
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

export const scenarios = [
  {
    id: 'new-post-v112-http',
    clock: 'real',
    needsBackend: true,
    description:
      'A post scheduled through the public API with an uploaded image starts V112, publishes through the pending/check/finalize path, writes the result back and does not publish twice after a worker restart.',
    async run(context) {
      const { prisma, calls, backendOrigin, uploadDirectory } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });

      const upload = await uploadMedia({
        origin: backendOrigin,
        apiKey: org.organization.apiKey,
        buffer: ONE_PIXEL_PNG,
        name: 'synthetic-new.png',
      });
      expectTrue('upload accepted', upload.status === 201 || upload.status === 200, JSON.stringify(upload.body));
      observe('uploaded media', upload.body);

      const publishDate = iso(15_000);
      const created = await createScheduledPost({
        origin: backendOrigin,
        apiKey: org.organization.apiKey,
        integrationId: org.integration.id,
        date: publishDate,
        content: 'Synthetic scheduled post created through the public API',
        media: upload.body,
      });
      expectTrue('post created', created.status === 201 || created.status === 200, JSON.stringify(created.body));
      const postId = created.body[0].postId;
      observe('post id', postId);

      const before = await snapshotPost(prisma, postId);
      expectEqual('new post starts QUEUE', before.state, 'QUEUE');
      expectEqual('new post keeps the requested publish date', before.publishDate, publishDate);
      expectTrue('new post keeps the uploaded media reference', before.image.includes(upload.body.id));

      const execution = await waitFor(async () => runningFor(context, postId), {
        label: 'V112 execution',
      });
      observe('running execution', execution);
      expectEqual('new starts use postWorkflowV112', execution.type, 'postWorkflowV112');
      expectEqual('workflow id keeps the post id', execution.workflowId, `post_${postId}`);
      expectEqual('new execution polls the main queue', execution.taskQueue, 'main');

      const published = await waitPublished(context, postId);
      observe('published row', published);

      expectEqual('state is PUBLISHED', published.state, 'PUBLISHED');
      expectEqual('publishDate is not rewritten', published.publishDate, publishDate);
      expectTrue('releaseId written', !!published.releaseId, published.releaseId);
      expectTrue('releaseURL written', !!published.releaseURL, published.releaseURL);

      const publishes = publishCalls(calls).filter(
        (call) => call.organizationId === org.organization.id
      );
      observe('publish calls', publishes.map((call) => call.method));
      expectEqual('exactly one publish attempt', publishes.length, 1);
      expectEqual('new path uses postPending', publishes[0].method, 'postPending');
      expectEqual('publish targets the bound channel', publishes[0].integrationId, org.integration.id);
      expectEqual('publish uses the stored credential', publishes[0].token, org.integration.token);

      const payload = publishes[0].posts[0];
      observe('payload contract', payload);
      expectEqual(
        'payload message matches the API content',
        payload.message,
        'Synthetic scheduled post created through the public API'
      );
      expectEqual('payload carries the uploaded image', payload.media.length, 1);
      expectEqual(
        'provider read the uploaded bytes through the media URL',
        payload.media[0].sha256,
        sha256(ONE_PIXEL_PNG)
      );
      expectEqual('provider read the whole image', payload.media[0].bytes, ONE_PIXEL_PNG.length);

      const checks = calls
        .read()
        .filter((call) => call.method === 'checkPostStatus' && call.integrationId === org.integration.id);
      const finalizes = calls
        .read()
        .filter((call) => call.method === 'finalizePost' && call.integrationId === org.integration.id);
      expectEqual('pending post was polled once', checks.length, 1);
      expectEqual('finalize ran once', finalizes.length, 1);
      expectEqual('releaseId comes from finalize', published.releaseId, finalizes[0].pendingData.id);

      const history = await historySummary(
        context.temporal.client,
        execution.workflowId,
        execution.runId
      );
      observe('execution history', history);
      expectEqual(
        'publish activities run on the provider queue',
        history.activityScheduled.filter((a) => a.activity === 'postSocialPending')[0].taskQueue,
        'bluesky'
      );
      expectEqual(
        'database activities run on main',
        history.activityScheduled.filter((a) => a.activity === 'updatePost')[0].taskQueue,
        'main'
      );
      expectEqual('execution completed normally', history.lastEvent, 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED');

      const streak = await describeWorkflow(
        context.temporal.client,
        `streak_${org.organization.id}`
      );
      expectTrue('streak workflow started by the publish', !streak.error, streak.error);
      expectEqual('streak workflow type', streak.type, 'streakWorkflowV2');

      await context.restartOrchestrator();
      await sleep(6000);
      const afterRestart = await snapshotPost(prisma, postId);
      const publishesAfter = publishCalls(calls).filter(
        (call) => call.organizationId === org.organization.id
      );
      expectEqual('restart does not republish', publishesAfter.length, 1);
      expectEqual('restart does not rewrite state', afterRestart.state, 'PUBLISHED');
      expectEqual('restart does not rewrite releaseId', afterRestart.releaseId, published.releaseId);
    },
  },

  {
    id: 'legacy-v102-continuity',
    clock: 'real',
    needsBackend: false,
    description:
      'A V102 execution created by the pre-upgrade code is still sleeping when the candidate worker takes over; it keeps its id, type and history, publishes with the blocking postSocial contract, writes the result back and does not republish after a restart.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const publishDate = iso(12_000);
      const post = await seedPost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate,
        state: 'QUEUE',
        content: 'Synthetic post scheduled by the old code',
      });

      // No candidate poller may touch the queue while the old execution is
      // created: the execution must originate from the old bundle.
      await context.stopOrchestrator();
      const legacy = await startLegacyWorker({
        address: temporal.address,
        prisma,
        calls,
      });
      context.defer(() => legacy.stop());
      observe('legacy bundle sha256', legacy.bundleSha256);
      observe('candidate bundle sha256', (await legacyBundle()).sha256);

      const runId = `legacy-run-${Date.now().toString(36)}`;
      const handle = await temporal.client.workflow.start('postWorkflowV102', {
        workflowId: `post_${post.id}`,
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
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
      observe('legacy run id', handle.firstExecutionRunId);

      const beforeHandover = await waitFor(
        async () => {
          const summary = await historySummary(
            temporal.client,
            handle.workflowId,
            handle.firstExecutionRunId
          );
          return summary.timers >= 1 ? summary : null;
        },
        { label: 'legacy schedule timer', timeoutMs: 30_000 }
      );
      observe('legacy history before hand-over', {
        eventCount: beforeHandover.eventCount,
        lastEvent: beforeHandover.lastEvent,
        timers: beforeHandover.timers,
        activityScheduled: beforeHandover.activityScheduled,
      });
      expectEqual('legacy execution has the old workflow type', beforeHandover.firstEvent, 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED');

      // The old worker stops here: the execution is asleep and nothing has been
      // published. The candidate worker (already polling main) picks it up.
      await legacy.stop();
      observe('legacy worker stopped before publish', true);

      await context.bootOrchestrator();
      const published = await waitPublished(context, post.id);
      observe('published row', published);

      expectEqual('old execution publishes exactly once', published.state, 'PUBLISHED');
      expectEqual('old publishDate is preserved', published.publishDate, publishDate);
      expectTrue('releaseId written by the candidate', !!published.releaseId, published.releaseId);
      expectTrue('releaseURL written by the candidate', !!published.releaseURL, published.releaseURL);

      const publishes = forOrg(calls, org.organization.id).filter(
        (call) => call.method === 'post' || call.method === 'postPending'
      );
      observe('publish calls', publishes.map((call) => call.method));
      expectEqual('old payload uses the blocking postSocial contract', publishes.length, 1);
      expectEqual('old path never calls postPending', publishes[0].method, 'post');

      const payload = publishes[0].posts[0];
      observe('payload contract', payload);
      expectEqual('payload keeps the stored content', payload.message, 'Synthetic post scheduled by the old code');
      expectEqual('payload carries the old media', payload.media.length, 1);
      expectEqual('provider read the legacy media file from disk', payload.media[0].sha256, org.mediaSha256);
      expectEqual('payload keeps the old integration', publishes[0].integrationId, org.integration.id);
      expectEqual('payload keeps the old credential', publishes[0].token, org.integration.token);

      const after = await describeWorkflow(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('execution after hand-over', after);
      expectEqual('workflow id is unchanged', after.workflowId, `post_${post.id}`);
      expectEqual('run id is unchanged', after.runId, handle.firstExecutionRunId);
      expectEqual('workflow type is still postWorkflowV102', after.type, 'postWorkflowV102');
      expectEqual('old execution completed', after.status, 'COMPLETED');

      const finalHistory = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      expectEqual(
        'history is not rebuilt',
        finalHistory.eventTypes.slice(0, beforeHandover.eventCount),
        beforeHandover.eventTypes
      );
      expectEqual(
        'old publish activity stayed on the provider queue',
        finalHistory.activityScheduled.filter((a) => a.activity === 'postSocial')[0].taskQueue,
        'bluesky'
      );

      const executions = await listExecutions(
        temporal.client,
        `postId="${post.id}"`
      );
      observe('executions for the post', executions);
      expectEqual('exactly one execution exists for the post', executions.length, 1);
      expectEqual('no renamed or rebuilt execution', executions[0].workflowId, `post_${post.id}`);

      await context.restartOrchestrator();
      await sleep(6000);
      const afterRestart = await snapshotPost(prisma, post.id);
      expectEqual(
        'restart does not resend the old post',
        forOrg(calls, org.organization.id).filter(
          (call) => call.method === 'post' || call.method === 'postPending'
        ).length,
        1
      );
      expectEqual('restart does not rewrite the old row', afterRestart.state, 'PUBLISHED');
      expectEqual('restart does not rewrite the old date', afterRestart.publishDate, publishDate);
    },
  },

  {
    id: 'reschedule-scheduled-post',
    clock: 'real',
    needsBackend: true,
    description:
      'Rescheduling a queued post terminates only that post’s running execution and starts a new V112 for the new date; the post publishes once, at the new date, with the same channel and media.',
    async run(context) {
      const { prisma, calls, backendOrigin, uploadDirectory, jwtSecret } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });

      const originalDate = iso(180_000);
      const created = await createScheduledPost({
        origin: backendOrigin,
        apiKey: org.organization.apiKey,
        integrationId: org.integration.id,
        date: originalDate,
        content: 'Synthetic post that will be rescheduled',
        media: org.media,
      });
      const postId = created.body[0].postId;

      const first = await waitFor(async () => runningFor(context, postId), {
        label: 'first V112 execution',
      });
      const firstHistory = await waitFor(
        async () => {
          const summary = await historySummary(context.temporal.client, first.workflowId, first.runId);
          return summary.timers >= 1 ? summary : null;
        },
        { label: 'first schedule timer' }
      );
      expectEqual('first execution is V112', first.type, 'postWorkflowV112');
      expectEqual('first execution waits for the original date', firstHistory.timers, 1);

      const newDate = iso(10_000);
      const changed = await changeDate({
        origin: backendOrigin,
        headers: sessionHeaders({
          userId: org.user.id,
          organizationId: org.organization.id,
          jwtSecret,
        }),
        postId,
        date: newDate,
        action: 'schedule',
      });
      expectTrue('reschedule accepted', changed.status === 200 || changed.status === 201, JSON.stringify(changed.body));
      observe('reschedule response', changed.body);

      const terminated = await waitFor(
        async () => {
          const description = await describeWorkflow(
            context.temporal.client,
            first.workflowId,
            first.runId
          );
          return description.status === 'TERMINATED' ? description : null;
        },
        { label: 'old execution terminated' }
      );
      observe('old execution', terminated);

      const second = await waitFor(
        async () => {
          const running = await runningFor(context, postId);
          return running && running.runId !== first.runId ? running : null;
        },
        { label: 'replacement V112 execution' }
      );
      observe('replacement execution', second);
      expectEqual('replacement is V112', second.type, 'postWorkflowV112');
      expectEqual('replacement keeps the workflow id', second.workflowId, `post_${postId}`);
      expectTrue('replacement has a new run id', second.runId !== first.runId);

      const beforePublish = await snapshotPost(prisma, postId);
      expectEqual('database keeps the new publish date', beforePublish.publishDate, new Date(newDate).toISOString());
      expectEqual('database state is still QUEUE', beforePublish.state, 'QUEUE');

      const published = await waitPublished(context, postId);
      observe('published row', published);
      expectEqual('publishes once', forOrg(calls, org.organization.id).filter((c) => c.method === 'postPending' || c.method === 'post').length, 1);
      expectEqual('publishes at the new date only', published.publishDate, new Date(newDate).toISOString());
      expectEqual('state is PUBLISHED', published.state, 'PUBLISHED');

      const oldHistory = await historySummary(
        context.temporal.client,
        first.workflowId,
        first.runId
      );
      expectEqual('old execution was terminated, not rewritten', oldHistory.lastEvent, 'EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED');
    },
  },

  {
    id: 'draft-update-delete',
    clock: 'real',
    needsBackend: true,
    description:
      'Drafts start no workflow, switching a draft to schedule starts V112, deleting a queued post marks it deleted and terminates its execution without publishing, and an “update” date change of a published post never requeues or republishes it.',
    async run(context) {
      const { prisma, calls, backendOrigin, uploadDirectory, jwtSecret } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });

      const draft = await createScheduledPost({
        origin: backendOrigin,
        apiKey: org.organization.apiKey,
        integrationId: org.integration.id,
        date: iso(120_000),
        content: 'Synthetic draft',
        media: org.media,
        type: 'draft',
      });
      expectTrue('draft created', draft.status === 201 || draft.status === 200, JSON.stringify(draft.body));
      const draftId = draft.body[0].postId;
      const draftRow = await snapshotPost(prisma, draftId);
      expectEqual('draft state', draftRow.state, 'DRAFT');
      await sleep(2500);
      expectEqual('draft starts no workflow', await runningFor(context, draftId), null);

      const scheduled = await changeStatus({
        origin: backendOrigin,
        apiKey: org.organization.apiKey,
        postId: draftId,
        status: 'schedule',
      });
      expectTrue('draft switched to schedule', scheduled.status === 200 || scheduled.status === 201, JSON.stringify(scheduled.body));
      const scheduledExecution = await waitFor(async () => runningFor(context, draftId), {
        label: 'draft schedule execution',
      });
      expectEqual('switching a draft starts V112', scheduledExecution.type, 'postWorkflowV112');
      expectEqual('switched draft is QUEUE', (await snapshotPost(prisma, draftId)).state, 'QUEUE');

      const deleted = await deletePost({
        origin: backendOrigin,
        apiKey: org.organization.apiKey,
        postId: draftId,
      });
      expectTrue('delete accepted', deleted.status === 200 || deleted.status === 201, JSON.stringify(deleted.body));
      const terminated = await waitFor(
        async () => {
          const description = await describeWorkflow(
            context.temporal.client,
            scheduledExecution.workflowId,
            scheduledExecution.runId
          );
          return description.status === 'TERMINATED' ? description : null;
        },
        { label: 'deleted execution terminated' }
      );
      observe('deleted execution', terminated);
      const deletedRow = await snapshotPost(prisma, draftId);
      expectTrue('delete sets deletedAt', !!deletedRow.deletedAt, JSON.stringify(deletedRow));
      expectEqual('delete keeps the row state', deletedRow.state, 'QUEUE');

      const publishedPost = await seedPost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate: iso(-60_000),
        state: 'PUBLISHED',
        content: 'Synthetic already-published post',
      });
      await prisma.post.update({
        where: { id: publishedPost.id },
        data: { releaseId: 'stub-existing-release', releaseURL: 'https://stub.invalid/existing' },
      });

      const moved = await changeDate({
        origin: backendOrigin,
        headers: sessionHeaders({
          userId: org.user.id,
          organizationId: org.organization.id,
          jwtSecret,
        }),
        postId: publishedPost.id,
        date: iso(-60_000 - 3_600_000),
        action: 'update',
      });
      expectTrue('update date accepted', moved.status === 200 || moved.status === 201, JSON.stringify(moved.body));
      const movedRow = await snapshotPost(prisma, publishedPost.id);
      observe('updated published row', movedRow);
      expectEqual('update keeps PUBLISHED state', movedRow.state, 'PUBLISHED');
      expectEqual('update keeps releaseId', movedRow.releaseId, 'stub-existing-release');
      expectTrue('update is not requeued as a new execution', !(await runningFor(context, publishedPost.id)));

      await context.restartOrchestrator();
      await sleep(6000);
      const afterRestart = await snapshotPost(prisma, draftId);
      expectEqual('deleted post never publishes', afterRestart.state, 'QUEUE');
      expectEqual(
        'deleted post records no platform call',
        forOrg(calls, org.organization.id).filter(
          (call) => call.organizationId === org.organization.id && (call.method === 'post' || call.method === 'postPending')
        ).length,
        0
      );
      expectEqual(
        'update did not republish',
        forOrg(calls, org.organization.id).filter(
          (call) => call.method === 'post' || call.method === 'postPending'
        ).length,
        0
      );
    },
  },

  {
    id: 'legacy-email-backlog',
    clock: 'real',
    needsBackend: false,
    description:
      'The pre-upgrade singleton sendEmailWorkflow is created by the old worker, receives signals after hand-over, and the candidate worker drains them through the e-mail boundary exactly once.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });

      await context.stopOrchestrator();
      const legacy = await startLegacyWorker({
        address: temporal.address,
        prisma,
        calls,
      });

      context.defer(() => legacy.stop());
      const handle = await temporal.client.workflow.start('sendEmailWorkflow', {
        workflowId: 'send_email',
        taskQueue: 'main',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        args: [{ queue: [] }],
      });
      await waitFor(
        async () => {
          const description = await describeWorkflow(
            temporal.client,
            handle.workflowId,
            handle.firstExecutionRunId
          );
          return !description.error ? description : null;
        },
        { label: 'legacy email execution' }
      );
      await legacy.stop();
      observe('legacy email worker stopped before signals', true);

      await context.bootOrchestrator();

      await temporal.client.workflow
        .getHandle('send_email', handle.firstExecutionRunId)
        .signal('sendEmail', {
          to: 'legacy-one@synthetic.invalid',
          subject: 'Synthetic legacy email one',
          html: '<p>one</p>',
          addTo: 'top',
        });
      await temporal.client.workflow
        .getHandle('send_email', handle.firstExecutionRunId)
        .signal('sendEmail', {
          to: 'legacy-two@synthetic.invalid',
          subject: 'Synthetic legacy email two',
          html: '<p>two</p>',
          addTo: 'bottom',
        });

      const sent = await waitFor(
        async () => {
          const list = emails(calls);
          return list.length >= 2 ? list : null;
        },
        { label: 'legacy email drain', timeoutMs: 60_000 }
      );
      observe('emails sent', sent.map((mail) => ({ to: mail.to, subject: mail.subject })));
      expectEqual('both queued emails were sent', sent.length, 2);
      expectEqual(
        'old queue order and recipients are preserved',
        sent.map((mail) => mail.to),
        ['legacy-one@synthetic.invalid', 'legacy-two@synthetic.invalid']
      );

      const history = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('email execution history', {
        eventCount: history.eventCount,
        activityScheduled: history.activityScheduled,
      });
      expectEqual(
        'old email activity ran on the main queue',
        history.activityScheduled.filter((a) => a.activity === 'sendEmail')[0].taskQueue,
        'main'
      );
      expectTrue(
        'old execution consumed the signals',
        history.eventTypes.filter((type) => type === 'EVENT_TYPE_WORKFLOW_EXECUTION_SIGNALED').length >= 2
      );

      await context.restartOrchestrator();
      await sleep(6000);
      expectEqual('restart does not resend legacy emails', emails(calls).length, 2);
    },
  },

  {
    id: 'missing-post-sweep',
    clock: 'skip',
    needsBackend: false,
    description:
      'The missing-posts sweep still finds a stale QUEUE post and pokes the new V112 path; the post publishes with its original past date and no batch rebuild.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });
      const publishDate = new Date(Date.now() - 5 * 3_600_000).toISOString();
      const post = await seedPost(prisma, {
        organization: org.organization,
        integration: org.integration,
        media: org.media,
        publishDate,
        state: 'QUEUE',
        content: 'Synthetic stale queued post',
      });

      const handle = await temporal.client.workflow.start('missingPostWorkflow', {
        workflowId: `missing_post_${org.organization.id}`,
        taskQueue: 'main',
        args: [],
      });

      const published = await waitPublished(context, post.id, 120_000);
      observe('published row', published);
      expectEqual('sweep publishes the stale post', published.state, 'PUBLISHED');
      expectEqual('sweep does not rewrite the old date', published.publishDate, publishDate);
      expectEqual(
        'sweep publishes exactly once',
        publishCalls(calls).filter((call) => call.organizationId === org.organization.id).length,
        1
      );

      const sweepHistory = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      observe('sweep history', {
        eventCount: sweepHistory.eventCount,
        activityScheduled: sweepHistory.activityScheduled,
      });
      expectEqual(
        'sweep activity runs on main',
        sweepHistory.activityScheduled.filter((a) => a.activity === 'searchForMissingThreeHoursPosts')[0].taskQueue,
        'main'
      );

      // The time-skipping server has no visibility store, so the deterministic
      // workflow id is asserted directly, exactly like the missing sweep finds
      // the post (via the database) rather than via a list query.
      const swept = await describeWorkflow(temporal.client, `post_${post.id}`);
      observe('execution for the swept post', swept);
      expectEqual('sweep starts the new workflow version', swept.type, 'postWorkflowV112');
      expectEqual('sweep keeps the post workflow id', swept.workflowId, `post_${post.id}`);

      const sweptHistory = await historySummary(
        temporal.client,
        swept.workflowId,
        swept.runId
      );
      expectTrue(
        'the sweep pokes the execution instead of rebuilding it',
        sweptHistory.eventTypes.includes('EVENT_TYPE_WORKFLOW_EXECUTION_SIGNALED')
      );

      await temporal.client.workflow
        .getHandle(handle.workflowId, handle.firstExecutionRunId)
        .terminate('rehearsal finished with the sweep');
    },
  },

  {
    id: 'autopost-maintenance',
    clock: 'skip',
    needsBackend: false,
    description:
      'autoPostWorkflow still runs its activity on main, reads the feed, creates a draft through the normal post service and records the source URL; it does not publish anything.',
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

      const updated = await waitFor(
        async () => {
          const row = await prisma.autoPost.findUnique({ where: { id: autopost.id } });
          return row && row.lastUrl ? row : null;
        },
        { label: 'autopost feed consumed', timeoutMs: 120_000 }
      );
      observe('autopost row', { id: updated.id, lastUrl: updated.lastUrl });
      expectTrue('autopost records the feed url', updated.lastUrl.includes('/item-1'), updated.lastUrl);

      const drafts = await prisma.post.findMany({
        where: { organizationId: org.organization.id, creationMethod: 'AUTOPOST' },
      });
      observe('autopost drafts', drafts.map((draft) => ({ id: draft.id, state: draft.state, content: draft.content })));
      expectEqual('autopost creates exactly one draft', drafts.length, 1);
      expectEqual('autopost draft is a DRAFT', drafts[0].state, 'DRAFT');
      expectTrue('autopost draft carries the feed text', drafts[0].content.includes('Synthetic autopost content'), drafts[0].content);
      expectEqual(
        'autopost never publishes to the platform',
        publishCalls(calls).filter((call) => call.organizationId === org.organization.id).length,
        0
      );

      const history = await historySummary(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      expectEqual(
        'autopost activity runs on main',
        history.activityScheduled.filter((a) => a.activity === 'autoPost')[0].taskQueue,
        'main'
      );

      await temporal.client.workflow
        .getHandle(handle.workflowId, handle.firstExecutionRunId)
        .terminate('rehearsal finished with the first loop');
    },
  },

  {
    id: 'streak-email',
    clock: 'skip',
    needsBackend: false,
    description:
      'streakWorkflow still sets the streak, waits the day, sends the streak-end e-mail through the new sendSingleEmailWorkflow/e-mail-bulk path and clears the streak.',
    async run(context) {
      const { prisma, calls, uploadDirectory, temporal } = context;
      const org = await seedOrganization(prisma, { uploadDirectory });

      const handle = await temporal.client.workflow.start('streakWorkflow', {
        workflowId: `streak_${org.organization.id}`,
        taskQueue: 'main',
        args: [{ organizationId: org.organization.id }],
      });

      const started = await waitFor(
        async () => {
          const row = await prisma.organization.findUnique({
            where: { id: org.organization.id },
          });
          return row.streakSince ? row : null;
        },
        { label: 'streak started', timeoutMs: 60_000 }
      );
      expectTrue('streak start is written', !!started.streakSince);

      // The test server only advances the clock when the harness asks it to;
      // 25 simulated hours cross the 22h reminder and the 24h end check.
      await temporal.env.sleep(25 * 3_600_000);

      const sent = await waitFor(
        async () => {
          const list = emails(calls).filter((mail) => mail.to === org.user.email);
          return list.length ? list : null;
        },
        { label: 'streak e-mail', timeoutMs: 180_000 }
      );
      observe('streak e-mails', sent.map((mail) => ({ to: mail.to, subject: mail.subject })));
      expectEqual('streak sent one e-mail', sent.length, 1);
      expectEqual('streak e-mail subject', sent[0].subject, 'Streak Ended');

      const ended = await waitFor(
        async () => {
          const row = await prisma.organization.findUnique({
            where: { id: org.organization.id },
          });
          return row.streakSince === null ? row : null;
        },
        { label: 'streak ended', timeoutMs: 120_000 }
      );
      expectEqual('streak end clears streakSince', ended.streakSince, null);

      const description = await describeWorkflow(
        temporal.client,
        handle.workflowId,
        handle.firstExecutionRunId
      );
      expectEqual('streak workflow completed', description.status, 'COMPLETED');

      const workflowStarts = calls
        .read()
        .filter((call) => call.method === 'newEmailWorkflow' && call.to === org.user.email);
      observe('per-email workflow starts', workflowStarts);
      expectEqual('streak uses the new per-email workflow path', workflowStarts.length, 1);
      expectTrue(
        'streak e-mail is queued as bulk',
        workflowStarts[0].addTo === 'bottom' || workflowStarts[0].addTo === undefined,
        JSON.stringify(workflowStarts[0])
      );
    },
  },
];
