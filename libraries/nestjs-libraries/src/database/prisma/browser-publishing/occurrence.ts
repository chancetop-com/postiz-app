import type { BrowserPlatform, BrowserProvider, BrowserPublishAction } from '@gitroom/helpers/utils/browser-publishing';

export const revokedReasonCode = 'authorization_declined';
const legacyRevokedReason = 'Browser channel is no longer authorized';
export const revokedBrowserChannel = legacyRevokedReason;

export function isRevokedReason(reason: string | null) {
  return reason === revokedReasonCode || reason === legacyRevokedReason;
}

export function browserReasonMessage(reason: string | null) {
  return isRevokedReason(reason) ? revokedBrowserChannel : reason;
}

export interface BrowserOccurrenceRef {
  workflowId: string;
  postId: string;
  organizationId: string;
}

export interface BrowserStartRef extends BrowserOccurrenceRef {
  resultDeadlineAt?: string;
  preparedMedia?: BrowserPublishTask['media'];
  mediaFailed?: boolean;
}

export type BrowserOutcome =
  | 'published'
  | 'failed'
  | 'timed_out'
  | 'prepared'
  | 'unknown';

export interface BrowserPublishTask extends BrowserOccurrenceRef {
  contractVersion: 1;
  requiredCapability: `${BrowserPlatform}.${BrowserPublishAction}`;
  release: string;
  channelId: string;
  bindingId: string;
  provider: BrowserProvider;
  profileId: string;
  platform: BrowserPlatform;
  action: BrowserPublishAction;
  caption: string;
  settings: Record<string, unknown>;
  media: { id: string; url: string; role: 'video' | 'cover' | 'image' }[];
  earliestPublishAt: string | null;
  noPublish: boolean;
  claimDeadlineAt: string;
}

export function browserClaimDeadline(dueAt: Date): Date {
  const seconds = Number(process.env.BROWSER_CLAIM_TIMEOUT_SECONDS ?? 1800);
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    throw new Error('BROWSER_CLAIM_TIMEOUT_SECONDS must be a positive integer');
  return new Date(dueAt.getTime() + seconds * 1000);
}

export interface BrowserReviewDecision {
  outcome: 'published' | 'failed';
  releaseId?: string;
  url?: string;
  note?: string;
}
