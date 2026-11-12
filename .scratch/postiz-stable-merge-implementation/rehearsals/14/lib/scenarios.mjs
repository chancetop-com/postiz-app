/**
 * Replay scenarios.
 *
 * Each scenario starts one real workflow execution on an ephemeral Temporal
 * test server, using the pre-upgrade workflow definitions and stubbed
 * activities, then captures its event history. `bundle: 'base'` means the code
 * comes verbatim from the product-behaviour baseline commit C; `bundle:
 * 'patched'` means the same old sources plus only the documented `patched()` /
 * continue-as-new gates that the candidate adds to same-named workflows.
 */
import {
  SYNTH_INTEGRATION_ID,
  SYNTH_ORG_ID,
  SYNTH_POST_ID,
  syntheticEmail,
  syntheticIntegration,
  syntheticPost,
  syntheticPostResponse,
} from './synthetic.mjs';
import { activityFailure } from './world.mjs';

const HOUR = 3_600_000;
const inFuture = (ms) => new Date(Date.now() + ms);

const postArgs = (overrides = {}) => ({
  taskQueue: 'main',
  postId: SYNTH_POST_ID,
  organizationId: SYNTH_ORG_ID,
  ...overrides,
});

const historyOf = async (client, workflowId, runId) => {
  const handle = client.workflow.getHandle(workflowId, runId);
  return handle.fetchHistory();
};

/** Captures the run that started the execution, even if it continued-as-new. */
const captureFirstRun = async (env, workflowId, handle, name) => {
  const history = await historyOf(env.client, workflowId, handle.firstExecutionRunId);
  return [{ name, workflowId, runId: handle.firstExecutionRunId, history }];
};

async function completeRun(env, handle, workflowId) {
  await handle.result();
  const history = await historyOf(env.client, workflowId, handle.firstExecutionRunId);
  return { workflowId, runId: handle.firstExecutionRunId, history };
}

/**
 * @typedef {object} Scenario
 * @property {string} id
 * @property {'base'|'patched'} bundle
 * @property {string} description
 * @property {string} workflowType
 * @property {string} workflowId
 * @property {unknown[]} args
 * @property {Record<string, Function>} [stubs]
 * @property {string} [expectLastEvent]
 * @property {(ctx: { env: any, world: any, handle: any }) => Promise<{name: string, workflowId: string, runId: string, history: any}[]>} run
 * @property {string[]} proves
 */

