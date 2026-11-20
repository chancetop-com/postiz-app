/**
 * Boundary substitutes + fault injection for the ticket-13 rehearsal.
 *
 * Preloaded into the *real* compiled candidate process with
 * `NODE_OPTIONS=--require`. Three layers:
 *
 *   1. the same recording `bluesky` platform and e-mail substitutes ticket 12
 *      used, so the normal samples and this fault run are comparable;
 *   2. faults read from `work/faults.json` **on every call**, keyed by post id,
 *      so the harness can arm a fault and disarm it again without restarting
 *      the candidate (the post is keyed by the `post_<id>` workflow);
 *   3. a scan hook that applies cancel/delete/reschedule mutations after the
 *      repository loaded its candidate list, exactly as another worker or the
 *      UI could, before the activity's second read.
 *
 * Nothing here is product code: the process runs the same compiled bundle PM2
 * starts. Every call is appended to the boundary ledger with the target,
 * credential, payload and media digest.
 */
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const distRoot = process.env.T13_DIST_ROOT;
const callLog = process.env.T13_CALL_LOG;
const faultFile = process.env.T13_FAULT_FILE;

if (!distRoot || !callLog || !faultFile) {
  throw new Error('T13_DIST_ROOT, T13_CALL_LOG and T13_FAULT_FILE are required');
}

