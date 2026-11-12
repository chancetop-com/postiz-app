/**
 * Ticket 17 fault-injection preload.
 *
 * Two layers:
 *   1. ticket 16's recording substitutes (platform + e-mail) — required
 *      verbatim, so the external boundary still records every call;
 *   2. faults on top, driven by a JSON file the harness rewrites between
 *      scenarios. The file is read on every call, so a scenario can arm and
 *      disarm a fault without restarting the candidate process.
 *
 * Faults are of two kinds:
 *   - external boundary faults (the platform/e-mail substitute fails or hangs);
 *   - local write-back faults (the compiled PostsService / NotificationService
 *     / maintenance activity fails or hangs).
 *
 * Both are harness-only. No product code knows about this file, and the
 * process runs the same compiled bundle PM2 starts.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const distRoot = process.env.T16_DIST_ROOT;
const callLog = process.env.T16_CALL_LOG;
const faultFile = process.env.T17_FAULT_FILE;

if (!distRoot || !callLog || !faultFile) {
  throw new Error('T16_DIST_ROOT, T16_CALL_LOG and T17_FAULT_FILE are required');
}

// The recording substitutes (platform provider + e-mail) and the call log.
require(join(__dirname, '../../16/lib/stub-provider.cjs'));

const { appendFileSync } = require('node:fs');
const record = (entry) => {
  appendFileSync(
    callLog,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\n'
  );
};

const HANG = 'hang';
const FAIL = 'fail';

let lastRaw = null;
let lastFaults = {};
function faults() {
  try {
    const raw = readFileSync(faultFile, 'utf8');
    if (raw === lastRaw) return lastFaults;
    lastRaw = raw;
    lastFaults = JSON.parse(raw || '{}');
    return lastFaults;
  } catch {
    lastFaults = {};
    lastRaw = null;
    return lastFaults;
  }
}

/** A promise that never settles: the process (or the activity) stays blocked. */
const forever = () => new Promise(() => {});

/**
 * Thrown by local write-back faults. Non-retryable on purpose: the shipped
 * activities retry 3x with a 2-minute backoff, and the rehearsal must stay
 * inside its disk/time budget. The *branch* the workflow reaches is identical
 * (the activity eventually fails); only the retry schedule is compressed. The
 * README records the real schedule for each activity.
 */
function permanentFailure(message) {
  const { ApplicationFailure } = require('@temporalio/common');
  return ApplicationFailure.create({
    message,
    type: 'harness_permanent_failure',
    nonRetryable: true,
  });
}

async function applyFault(key, args, run) {
  const mode = faults()[key];
  if (!mode) return run();

  record({ method: 'fault', fault: key, mode, args: summarize(args) });

  if (mode === HANG) {
    // Run the external call first, then never return: the platform accepted
    // the mutation and the worker stalls before reporting it. That is the
    // "accepted, outcome unknown" shape the ticket is about.
    await run();
    return forever();
  }

  if (mode === FAIL) {
    throw new Error(`injected ${key} failure`);
  }

  return run();
}

function summarize(args) {
  try {
    return JSON.parse(
      JSON.stringify(args, (key, value) =>
        typeof value === 'string' && value.length > 120
          ? `${value.slice(0, 120)}…`
          : key === 'token' || key === 'refreshToken'
            ? '<redacted>'
            : value
      )
    );
  } catch {
    return '<unserializable>';
  }
}

function wrap(target, method, key) {
  const original = target[method];
  if (typeof original !== 'function') {
    throw new Error(`cannot inject ${key}: ${method} is not a function`);
  }
  target[method] = function wrapped(...args) {
    return applyFault(key, args, () => original.apply(this, args));
  };
}

// ---------------------------------------------------------------------------
// External boundary faults: the platform substitute and the mail substitute.
// ---------------------------------------------------------------------------
const integrationManager = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/integrations/integration.manager.js'
));
const provider = integrationManager.socialIntegrationList.find(
  (item) => item.identifier === 'bluesky'
);

if (!provider) {
  throw new Error('the synthetic provider substitute did not register');
}

// Ticket 16's substitute advertises maxConcurrentJob: 1 to mirror the real
// provider's rate limit. Fault injection needs several mutations in flight at
// once (one hanging finalize, one hanging comment, one hanging publish) on the
// same provider queue, otherwise the second one is only queued behind the
// first and can never be killed mid-flight. The cap belongs to the substitute,
// not to the product, so the rehearsal raises it.
provider.maxConcurrentJob = 100;

// Old blocking contract used by V101/V102.
wrap(provider, 'post', 'post');
// New pending contract used by V112.
wrap(provider, 'postPending', 'postPending');
wrap(provider, 'checkPostStatus', 'checkPostStatus');
wrap(provider, 'finalizePost', 'finalizePost');
wrap(provider, 'comment', 'comment');
wrap(provider, 'refreshToken', 'refreshToken');

// The mail substitute is created lazily by EmailService.selectProvider, which
// ticket 16 already replaced. Wrap that replacement so every service instance
// (including those built during Nest bootstrap) gets the fault-aware provider.
const emailServiceModule = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/services/email.service.js'
));
const baseSelectProvider = emailServiceModule.EmailService.prototype.selectProvider;
const wrappedProviders = new WeakSet();
emailServiceModule.EmailService.prototype.selectProvider = function selectProvider(...args) {
  const selected = baseSelectProvider.apply(this, args);
  if (selected && !wrappedProviders.has(selected)) {
    wrappedProviders.add(selected);
    const originalSend = selected.sendEmail.bind(selected);
    selected.sendEmail = (...sendArgs) =>
      applyFault('email', sendArgs, () => originalSend(...sendArgs));
  }
  return selected;
};

// ---------------------------------------------------------------------------
// Local write-back faults: the same compiled services the orchestrator loads.
//
// The backend image does not contain the orchestrator's activity files, so the
// orchestrator-only parts are optional: a process that cannot load them keeps
// the substitutes and skips the local fault hooks.
// ---------------------------------------------------------------------------
const { PostsService } = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.js'
));
const { NotificationService } = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.js'
));

let PostActivity;
let AutopostActivity;
try {
  ({ PostActivity } = require(join(
    distRoot,
    'apps/orchestrator/src/activities/post.activity.js'
  )));
  ({ AutopostActivity } = require(join(
    distRoot,
    'apps/orchestrator/src/activities/autopost.activity.js'
  )));
} catch {
  PostActivity = undefined;
  AutopostActivity = undefined;
  record({ method: 'preload', role: 'ticket17-faults', orchestratorActivities: false });
}

function failPermanently(target, method, key) {
  const original = target[method];
  target[method] = function wrapped(...args) {
    const mode = faults()[key];
    if (!mode) return original.apply(this, args);
    record({ method: 'fault', fault: key, mode, args: summarize(args) });
    if (mode === HANG) return forever();
    throw permanentFailure(`injected ${key} write-back failure`);
  };
}

failPermanently(PostsService.prototype, 'updatePost', 'updatePost');
failPermanently(PostsService.prototype, 'changeState', 'changeState');
failPermanently(NotificationService.prototype, 'inAppNotification', 'inAppNotification');
if (PostActivity) {
  failPermanently(PostActivity.prototype, 'sendWebhooks', 'sendWebhooks');
  failPermanently(PostActivity.prototype, 'searchForMissingThreeHoursPosts', 'sweep');
}
if (AutopostActivity) {
  failPermanently(AutopostActivity.prototype, 'autoPost', 'autoPost');
}

record({
  method: 'preload',
  role: 'ticket17-faults',
  faultFile,
  pid: process.pid,
});
