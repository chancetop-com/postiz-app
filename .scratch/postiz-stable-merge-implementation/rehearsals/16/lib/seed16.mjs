/**
 * Extra synthetic fixtures for ticket 16.
 *
 * Builds on ticket 15's seed helpers (organisation, channel, media, root post)
 * and adds only the shapes this ticket needs: comment children, repeat posts,
 * refresh-enabled channels and stale posts for the sweep.
 */
import { seedOrganization, seedPost } from '../../15/lib/seed.mjs';

export { seedOrganization, seedPost, ONE_PIXEL_PNG, sha256, snapshotPost } from '../../15/lib/seed.mjs';

let counter = 0;
const unique = (prefix) => `${prefix}-${Date.now().toString(36)}-${++counter}`;

/** Root post plus a delayed comment child, both in the pre-upgrade shape. */
export async function seedCommentThread(
  prisma,
  {
    organization,
    integration,
    media,
    publishDate,
    rootContent = 'Synthetic root post',
    commentContent = 'Synthetic delayed comment',
    delayMinutes = 1,
  }
) {
  const group = unique('group');
  const root = await seedPost(prisma, {
    organization,
    integration,
    media,
    publishDate,
    state: 'QUEUE',
    content: rootContent,
    group,
  });
  const comment = await seedPost(prisma, {
    organization,
    integration,
    media,
    publishDate,
    state: 'QUEUE',
    content: commentContent,
    group,
    withImage: false,
    parentPostId: root.id,
    delay: delayMinutes,
  });
  return { root, comment, group };
}

/** A repeating post rooted at `publishDate`, with the old interval column. */
export async function seedRepeatPost(
  prisma,
  { organization, integration, media, publishDate, content, intervalInDays = 1 }
) {
  return seedPost(prisma, {
    organization,
    integration,
    media,
    publishDate,
    state: 'QUEUE',
    content,
    intervalInDays,
  });
}

/** Channel with a token about to expire, so refreshTokenWorkflow acts. */
export async function seedRefreshChannel(
  prisma,
  {
    organization,
    tokenExpiration,
    provider = 'bluesky',
    refreshNeeded = false,
  }
) {
  const suffix = unique('refresh');
  const integration = await prisma.integration.create({
    data: {
      id: `int_${suffix}`,
      internalId: `stub-internal-${suffix}`,
      organizationId: organization.id,
      name: 'Synthetic refresh channel',
      providerIdentifier: provider,
      type: 'social',
      token: `synthetic-token-${suffix}`,
      refreshToken: `synthetic-refresh-${suffix}`,
      tokenExpiration,
      refreshNeeded,
      picture: null,
    },
  });
  return integration;
}

/** A stale QUEUE root the missing-posts sweep can find. */
export async function seedStalePost(
  prisma,
  { organization, integration, media, publishDate, content, intervalInDays = null }
) {
  return seedPost(prisma, {
    organization,
    integration,
    media,
    publishDate,
    state: 'QUEUE',
    content,
    intervalInDays,
  });
}

export { seedAutopost } from '../../15/lib/seed.mjs';
