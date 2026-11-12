/**
 * Synthetic fixtures for the rehearsal.
 *
 * Nothing here comes from a real deployment: ids, tokens, URLs and e-mail
 * addresses are invented and use the reserved `.invalid` TLD. The shapes mirror
 * the fields the old workflows read from `getPostsList`, so a replay exercises
 * the same payload path without storing production data.
 */

export const SYNTH_ORG_ID = 'org_synthetic_0001';
export const SYNTH_POST_ID = 'post_synthetic_0001';
export const SYNTH_INTEGRATION_ID = 'integration_synthetic_0001';
export const SYNTH_EMAIL = 'rehearsal@example.invalid';

/** A Prisma-shaped `Integration` row with synthetic credentials. */
export function syntheticIntegration(overrides = {}) {
  return {
    id: SYNTH_INTEGRATION_ID,
    name: 'Synthetic Channel',
    providerIdentifier: 'x',
    organizationId: SYNTH_ORG_ID,
    token: 'synthetic-access-token',
    refreshToken: 'synthetic-refresh-token',
    tokenExpiration: new Date('2027-01-01T00:00:00.000Z'),
    refreshNeeded: false,
    disabled: false,
    deletedAt: null,
    inBetweenSteps: false,
    customer: { id: 'synthetic-customer', name: 'Synthetic Customer' },
    ...overrides,
  };
}

/** A Prisma-shaped `Post` row, plus the nested integration the post workflow reads. */
export function syntheticPost(overrides = {}) {
  const publishDate = overrides.publishDate ?? new Date('2026-11-11T12:00:00.000Z');
  return {
    id: SYNTH_POST_ID,
    organizationId: SYNTH_ORG_ID,
    content: 'Synthetic rehearsal content',
    state: 'QUEUE',
    publishDate,
    intervalInDays: null,
    delay: 0,
    settings: JSON.stringify({}),
    image: JSON.stringify([]),
    integration: syntheticIntegration(),
    ...overrides,
  };
}

/** A `PostResponse` as returned by `postSocial` / `postComment`. */
export function syntheticPostResponse(overrides = {}) {
  return {
    id: 'synthetic-response-1',
    postId: 'synthetic-provider-post-1',
    releaseURL: 'https://synthetic.invalid/posts/1',
    status: 'completed',
    ...overrides,
  };
}

export const syntheticUserOrgs = {
  users: [
    {
      user: {
        id: 'user_synthetic_0001',
        email: SYNTH_EMAIL,
        sendStreakEmails: true,
        sendSuccessEmails: true,
        sendFailureEmails: true,
      },
    },
  ],
};

/** A signal payload for the old `sendEmailWorkflow` queue. */
export function syntheticEmail(overrides = {}) {
  return {
    to: SYNTH_EMAIL,
    subject: 'Synthetic rehearsal email',
    html: '<p>Synthetic rehearsal email</p>',
    replyTo: undefined,
    addTo: 'top',
    type: 'info',
    ...overrides,
  };
}
