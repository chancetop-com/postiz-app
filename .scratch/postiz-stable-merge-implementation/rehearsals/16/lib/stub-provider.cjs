/**
 * Boundary stubs for ticket 16, preloaded into the real candidate processes.
 *
 * Only external boundaries are replaced:
 *   - the synthetic `bluesky` provider: publish, comment and token refresh;
 *   - the e-mail provider used by EmailService.
 *
 * Every call is appended to T16_CALL_LOG with the exact payload the workflow
 * handed over. `comment` and `refreshToken` are additions over ticket 15's
 * stub because this ticket exercises delayed comments and the refresh backlog.
 */
const { appendFileSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const distRoot = process.env.T16_DIST_ROOT;
const callLog = process.env.T16_CALL_LOG;

if (!distRoot || !callLog) {
  throw new Error('T16_DIST_ROOT and T16_CALL_LOG are required');
}

const record = (entry) => {
  appendFileSync(
    callLog,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\n'
  );
};

// Harness-only: the time-skipping test server expires sticky-cache entries on
// the virtual clock, which is frozen while it waits for a timer's workflow
// task. After a worker restart that leaves the timer's task stuck on the dead
// worker's sticky queue forever. Product workers keep the default sticky
// cache; the rehearsal forces replay-per-task so restarts are observable.
if (process.env.T16_DISABLE_STICKY === '1') {
  const workerSdk = require('@temporalio/worker');
  const originalCreate = workerSdk.Worker.create;
  workerSdk.Worker.create = function create(options) {
    return originalCreate.call(this, { ...options, maxCachedWorkflows: 0 });
  };
  record({ method: 'preload', role: 'no-sticky-cache' });
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
          return { path: item.path, remote: true, readable: false, error: err.message };
        }
      }
      return { ...digestFile(item.path), id: item.id, type: item.type };
    })
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

const provider = {
  identifier: 'bluesky',
  name: 'Synthetic Bluesky',
  maxConcurrentJob: 1,
  editor: 'normal',
  mentionFormat: (id) => id,
  stripLinks: () => false,
  checkValidity: async () => true,
  maxLength: () => 100000,
  post: async (internalId, token, posts, integration) => {
    record({
      method: 'post',
      internalId,
      token,
      integrationId: integration && integration.id,
      organizationId: integration && integration.organizationId,
      posts: await Promise.all(
        posts.map(async (p) => ({
          id: p.id,
          message: p.message,
          settings: p.settings,
          media: await describeMedia(p.media),
        }))
      ),
    });
    return [publishResult(posts)];
  },
  postPending: async (internalId, token, posts, integration) => {
    const id = `stub-pending-${process.pid}-${++publishCounter}`;
    record({
      method: 'postPending',
      internalId,
      token,
      integrationId: integration && integration.id,
      organizationId: integration && integration.organizationId,
      posts: await Promise.all(
        posts.map(async (p) => ({
          id: p.id,
          message: p.message,
          settings: p.settings,
          media: await describeMedia(p.media),
        }))
      ),
      pendingData: { step: 'accepted', id },
    });
    return [
      {
        id: posts[0]?.id,
        postId: id,
        releaseURL: '',
        status: 'pending',
        pendingData: { step: 'accepted', id },
      },
    ];
  },
  checkPostStatus: async (token, pendingData, integration) => {
    record({
      method: 'checkPostStatus',
      token,
      integrationId: integration && integration.id,
      pendingData,
    });
    return {
      status: 'ready',
      pendingData: { step: 'finalize', id: pendingData.id },
    };
  },
  finalizePost: async (token, pendingData, integration) => {
    record({
      method: 'finalizePost',
      token,
      integrationId: integration && integration.id,
      pendingData,
    });
    return {
      status: 'completed',
      postId: pendingData.id,
      releaseURL: `https://stub.invalid/${pendingData.id}`,
    };
  },
  comment: async (internalId, postId, lastPostId, token, posts, integration) => {
    const id = `stub-comment-${process.pid}-${++publishCounter}`;
    record({
      method: 'comment',
      internalId,
      postId,
      lastPostId: lastPostId ?? null,
      token,
      integrationId: integration && integration.id,
      organizationId: integration && integration.organizationId,
      posts: await Promise.all(
        posts.map(async (p) => ({
          id: p.id,
          message: p.message,
          settings: p.settings,
          media: await describeMedia(p.media),
        }))
      ),
    });
    return [
      {
        id: posts[0]?.id,
        postId: id,
        releaseURL: `https://stub.invalid/${id}`,
        status: 'success',
      },
    ];
  },
  refreshToken: async (refreshToken) => {
    record({ method: 'refreshToken', refreshToken });
    return {
      accessToken: `synthetic-refreshed-access-${process.pid}-${Date.now()}`,
      refreshToken: 'synthetic-refresh-rotated',
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

const originalGet = integrationManager.IntegrationManager.prototype.getSocialIntegration;
integrationManager.IntegrationManager.prototype.getSocialIntegration = function (identifier) {
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

// The time-skipping test server advances the workflow clock but not the Node
// activity clock. The streak hand-off compares a DB timestamp with workflow
// Date.now(), so the streak scenario advances the synthetic "last post" value
// by the same offset to exercise the real continue-as-new gate.
if (process.env.T16_STREAK_LAST_POST_OFFSET_MS) {
  const offset = Number(process.env.T16_STREAK_LAST_POST_OFFSET_MS);
  const { EmailActivity } = require(join(
    distRoot,
    'apps/orchestrator/src/activities/email.activity.js'
  ));
  EmailActivity.prototype.getLastPublishDate = async () => Date.now() + offset;
  record({ method: 'preload', role: 'streak-last-post-offset', offset });
}

if (process.env.T16_STUB_EMAIL === '1') {
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
  const originalSendEmail = emailService.EmailService.prototype.sendEmail;
  emailService.EmailService.prototype.sendEmail = async function (to, subject, html, addTo, replyTo) {
    record({ method: 'newEmailWorkflow', to, subject, addTo });
    return originalSendEmail.call(this, to, subject, html, addTo, replyTo);
  };
  record({ method: 'preload', role: 'email' });
}