export const scenarios = [
  {
    id: 'v101-scheduled-sleep-success',
    bundle: 'base',
    description:
      'V101 waits for the scheduled publish date, publishes and completes its plug phase.',
    workflowType: 'postWorkflowV101',
    workflowId: 'rehearsal_v101_scheduled',
    args: [postArgs()],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
    proves: [
      'V101 still resolves',
      'schedule sleep timer',
      'postSocial -> updatePost -> notification -> webhooks',
    ],
    stubs: {
      getPostsList: () => [syntheticPost({ publishDate: inFuture(HOUR), state: 'QUEUE' })],
    },
    run: async ({ env, handle }) => [
      { name: 'execution', ...(await completeRun(env, handle, 'rehearsal_v101_scheduled')) },
    ],
  },
  {
    id: 'v102-delayed-comment',
    bundle: 'base',
    description:
      'V102 publishes a post, waits the configured comment delay and then posts the comment.',
    workflowType: 'postWorkflowV102',
    workflowId: 'rehearsal_v102_delayed_comment',
    args: [postArgs()],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
    proves: [
      'V102 scheduled sleep',
      'comment delay timer (minutes)',
      'postComment payload contract',
    ],
    stubs: {
      getPostsList: () => [
        syntheticPost({ publishDate: inFuture(HOUR) }),
        syntheticPost({ id: 'post_synthetic_0002', content: 'Synthetic comment', delay: 2 }),
      ],
      isCommentable: () => true,
    },
    run: async ({ env, handle }) => [
      { name: 'execution', ...(await completeRun(env, handle, 'rehearsal_v102_delayed_comment')) },
    ],
  },
  {
    id: 'v102-repeat-child',
    bundle: 'base',
    description:
      'V102 with intervalInDays starts its next repeat execution as a V102 child (ABANDON) and that child replays too.',
    workflowType: 'postWorkflowV102',
    workflowId: 'rehearsal_v102_repeat_parent',
    args: [postArgs()],
    proves: [
      'repeat interval sleep',
      'StartChildWorkflowExecutionInitiated with postWorkflowV102',
      'old repeat child still produces an old-version execution',
    ],
    stubs: {
      getPostsList: (() => {
        let call = 0;
        return () => {
          call += 1;
          // The repeat child runs with postNow and posts the already scheduled copy.
          return call === 1
            ? [syntheticPost({ publishDate: inFuture(HOUR), intervalInDays: 1 })]
            : [
                syntheticPost({
                  publishDate: inFuture(HOUR),
                  state: 'PUBLISHED',
                  intervalInDays: null,
                }),
              ];
        };
      })(),
    },
    run: async ({ env, handle }) => {
      const parent = await completeRun(env, handle, 'rehearsal_v102_repeat_parent');
      const started = parent.history.events.find(
        (event) => event.startChildWorkflowExecutionInitiatedEventAttributes
      );
      if (!started) {
        throw new Error('repeat scenario never started a child execution');
      }
      const childWorkflowId =
        started.startChildWorkflowExecutionInitiatedEventAttributes.workflowId;
      const child = env.client.workflow.getHandle(childWorkflowId);
      await child.result();
      const childDescription = await child.describe();
      return [
        {
          name: 'parent',
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          history: parent.history,
        },
        {
          name: 'repeat-child',
          workflowId: childWorkflowId,
          runId: childDescription.runId,
          history: await child.fetchHistory(),
        },
      ];
    },
  },
  {
    id: 'v102-refresh-token',
    bundle: 'base',
    description:
      'V102 recovers from a refresh_token activity failure by refreshing the channel token and retrying.',
    workflowType: 'postWorkflowV102',
    workflowId: 'rehearsal_v102_refresh_token',
    args: [postArgs()],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
    proves: [
      'ApplicationFailure type refresh_token',
      'refreshTokenWithCause round trip',
      'post retry after refresh',
    ],
    stubs: {
      getPostsList: () => [syntheticPost({ publishDate: inFuture(HOUR) })],
      postSocial: (() => {
        let call = 0;
        return () => {
          call += 1;
          if (call === 1) throw activityFailure.refreshToken();
          return [syntheticPostResponse()];
        };
      })(),
    },
    run: async ({ env, handle }) => [
      { name: 'execution', ...(await completeRun(env, handle, 'rehearsal_v102_refresh_token')) },
    ],
  },
  {
    id: 'v102-bad-body',
    bundle: 'base',
    description:
      'V102 turns a bad_body provider rejection into an ERROR state and a user notification.',
    workflowType: 'postWorkflowV102',
    workflowId: 'rehearsal_v102_bad_body',
    args: [postArgs()],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
    proves: [
      'ApplicationFailure type bad_body',
      'changeState(ERROR)',
      'inAppNotification failure branch',
    ],
    stubs: {
      getPostsList: () => [syntheticPost({ publishDate: inFuture(HOUR) })],
      postSocial: () => {
        throw activityFailure.badBody();
      },
    },
    run: async ({ env, handle }) => [
      { name: 'execution', ...(await completeRun(env, handle, 'rehearsal_v102_bad_body')) },
    ],
  },
  {
    id: 'v102-inflight-sleep',
    bundle: 'base',
    description:
      'A V102 execution that is still sleeping before its publish date: in-flight history, not a completed one.',
    workflowType: 'postWorkflowV102',
    workflowId: 'rehearsal_v102_inflight',
    args: [postArgs()],
    proves: [
      'partial (open) history replay',
      'schedule timer already recorded, publish activities not yet',
    ],
    expectLastEvent: 'EVENT_TYPE_TIMER_STARTED',
    stubs: {
      getPostsList: () => [syntheticPost({ publishDate: inFuture(6 * HOUR), state: 'QUEUE' })],
    },
    run: async ({ env, world, handle }) => {
      await world.advanceUntil((current) => current.count('getPostsList') === 1, env);
      await world.settle(env, 10);
      const history = await historyOf(env.client, handle.workflowId, handle.firstExecutionRunId);
      return [
        {
          name: 'in-flight',
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          history,
        },
      ];
    },
  },
  {
    id: 'refresh-token-loop',
    bundle: 'base',
    description:
      'The old singleton refreshTokenWorkflow sleeps until token expiry, refreshes, then exits when refresh is no longer allowed.',
    workflowType: 'refreshTokenWorkflow',
    workflowId: `refresh_${SYNTH_INTEGRATION_ID}`,
    args: [{ integrationId: SYNTH_INTEGRATION_ID, organizationId: SYNTH_ORG_ID }],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
    proves: ['token expiry sleep', 'refreshToken activity', 'exit branch on refreshNeeded'],
    stubs: {
      getIntegrationsById: (() => {
        let call = 0;
        return () => {
          call += 1;
          const tokenExpiration = inFuture(HOUR);
          return call <= 2
            ? syntheticIntegration({ tokenExpiration })
            : syntheticIntegration({ tokenExpiration, refreshNeeded: true });
        };
      })(),
    },
    run: async ({ env, handle }) => [
      { name: 'execution', ...(await completeRun(env, handle, `refresh_${SYNTH_INTEGRATION_ID}`)) },
    ],
  },
  {
    id: 'legacy-email-signal-drain',
    bundle: 'base',
    description:
      'The deprecated singleton sendEmailWorkflow receives sendEmail signals and drains them with the 700ms throttle.',
    workflowType: 'sendEmailWorkflow',
    workflowId: 'send_email',
    args: [{ queue: [] }],
    proves: [
      'sendEmail signal payload contract',
      'rate limit sleep',
      'old email backlog drains without a new worker',
    ],
    stubs: {},
    run: async ({ env, world, handle }) => {
      for (let i = 0; i < 3; i++) {
        await handle.signal(
          'sendEmail',
          syntheticEmail({ subject: `Synthetic rehearsal email ${i + 1}` })
        );
      }
      await world.advanceUntil((current) => current.count('sendEmail') >= 3, env, {
        stepMs: 1000,
        timeoutMs: 60_000,
      });
      await world.settle(env, 10);
      const history = await historyOf(env.client, handle.workflowId, handle.firstExecutionRunId);
      return [
        {
          name: 'in-flight',
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          history,
        },
      ];
    },
  },
  {
    id: 'legacy-email-continue-as-new',
    bundle: 'base',
    description:
      'The old email singleton continues-as-new after 30 emails; the boundary history must still replay.',
    workflowType: 'sendEmailWorkflow',
    workflowId: 'send_email',
    args: [
      {
        queue: Array.from({ length: 30 }, (_, i) =>
          syntheticEmail({ subject: `Synthetic backlog email ${i + 1}` })
        ),
      },
    ],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW',
    proves: ['continue-as-new after 30 emails', 'old backlog size boundary'],
    stubs: {},
    run: async ({ env, world, handle }) => {
      await world.advanceUntil((current) => current.count('sendEmail') >= 30, env, {
        stepMs: 5000,
        timeoutMs: 120_000,
      });
      await world.settle(env, 20);
      return captureFirstRun(env, handle.workflowId, handle, 'continue-as-new-run');
    },
  },
  {
    id: 'autopost-pre-patch',
    bundle: 'base',
    description:
      'An autoPostWorkflow execution started before the continue-as-new patch: three hourly loops, no patch marker.',
    workflowType: 'autoPostWorkflow',
    workflowId: 'autopost_synthetic_1',
    args: [{ id: 'synthetic-autopost-1', immediately: true }],
    proves: ['pre-patch history (patched() resolves false)', 'hourly autoPost loop'],
    stubs: {},
    run: async ({ env, world, handle }) => {
      await env.sleep(3 * HOUR + HOUR / 2);
      await world.settle(env, 5);
      const history = await historyOf(env.client, handle.workflowId, handle.firstExecutionRunId);
      return [
        {
          name: 'in-flight',
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          history,
        },
      ];
    },
  },
  {
    id: 'autopost-post-patch-continue-as-new',
    bundle: 'patched',
    description:
      'A same-named autoPostWorkflow history that contains the autopost-continue-as-new marker and hits the 24 loop boundary.',
    workflowType: 'autoPostWorkflow',
    workflowId: 'autopost_synthetic_2',
    args: [{ id: 'synthetic-autopost-2', immediately: true }],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW',
    proves: [
      'patch marker present',
      'continue-as-new after 24 live loops',
      'post-CaN arguments keep id/immediately',
    ],
    stubs: {},
    run: async ({ env, world, handle }) => {
      await env.sleep(25 * HOUR);
      await world.settle(env, 10);
      return captureFirstRun(env, handle.workflowId, handle, 'continue-as-new-run');
    },
  },
  {
    id: 'missing-pre-patch',
    bundle: 'base',
    description:
      'A missingPostWorkflow execution started before the continue-as-new patch: hourly sweeps, no patch marker.',
    workflowType: 'missingPostWorkflow',
    workflowId: 'missing_post_synthetic_1',
    args: [],
    proves: ['pre-patch history (patched() resolves false)', 'hourly missing sweep cadence'],
    stubs: {},
    run: async ({ env, world, handle }) => {
      await env.sleep(3 * HOUR + HOUR / 2);
      await world.settle(env, 5);
      const history = await historyOf(env.client, handle.workflowId, handle.firstExecutionRunId);
      return [
        {
          name: 'in-flight',
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          history,
        },
      ];
    },
  },
  {
    id: 'missing-post-patch-continue-as-new',
    bundle: 'patched',
    description:
      'A same-named missingPostWorkflow history carrying the missing-post-continue-as-new marker at the 24 loop boundary.',
    workflowType: 'missingPostWorkflow',
    workflowId: 'missing_post_synthetic_2',
    args: [],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW',
    proves: ['patch marker present', 'continue-as-new after 24 sweeps'],
    stubs: {},
    run: async ({ env, world, handle }) => {
      await env.sleep(25 * HOUR);
      await world.settle(env, 10);
      return captureFirstRun(env, handle.workflowId, handle, 'continue-as-new-run');
    },
  },
  {
    id: 'streak-pre-patch',
    bundle: 'base',
    description:
      'The pre-patch streakWorkflow: streak start, 22h reminder, 2h wait, streak end.',
    workflowType: 'streakWorkflow',
    workflowId: `streak_${SYNTH_ORG_ID}`,
    args: [{ organizationId: SYNTH_ORG_ID }],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
    proves: ['pre-patch streak history (both patched() resolve false)', 'old reminder email loop'],
    stubs: {},
    run: async ({ env, handle }) => [
      { name: 'execution', ...(await completeRun(env, handle, `streak_${SYNTH_ORG_ID}`)) },
    ],
  },
  {
    id: 'streak-post-patch-v2-handoff',
    bundle: 'patched',
    description:
      'A same-named streakWorkflow history carrying the streak-last-post marker; it hands the streak to streakWorkflowV2 via continue-as-new.',
    workflowType: 'streakWorkflow',
    workflowId: `streak_${SYNTH_ORG_ID}_patched`,
    args: [{ organizationId: SYNTH_ORG_ID }],
    expectLastEvent: 'EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW',
    proves: ['reminder + streak-last-post markers', 'continue-as-new to streakWorkflowV2'],
    stubs: {
      // The organisation published an hour after the streak started, so at the
      // 24h check the streak is still alive and must be handed to V2.
      getLastPublishDate: () => Date.now() + HOUR,
    },
    run: async ({ env, world, handle }) => {
      await env.sleep(25 * HOUR);
      await world.settle(env, 10);
      return captureFirstRun(env, handle.workflowId, handle, 'continue-as-new-run');
    },
  },
];