const record = (entry) => {
  appendFileSync(
    callLog,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) +
      '\n'
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const forever = () => new Promise(() => {});

// The fault file is small and rewritten only between phases. Cache by mtime so
// a hanging activity does not pin an old value after the harness disarms it;
// reading the whole file on each provider call is cheap and always correct.
let faultCache = { raw: null, value: {} };
function faults() {
  try {
    const raw = readFileSync(faultFile, 'utf8');
    if (raw === faultCache.raw) return faultCache.value;
    faultCache = { raw, value: JSON.parse(raw || '{}') };
    return faultCache.value;
  } catch {
    faultCache = { raw: null, value: {} };
    return faultCache.value;
  }
}

function disarm(key) {
  try {
    const current = faults();
    const next = { ...current };
    delete next[key];
    writeFileSync(faultFile, JSON.stringify(next, null, 2));
    faultCache = { raw: null, value: next };
  } catch {
    /**empty - the harness also disarms globally between phases**/
  }
}

function faultFor(key) {
  const mode = faults()[key];
  if (mode) record({ method: 'fault', fault: key, mode });
  return mode;
}

function delayFrom(mode) {
  const match = /^delay-accept-(\d+)$/.exec(mode || '');
  return match ? Number(match[1]) : 0;
}

const digestFile = (path) => {
  try {
    const buffer = readFileSync(path);
    return {
      path,
      readable: true,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  } catch (err) {
    return { path, readable: false, error: err.message };
  }
};

const describeMedia = async (media) =>
  Promise.all(
    (media || []).map(async (item) => {
      if (!item || !item.path) return { empty: true, item };
      if (/^https?:\/\//.test(item.path)) {
        try {
          const response = await fetch(item.path);
          const buffer = Buffer.from(await response.arrayBuffer());
          return {
            path: item.path,
            remote: true,
            status: response.status,
            bytes: buffer.length,
            sha256: createHash('sha256').update(buffer).digest('hex'),
            id: item.id,
            type: item.type,
          };
        } catch (err) {
          return {
            path: item.path,
            remote: true,
            readable: false,
            error: err.message,
          };
        }
      }
      return { ...digestFile(item.path), id: item.id, type: item.type };
    })
  );

const describePosts = async (posts) =>
  Promise.all(
    posts.map(async (p) => ({
      id: p.id,
      message: p.message,
      settings: p.settings,
      media: await describeMedia(p.media),
    }))
  );

let publishCounter = 0;
const publishResult = (posts) => {
  publishCounter += 1;
  const id = `stub-post-${process.pid}-${publishCounter}`;
  return {
    id: posts[0]?.id,
    postId: id,
    releaseURL: `https://stub.invalid/${id}`,
    status: 'success',
  };
};

const badBody = (message) => {
  const { BadBody } = require(join(
    distRoot,
    'libraries/nestjs-libraries/src/integrations/social.abstract.js'
  ));
  return new BadBody('bluesky', '{}', Buffer.from('{}'), message);
};

const pendingDataFor = (postId, id) => ({
  step: 'accepted',
  id,
  postDbId: postId,
});

const provider = {
  identifier: 'bluesky',
  name: 'Synthetic Bluesky',
  // Fault injection needs several mutations in flight at once (one hanging
  // finalize per post); the real provider's rate limit belongs to the
  // substitute, not to the product, so the rehearsal raises it.
  maxConcurrentJob: 100,
  editor: 'normal',
  mentionFormat: (id) => id,
  stripLinks: () => false,
  checkValidity: async () => true,
  maxLength: () => 100000,

  // Blocking contract used by V101/V102 and every pre-pending workflow.
  post: async (internalId, token, posts, integration) => {
    record({
      method: 'post',
      internalId,
      token,
      integrationId: integration && integration.id,
      organizationId: integration && integration.organizationId,
      posts: await describePosts(posts),
    });
    return [publishResult(posts)];
  },

  // New pending/finalize contract used by V112.
  postPending: async (internalId, token, posts, integration) => {
    const postId = posts[0]?.id;
    const mode = faultFor(`postPending:${postId}`);
    const base = {
      method: 'postPending',
      internalId,
      token,
      integrationId: integration && integration.id,
      organizationId: integration && integration.organizationId,
      postDbId: postId,
    };

    if (mode === 'reject') {
      record({ ...base, accepted: false, rejected: true, posts: await describePosts(posts) });
      throw badBody('synthetic provider rejected the pending publish');
    }

    if (delayFrom(mode)) {
      record({ ...base, phase: 'entered', accepted: false });
      await sleep(delayFrom(mode));
    }

    const id = `stub-pending-${process.pid}-${++publishCounter}`;
    const pendingData = pendingDataFor(postId, id);
    const result = [
      {
        id: postId,
        postId: id,
        releaseURL: '',
        status: 'pending',
        pendingData,
      },
    ];
    record({
      ...base,
      accepted: true,
      posts: await describePosts(posts),
      pendingData,
    });

    if (mode === 'hang-after-accept') return forever();
    return result;
  },

  checkPostStatus: async (token, pendingData, integration) => {
    const postId = pendingData?.postDbId;
    const mode = faultFor(`check:${postId}`);
    const base = {
      method: 'checkPostStatus',
      token,
      integrationId: integration && integration.id,
      pendingData,
      postDbId: postId,
    };

    if (mode === 'hang') {
      record({ ...base, phase: 'entered' });
      return forever();
    }

    if (mode === 'pending') {
      record({ ...base, status: 'pending' });
      return {
        status: 'pending',
        pendingData: { ...pendingData, step: 'processing' },
      };
    }

    record({ ...base, status: 'ready' });
    return {
      status: 'ready',
      pendingData: { ...pendingData, step: 'finalize' },
    };
  },

  finalizePost: async (token, pendingData, integration) => {
    const postId = pendingData?.postDbId;
    const mode = faultFor(`finalize:${postId}`);
    const base = {
      method: 'finalizePost',
      token,
      integrationId: integration && integration.id,
      pendingData,
      postDbId: postId,
    };

    if (mode === 'reject') {
      record({ ...base, accepted: false, rejected: true });
      throw badBody('synthetic provider rejected the finalize');
    }

    if (delayFrom(mode)) {
      record({ ...base, phase: 'entered', accepted: false });
      await sleep(delayFrom(mode));
    }

    const finalizedId = `stub-finalized-${process.pid}-${++publishCounter}`;
    const result = {
      status: 'completed',
      postId: finalizedId,
      releaseURL: `https://stub.invalid/${finalizedId}`,
    };
    record({ ...base, accepted: true, finalizedId, result });

    if (mode === 'hang-after-accept') return forever();
    return result;
  },

  // Delayed comment contract (only for completeness; ticket 13 does not use it).
  comment: async (internalId, postId, lastPostId, token, posts, integration) => {
    record({
      method: 'postComment',
      internalId,
      postId,
      lastPostId,
      token,
      integrationId: integration && integration.id,
      organizationId: integration && integration.organizationId,
      posts: await describePosts(posts),
    });
    return [publishResult(posts)];
  },

  refreshToken: async (refreshToken) => {
    const accessToken = `synthetic-refreshed-access-${process.pid}-${++publishCounter}`;
    const rotated = `synthetic-refreshed-refresh-${process.pid}-${publishCounter}`;
    record({
      method: 'providerRefreshToken',
      refreshToken,
      accessToken,
      rotatedRefreshToken: rotated,
    });
    return {
      id: 'stub-refreshed',
      name: 'Synthetic Bluesky',
      username: 'synthetic',
      picture: 'https://stub.invalid/avatar.png',
      accessToken,
      refreshToken: rotated,
      expiresIn: 3600,
    };
  },
};

const integrationManager = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/integrations/integration.manager.js'
));
const list = integrationManager.socialIntegrationList;
const existing = list.findIndex((item) => item.identifier === provider.identifier);
if (existing === -1) {
  list.push(provider);
} else {
  list[existing] = provider;
}

