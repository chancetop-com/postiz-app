/**
 * Provider and e-mail boundary stubs, preloaded into the *real* candidate
 * processes with `NODE_OPTIONS=--require`.
 *
 * The candidate worker and API run unmodified; only the two external
 * boundaries the rehearsal cannot reach are replaced:
 *   - the social provider for the synthetic `bluesky` channel, and
 *   - the e-mail provider used by EmailService.
 *
 * Every call is appended to T15_CALL_LOG as one JSON line, including the exact
 * payload the workflow/activity handed over and a digest of the media file the
 * activity actually read from the local volume.
 */
const { appendFileSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const distRoot = process.env.T15_DIST_ROOT;
const callLog = process.env.T15_CALL_LOG;

if (!distRoot || !callLog) {
  throw new Error('T15_DIST_ROOT and T15_CALL_LOG are required');
}

const record = (entry) => {
  appendFileSync(
    callLog,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\n'
  );
};

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
  // Old blocking contract used by V101/V102 and every pre-pending workflow.
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
  // New pending/finalize contract used by V112. The post is accepted, then the
  // workflow has to poll and finalize before it becomes "completed".
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
record({ method: 'preload', role: 'provider', identifier: provider.identifier, redisUrl: process.env.REDIS_URL ?? null, pid: process.pid });

if (process.env.T15_STUB_EMAIL === '1') {
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
  // The per-email workflow start is the boundary between the activity that
  // decided to notify and the e-mail task queues. Recording it (while still
  // calling the shipped implementation) proves the new path was used.
  const originalSendEmail = emailService.EmailService.prototype.sendEmail;
  emailService.EmailService.prototype.sendEmail = async function (to, subject, html, addTo, replyTo) {
    record({ method: 'newEmailWorkflow', to, subject, addTo });
    return originalSendEmail.call(this, to, subject, html, addTo, replyTo);
  };
  record({ method: 'preload', role: 'email' });
}
