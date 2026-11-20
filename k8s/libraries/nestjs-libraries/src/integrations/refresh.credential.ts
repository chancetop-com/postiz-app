import { Integration } from '@prisma/client';

/**
 * The batch refresh and the per-channel refresh can race on one channel.
 * A provider that rotates the refresh token rejects the loser, so the loser
 * may reuse the winner's credential instead of flagging a healthy channel.
 *
 * Only a healthy row whose credential was actually rotated by the parallel
 * writer qualifies: the same channel, a different (still unexpired) token.
 * Both refresh paths use this predicate; their retry cadence stays separate.
 */
export type RefreshAttempt = Pick<
  Integration,
  'internalId' | 'providerIdentifier' | 'refreshToken' | 'token'
>;

export const isRefreshableRow = (
  stored: Integration | null | undefined
): stored is Integration =>
  !!stored && !stored.refreshNeeded && !stored.inBetweenSteps && !stored.deletedAt;

export const isReusableRefreshCredential = (
  stored: Integration | null | undefined,
  attempted: RefreshAttempt
): stored is Integration =>
  isRefreshableRow(stored) &&
  stored.internalId === attempted.internalId &&
  stored.providerIdentifier === attempted.providerIdentifier &&
  !!stored.refreshToken &&
  stored.refreshToken !== attempted.refreshToken &&
  stored.token !== attempted.token &&
  !!stored.tokenExpiration &&
  stored.tokenExpiration.getTime() > Date.now();
