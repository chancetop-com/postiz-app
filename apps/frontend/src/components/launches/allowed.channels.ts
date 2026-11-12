/**
 * The channel identifiers the add-channel surface offers.
 *
 * This is the product contract, matched by exact identifier: provider display
 * names are not unique (`tiktok-business` is also shown as "TikTok") and
 * platform families are broader than the agreed set (`linkedin-page`).
 *
 * Hiding an entry here is a UI decision only — the provider stays registered
 * on the backend and existing bindings keep working.
 */
export const ALLOWED_ADD_CHANNEL_IDENTIFIERS = [
  'youtube',
  'linkedin',
  'tiktok',
  'facebook',
  'instagram',
  'instagram-standalone',
] as const;

export const isAllowedAddChannel = (identifier: string) =>
  (ALLOWED_ADD_CHANNEL_IDENTIFIERS as readonly string[]).includes(identifier);