const originalGet =
  integrationManager.IntegrationManager.prototype.getSocialIntegration;
integrationManager.IntegrationManager.prototype.getSocialIntegration = function (
  identifier
) {
  if (identifier === provider.identifier) return provider;
  return originalGet.call(this, identifier);
};
record({
  method: 'preload',
  role: 'provider',
  identifier: provider.identifier,
  redisUrl: process.env.REDIS_URL ?? null,
  pid: process.pid,
});

if (process.env.T13_STUB_EMAIL === '1') {
  const emailService = require(join(
    distRoot,
    'libraries/nestjs-libraries/src/services/email.service.js'
  ));
  const emailProvider = {
    name: 'synthetic-email',
    validateEnvKeys: [],
    sendEmail: async (to, subject, html, from, fromAddress, replyTo) => {
      record({
        method: 'email',
        to,
        subject,
        htmlLength: (html || '').length,
        from,
        fromAddress,
        replyTo,
      });
      return { id: `stub-email-${Date.now()}` };
    },
  };
  emailService.EmailService.prototype.selectProvider = function () {
    return emailProvider;
  };
  record({ method: 'preload', role: 'email' });
}

// ---------------------------------------------------------------------------
// Local write-back faults. They throw at the same service seam the shipped
// activity calls. `fail-once` throws a retryable error and disarms itself, so
// the shipped retry (3 attempts, 2-minute backoff) really writes back; `fail`
// is a non-retryable ApplicationFailure to keep the permanent-outage branch
// bounded. `hang` keeps the activity in flight.
// ---------------------------------------------------------------------------
const { PostsService } = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.js'
));

function permanentFailure(message) {
  const { ApplicationFailure } = require('@temporalio/common');
  return ApplicationFailure.create({
    message,
    type: 'harness_permanent_failure',
    nonRetryable: true,
  });
}

function failWriteBack(target, method, keyPrefix) {
  const original = target[method];
  target[method] = function wrapped(...args) {
    const postId = args[0];
    const key = `${keyPrefix}:${postId}`;
    record({ method: keyPrefix, postDbId: postId });
    const mode = faultFor(key);
    if (!mode) return original.apply(this, args);
    if (mode === 'hang') return forever();
    if (mode === 'fail-once') {
      disarm(key);
      throw new Error(`injected transient ${keyPrefix} write-back failure`);
    }
    throw permanentFailure(`injected ${keyPrefix} write-back failure`);
  };
}

failWriteBack(PostsService.prototype, 'updatePost', 'updatePost');
failWriteBack(PostsService.prototype, 'changeState', 'changeState');

// ---------------------------------------------------------------------------
// Compensation-scan race: mutate rows after the repository returned its
// candidate list and before the activity's second read.
// ---------------------------------------------------------------------------
const repository = require(join(
  distRoot,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.js'
));
const originalSearch =
  repository.PostsRepository.prototype.searchForMissingThreeHoursPosts;
repository.PostsRepository.prototype.searchForMissingThreeHoursPosts =
  async function (...args) {
    const candidates = await originalSearch.apply(this, args);
    const actions = Array.isArray(faults().scan) ? faults().scan : [];
    for (const action of actions) {
      if (!candidates.some((post) => post.id === action.postId)) continue;
      const data =
        action.action === 'delete'
          ? { deletedAt: new Date() }
          : action.action === 'cancel'
            ? { state: 'ERROR', error: 'Canceled during the compensation scan' }
            : action.action === 'reschedule'
              ? { publishDate: new Date(action.publishDate) }
              : null;
      if (!data) continue;
      await this._post.model.post.update({
        where: { id: action.postId },
        data,
      });
      record({
        method: 'scanMutation',
        postId: action.postId,
        action: action.action,
        data:
          action.action === 'reschedule'
            ? { publishDate: action.publishDate }
            : action.action === 'cancel'
              ? { state: 'ERROR' }
              : { deletedAt: true },
      });
    }
    return candidates;
  };
record({ method: 'preload', role: 'scan-hook', faultFile });
