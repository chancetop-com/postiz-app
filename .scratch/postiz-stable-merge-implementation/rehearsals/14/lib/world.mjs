/**
 * A recording stand-in for the orchestrator activities.
 *
 * The rehearsal never touches the database, a provider or the clock: every
 * activity the old workflows call is stubbed here, remembers how it was called
 * and returns a synthetic payload. That keeps the history fixture reproducible
 * and free of production data.
 */
import { ApplicationFailure } from '@temporalio/common';
import {
  syntheticIntegration,
  syntheticPost,
  syntheticPostResponse,
  syntheticUserOrgs,
} from './synthetic.mjs';

const noop = () => undefined;

/** Every activity name referenced by the extracted pre-upgrade workflows. */
export const OLD_ACTIVITY_NAMES = [
  'getPostsList',
  'getIntegrationById',
  'isCommentable',
  'postSocial',
  'postComment',
  'updatePost',
  'inAppNotification',
  'changeState',
  'sendWebhooks',
  'internalPlugs',
  'globalPlugs',
  'processInternalPlug',
  'processPlug',
  'refreshToken',
  'refreshTokenWithCause',
  'getIntegrationsById',
  'searchForMissingThreeHoursPosts',
  'autoPost',
  'sendEmail',
  'sendEmailAsync',
  'getUserOrgs',
  'setStreak',
  'getLastPublishDate',
];

/** Provider failures the old workflows distinguish by `ApplicationFailure.type`. */
export const activityFailure = {
  refreshToken: (message = 'synthetic token refresh required') =>
    ApplicationFailure.create({ message, type: 'refresh_token', nonRetryable: true }),
  badBody: (message = 'synthetic provider rejected the body') =>
    ApplicationFailure.create({ message, type: 'bad_body', nonRetryable: true }),
};

const DEFAULT_STUBS = {
  getPostsList: () => [syntheticPost()],
  getIntegrationById: () => syntheticIntegration(),
  isCommentable: () => true,
  postSocial: () => [syntheticPostResponse()],
  postComment: () => [syntheticPostResponse({ postId: 'synthetic-provider-comment-1' })],
  updatePost: noop,
  inAppNotification: noop,
  changeState: noop,
  sendWebhooks: noop,
  internalPlugs: () => [],
  globalPlugs: () => [],
  processInternalPlug: noop,
  processPlug: () => false,
  refreshToken: () => ({ accessToken: 'synthetic-refreshed-token' }),
  refreshTokenWithCause: () => ({ accessToken: 'synthetic-refreshed-token' }),
  getIntegrationsById: () => syntheticIntegration(),
  searchForMissingThreeHoursPosts: noop,
  autoPost: noop,
  sendEmail: noop,
  sendEmailAsync: noop,
  getUserOrgs: () => syntheticUserOrgs,
  setStreak: noop,
  getLastPublishDate: () => Date.now(),
};

export function createWorld() {
  /** @type {{ name: string, args: unknown[] }[]} */
  const calls = [];
  let stubs = { ...DEFAULT_STUBS };

  const world = {
    calls,
    reset(overrides = {}) {
      calls.length = 0;
      stubs = { ...DEFAULT_STUBS, ...overrides };
    },
    callsOf(name) {
      return calls.filter((call) => call.name === name);
    },
    count(name) {
      return world.callsOf(name).length;
    },
    async invoke(name, args) {
      calls.push({ name, args });
      const stub = stubs[name];
      if (!stub) {
        throw new Error(`rehearsal has no stub for activity "${name}" - extend lib/world.mjs`);
      }
      return await stub(...args);
    },
    /**
     * Advances virtual time in small steps until `predicate` is true. Used to
     * stop a never-ending workflow at a well defined point instead of waiting
     * for a real hour.
     */
    async advanceUntil(predicate, env, { timeoutMs = 60_000, stepMs = 1 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(world)) return;
        await env.sleep(stepMs);
      }
      throw new Error(`rehearsal timed out waiting for the workflow to reach the capture point`);
    },
    /** Gives the server a few scheduling turns before a history is fetched. */
    async settle(env, turns = 5) {
      for (let i = 0; i < turns; i++) await env.sleep(1);
    },
  };

  world.activities = Object.fromEntries(
    OLD_ACTIVITY_NAMES.map((name) => [name, (...args) => world.invoke(name, args)])
  );

  return world;
}
