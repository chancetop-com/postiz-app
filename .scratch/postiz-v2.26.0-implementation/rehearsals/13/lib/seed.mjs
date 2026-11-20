/**
 * Synthetic business data for the fault/recovery rehearsal (ticket 13).
 *
 * Same shapes as ticket 12 (so its normal samples and this run target the same
 * boundary), with the media path under `rehearsal13`. Ids, credentials, e-mail
 * addresses and media are invented.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export const sha256 = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');

let counter = 0;
export const unique = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${++counter}`;

const ENCRYPTED_PREFIX = 'enc:v1:';
export function encryptValue(plain, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  const id = createHash('sha256').update(key).digest('hex').slice(0, 8);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    iv,
    cipher.update(plain, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${ENCRYPTED_PREFIX}${id}:${data.toString('base64')}`;
}

export async function seedOrganization(
  prisma,
  { uploadDirectory, encryptWithKey, tokenExpiration } = {}
) {
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
      timezone: 480,
      timezoneName: 'Asia/Shanghai',
      sendStreakEmails: false,
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

  const token = `synthetic-token-${suffix}`;
  const refreshToken = `synthetic-refresh-${suffix}`;
  const integration = await prisma.integration.create({
    data: {
      id: `int_${suffix}`,
      internalId: `stub-internal-${suffix}`,
      organizationId: organization.id,
      name: 'Synthetic Bluesky',
      providerIdentifier: 'bluesky',
      type: 'social',
      token: encryptWithKey ? encryptValue(token, encryptWithKey) : token,
      refreshToken: encryptWithKey
        ? encryptValue(refreshToken, encryptWithKey)
        : refreshToken,
      tokenExpiration: tokenExpiration ?? null,
      refreshNeeded: false,
      inBetweenSteps: false,
      disabled: false,
    },
  });

  const mediaPath = `/uploads/rehearsal13/${suffix}.png`;
  const absolute = join(uploadDirectory, mediaPath);
  mkdirSync(join(uploadDirectory, 'uploads/rehearsal13'), { recursive: true });
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
    plainToken: token,
    plainRefreshToken: refreshToken,
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
    deletedAt = null,
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
      deletedAt,
      settings: JSON.stringify({}),
      image: withImage && media ? postImage(media) : '[]',
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
    updatedAt: post.updatedAt.toISOString(),
  };
}

/**
 * The durable error row written by changeState(ERROR, err, postsList). The
 * ticket-13 classification reads it instead of the (possibly overwritten)
 * post.error.
 */
export async function errorsFor(prisma, postId) {
  return prisma.errors.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    select: {
      message: true,
      body: true,
      platform: true,
      createdAt: true,
    },
  });
}

export async function notificationsFor(prisma, organizationId) {
  return prisma.notifications.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: { content: true, createdAt: true },
  });
}
