import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseCompatWorkflowQueues,
  queueRunsWorkflows,
} from '@gitroom/nestjs-libraries/temporal/worker.queues';
import { emailQueues } from '@gitroom/nestjs-libraries/temporal/email.queues';

afterEach(() => vi.unstubAllEnvs());

describe('provider-queue workflow compatibility', () => {
  it('is activity-only unless an operator lists the queue', () => {
    vi.stubEnv('COMPAT_WORKFLOW_QUEUES', undefined);
    expect(parseCompatWorkflowQueues()).toEqual([]);
    expect(parseCompatWorkflowQueues('')).toEqual([]);
    expect(parseCompatWorkflowQueues(' bluesky, x ,bluesky ')).toEqual([
      'bluesky',
      'x',
    ]);

    expect(queueRunsWorkflows('main', [])).toBe(true);
    expect(queueRunsWorkflows('bluesky', [])).toBe(false);
    expect(queueRunsWorkflows('bluesky', ['bluesky'])).toBe(true);
    expect(queueRunsWorkflows('x', ['bluesky'])).toBe(false);
    // The e-mail workers stay activity-only: their workflows run on main.
    expect(queueRunsWorkflows('email', ['bluesky'])).toBe(false);
    expect(queueRunsWorkflows('email-bulk', ['bluesky'])).toBe(false);
  });
});

describe('email dispatch', () => {
  it('keeps the queues and rate limits the email backlog drains into', () => {
    expect(emailQueues).toEqual({
      priority: { taskQueue: 'email', perSecond: 3 },
      bulk: { taskQueue: 'email-bulk', perSecond: 2 },
    });
  });
});
