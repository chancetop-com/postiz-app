import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  clock: Date.parse('2026-11-27T09:00:00Z'),
  calls: [] as [string, string, any?][],
  due: '2026-11-27T10:00:00.000Z',
  prepare: '2026-11-27T09:30:00.000Z' as string | null,
  upload: '2026-11-27T09:50:00.000Z',
  pending: 0,
  currentPolling: true,
  continuation: new Error('continue as new'),
  nextRun: vi.fn<(...args: Parameters<typeof browserPostWorkflow>) => void>(),
}));
vi.mock('@temporalio/workflow', () => ({
  defineSignal: () => 'poke',
  setHandler: () => {},
  patched: (id: string) =>
    id !== 'browser-poll-cadence-v2' || fake.currentPolling,
  workflowInfo: () => ({ workflowId: 'scheduled' }),
  sleep: async (n: number) => {
    fake.clock += n;
  },
  continueAsNew: async (...args: Parameters<typeof browserPostWorkflow>) => {
    fake.nextRun(...structuredClone(args));
    throw fake.continuation;
  },
  proxyActivities: (options: any) =>
    new Proxy(
      {},
      {
        get: (_, name: string) => async () => {
          fake.calls.push([name, new Date(fake.clock).toISOString(), options]);
          if (name === 'browserSchedule') return fake.due;
          if (name === 'browserTiming')
            return {
              prepareAt: fake.prepare,
              uploadAt: fake.upload,
              publishSeconds: 1800,
              heartbeatSeconds: 180,
              querySeconds: 120,
              queryRounds: 2,
              queryWaitSeconds: 20,
            };
          if (name === 'browserHandoff') return true;
          if (name === 'checkPostStatus')
            return {
              status: fake.pending-- > 0 ? 'pending' : 'completed',
              pendingData: { nextDeadlineAt: '2026-11-27T10:45:00.000Z' },
            };
        },
      }
    ),
}));
import { browserPostWorkflow } from '../apps/orchestrator/src/workflows/browser-post.workflow';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => fake.clock);
  fake.clock = Date.parse('2026-11-27T09:00:00Z');
  fake.calls.length = 0;
  fake.nextRun.mockClear();
  fake.currentPolling = true;
  fake.pending = 0;
});
afterEach(() => vi.restoreAllMocks());

it('downloads at 09:30, offers upload at 09:50, and queries with the recorded budgets', async () => {
  fake.pending = 1;
  await browserPostWorkflow({ postId: 'p', organizationId: 'org' });
  expect(fake.calls.find((c) => c[0] === 'browserPrepare')?.[1]).toBe(
    '2026-11-27T09:30:00.000Z'
  );
  expect(fake.calls.find((c) => c[0] === 'browserHandoff')).toMatchObject([
    'browserHandoff',
    '2026-11-27T09:50:00.000Z',
    { startToCloseTimeout: 1800000, heartbeatTimeout: 180000 },
  ]);
  expect(
    fake.calls
      .filter((c) => c[0] === 'checkPostStatus')
      .map((c) => [c[1], c[2].startToCloseTimeout])
  ).toEqual([
    ['2026-11-27T09:50:00.000Z', 120000],
    ['2026-11-27T09:50:20.000Z', 120000],
  ]);
});

import { occurrenceTiming } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/timing';

it('keeps download off and upload at due by default, then snapshots configured lead windows and budgets', () => {
  const due = new Date(fake.due);
  const defaultTiming = occurrenceTiming(due, false);
  expect(defaultTiming).toEqual({
    prepareAt: null,
    uploadAt: '2026-11-27T10:00:00.000Z',
    publishSeconds: 1800,
    heartbeatSeconds: 180,
    querySeconds: 120,
    queryRounds: 90,
    queryWaitSeconds: 20,
  });
  try {
    vi.stubEnv('BROWSER_PREDOWNLOAD_LEAD_SECONDS', '1800');
    vi.stubEnv('BROWSER_UPLOAD_LEAD_SECONDS', '600');
    vi.stubEnv('BROWSER_RESULT_QUERY_ROUNDS', '12');
    expect(occurrenceTiming(due, false)).toMatchObject({
      prepareAt: '2026-11-27T09:30:00.000Z',
      uploadAt: '2026-11-27T09:50:00.000Z',
      queryRounds: 12,
    });
    expect(occurrenceTiming(due, true)).toMatchObject({
      prepareAt: null,
      uploadAt: due.toISOString(),
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  [true, '2026-11-27T09:50:40.000Z'],
  [false, '2026-11-27T10:45:00.000Z'],
] as const)(
  'continues polling at the recorded cadence across a batch boundary (current patch %s)',
  async (patched, nextPoll) => {
    fake.currentPolling = patched;
    fake.pending = 2;
    const post = { postId: 'p', organizationId: 'org' };
    await expect(browserPostWorkflow(post)).rejects.toBe(fake.continuation);
    const [nextRun] = fake.nextRun.mock.calls;
    expect(nextRun[0]).toEqual(post);
    await browserPostWorkflow(...nextRun);
    expect(
      fake.calls.filter(([name]) => name === 'browserHandoff')
    ).toHaveLength(1);
    expect(
      fake.calls.filter(([name]) => name === 'browserPrepare')
    ).toHaveLength(1);
    const polls = fake.calls.filter(([name]) => name === 'checkPostStatus');
    expect(polls.map(([, time]) => time)).toEqual([
      '2026-11-27T09:50:00.000Z',
      '2026-11-27T09:50:20.000Z',
      nextPoll,
    ]);
    expect(
      fake.calls
        .filter(([name]) => name === 'browserNextOccurrence')
        .map(([, time]) => time)
    ).toEqual([nextPoll]);
  }
);
