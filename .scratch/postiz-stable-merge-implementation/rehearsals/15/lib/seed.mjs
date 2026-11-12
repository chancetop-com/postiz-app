/**
 * Synthetic business data for the rehearsal.
 *
 * Every id, credential, user and post is invented here. The shape matches what
 * the pre-upgrade code stored, including a media file on the local volume that
 * the candidate worker has to actually read to publish.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export const sha256 = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');

let counter = 0;
const unique = (prefix) => `${prefix}-${Date.now().toString(36)}-${++counter}`;

/**
 * Creates an organisation with a user, a `bluesky` channel bound to the stub
 * provider, an old-schema media file and a webhook.
 */
export async function seedOrganization(prisma, { uploadDirectory, provider = 'bluesky' } = {}) {
  const suffix = unique('org');
  const organization = await prisma.organization.create({
    data: {
      id: `org_${suffix}`,
      name: `Synthetic ${suffix}`,
      apiKey: `synthetic-api-key-${suffix}`,
    },
  });

  const user = await prisma.user.create({
    data: {
      id: `user_${suffix}`,
      email: `${suffix}@synthetic.invalid`,
      providerName: 'GENERIC',
      timezone: 0,
      timezoneName: 'UTC',
      sendStreakEmails: true,
    },
  });

  await prisma.userOrganization.create({
    data: {
      id: `uo_${suffix}`,
      userId: user.id,
      organizationId: organization.id,
      role: 'SUPERADMIN',
    },
  });

  const integration = await prisma.integration.create({
    data: {
      id: `int_${suffix}`,
      internalId: `stub-internal-${suffix}`,
      organizationId: organization.id,
      name: 'Synthetic Bluesky',
      providerIdentifier: provider,
      type: 'social',
      token: `synthetic-token-${suffix}`,
      refreshToken: `synthetic-refresh-${suffix}`,
    },
  });

  const mediaPath = `/uploads/rehearsal15/${suffix}.png`;
  const absolute = join(uploadDirectory, mediaPath);
  mkdirSync(join(uploadDirectory, 'uploads/rehearsal15'), { recursive: true });
  writeFileSync(absolute, ONE_PIXEL_PNG);

  const media = await prisma.media.create({
    data: {
      id: `media_${suffix}`,
      name: `${suffix}.png`,
      originalName: 'legacy.png',
      path: mediaPath,
      organizationId: organization.id,
      fileSize: ONE_PIXEL_PNG.length,
      type: 'image',
      status: 'ready',
    },
  });

  await prisma.webhooks.create({
    data: {
      id: `wh_${suffix}`,
      name: 'Synthetic webhook',
      organizationId: organization.id,
      url: 'http://127.0.0.1:9/synthetic-webhook',
    },
  });

  return {
    organization,
    user,
    integration,
    media,
    mediaAbsolutePath: absolute,
    mediaSha256: sha256(ONE_PIXEL_PNG),
  };
}

export function postImage(media) {
  return JSON.stringify([
    {
      id: media.id,
      name: media.name,
      originalName: media.originalName,
      path: media.path,
    },
  ]);
}

/** Root post with an optional comment, in the pre-upgrade column shape. */
export async function seedPost(prisma, options) {
  const {
    organization,
    integration,
    media,
    content = 'Synthetic scheduled post',
    publishDate,
    state = 'QUEUE',
    group = unique('group'),
    intervalInDays = null,
    withImage = true,
    parentPostId = null,
    delay = 0,
  } = options;

  return prisma.post.create({
    data: {
      id: unique('post'),
      state,
      publishDate,
      organizationId: organization.id,
      integrationId: integration.id,
      content,
      group,
      parentPostId,
      delay,
      intervalInDays,
      settings: JSON.stringify({}),
      image: withImage && media ? postImage(media) : '[]',
    },
  });
}

export async function seedAutopost(prisma, { organization, integration, url, content }) {
  return prisma.autoPost.create({
    data: {
      id: unique('autopost'),
      organizationId: organization.id,
      title: 'Synthetic autopost',
      content,
      onSlot: false,
      syncLast: false,
      url,
      lastUrl: '',
      active: true,
      addPicture: false,
      generateContent: false,
      integrations: JSON.stringify([{ id: integration.id }]),
    },
  });
}

export async function snapshotPost(prisma, id) {
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return null;
  return {
    id: post.id,
    state: post.state,
    publishDate: post.publishDate.toISOString(),
    releaseId: post.releaseId,
    releaseURL: post.releaseURL,
    error: post.error,
    deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
    image: post.image,
  };
}
