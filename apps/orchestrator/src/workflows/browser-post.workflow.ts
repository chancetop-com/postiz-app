import {
  continueAsNew,
  patched,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import type { BrowserTiming } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/timing';
import type { PostActivity } from '../activities/post.activity';
import {
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from '@temporalio/common';

const activities = proxyActivities<PostActivity>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2 seconds', maximumInterval: '1 minute' },
});
const poke = defineSignal('poke');

export async function browserPostWorkflow(
  input: {
    postId: string;
    organizationId: string;
  },
  polling?: BrowserTiming
) {
  setHandler(poke, () => {});
  const ref = { ...input, workflowId: workflowInfo().workflowId };
  if (patched('browser-media-preparation-v1')) {
    let timing = polling;
    if (!timing) {
      if (!(await activities.browserSchedule(ref))) return;
      timing = await activities.browserTiming(ref);
      if (!timing) return;
      if (timing.prepareAt) {
        await waitUntil(timing.prepareAt);
        if (Date.now() < Date.parse(timing.uploadAt)) {
          const prepare = proxyActivities<PostActivity>({
            startToCloseTimeout: Math.min(
              timing.publishSeconds * 1000,
              Date.parse(timing.uploadAt) - Date.now()
            ),
            retry: { maximumAttempts: 1 },
          });
          try {
            await prepare.browserPrepare(ref);
          } catch {
            /* A cache miss is handled by publish. */
          }
        }
      }
      await waitUntil(timing.uploadAt);
      const publish = proxyActivities<PostActivity>({
        startToCloseTimeout: timing.publishSeconds * 1000,
        heartbeatTimeout: timing.heartbeatSeconds * 1000,
        retry: { initialInterval: '2 seconds', maximumInterval: '1 minute' },
      });
      if (!(await publish.browserHandoff(ref))) return;
    }
    const query = proxyActivities<PostActivity>({
      startToCloseTimeout: timing.querySeconds * 1000,
      retry: { initialInterval: '2 seconds', maximumInterval: '1 minute' },
    });
    for (let round = 1; ; round++) {
      const result = await query.checkPostStatus(null, ref);
      if (result.status !== 'pending') break;
      if (round >= timing.queryRounds) {
        const cadence = timing.queryWaitSeconds * 1000;
        if (patched('browser-poll-cadence-v2')) {
          await sleep(cadence);
        } else {
          const deadline = Date.parse(result.pendingData?.nextDeadlineAt);
          await sleep(Math.max(cadence, deadline - Date.now() || 0));
        }
        return continueAsNew<typeof browserPostWorkflow>(input, timing);
      }
      await sleep(timing.queryWaitSeconds * 1000);
    }
  } else {
    const dueAt = await activities.browserSchedule(ref);
    if (!dueAt) return;
    await waitUntil(dueAt);
    if (!(await activities.browserHandoff(ref))) return;
    let pollDelay = 1000;
    while ((await activities.checkPostStatus(null, ref)).status === 'pending') {
      await sleep(pollDelay);
      pollDelay = Math.min(20000, pollDelay * 2);
    }
  }
  const nextId = await activities.browserNextOccurrence(ref);
  if (nextId) {
    await startChild(browserPostWorkflow, {
      workflowId: nextId,
      args: [input],
      parentClosePolicy: 'ABANDON',
      typedSearchAttributes: new TypedSearchAttributes([
        {
          key: defineSearchAttributeKey('postId', 'TEXT'),
          value: input.postId,
        },
        {
          key: defineSearchAttributeKey('organizationId', 'TEXT'),
          value: input.organizationId,
        },
      ]),
    });
  }
}

async function waitUntil(instant: string) {
  const delay = Date.parse(instant) - Date.now();
  if (delay > 0) await sleep(delay);
}
