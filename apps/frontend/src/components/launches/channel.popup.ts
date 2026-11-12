/**
 * The iframe channel-adding hand-off.
 *
 * An iframe cannot host the external OAuth consent screen, so the parent opens
 * a popup at `/channel-relay`, passing the current session in the URL hash. The
 * relay copies it into the popup's own `sessionStorage` and continues to the
 * provider. When the provider redirects back, the popup reports completion to
 * its opener and closes itself.
 *
 * The message means "refresh the channel list". 412/406 responses also send it,
 * so it is never proof that a channel was connected — the refreshed list from
 * `/integrations/list` is.
 */

export const CHANNEL_UPDATED = 'CHANNEL_UPDATED';
export const CHANNEL_POPUP_SESSION_KEY = 'channel_popup_mode';
export const CHANNEL_SESSION_KEYS = ['auth', 'showorg', 'impersonate'] as const;
export const CHANNEL_RELAY_PATH = '/channel-relay';

export interface ChannelUpdatedMessage {
  type: typeof CHANNEL_UPDATED;
  provider: string;
}

export const channelUpdatedMessage = (
  provider: string
): ChannelUpdatedMessage => ({
  type: CHANNEL_UPDATED,
  provider,
});

export const isChannelUpdatedMessage = (
  data: unknown
): data is ChannelUpdatedMessage =>
  !!data && typeof data === 'object' && (data as any).type === CHANNEL_UPDATED;

// Accessing window.top throws in a cross-origin iframe — that itself proves we
// are embedded, so the error is the answer rather than a failure.
export const isEmbeddedInIframe = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export const isChannelPopup = (): boolean =>
  typeof window !== 'undefined' &&
  window.sessionStorage.getItem(CHANNEL_POPUP_SESSION_KEY) === 'true';

export const markChannelPopup = (): void => {
  window.sessionStorage.setItem(CHANNEL_POPUP_SESSION_KEY, 'true');
};

export const buildChannelRelayUrl = (
  oauthUrl: string,
  session: Partial<Record<(typeof CHANNEL_SESSION_KEYS)[number], string | null>>
): string => {
  const hashParts = CHANNEL_SESSION_KEYS.map((key) =>
    key === 'auth'
      ? // always present, even empty: the relay stays inert without it
        `auth=${encodeURIComponent(session.auth || '')}`
      : session[key]
      ? `${key}=${encodeURIComponent(session[key]!)}`
      : ''
  )
    .filter(Boolean)
    .join('&');

  return `${CHANNEL_RELAY_PATH}?redirect=${encodeURIComponent(
    oauthUrl
  )}#${hashParts}`;
};

export const notifyChannelPopupOpener = (
  provider: string,
  opener: Window | null | undefined
): void => {
  try {
    if (opener && !opener.closed) {
      opener.postMessage(channelUpdatedMessage(provider), '*');
    }
  } catch {
    /* ignore cross-origin errors */
  }
};

/**
 * Refreshes the channel list whenever a popup announces completion. The
 * message carries no binding data, so the refresh is the only effect.
 */
export const subscribeToChannelUpdates = (refresh: () => void): (() => void) => {
  const handler = (event: MessageEvent) => {
    if (isChannelUpdatedMessage(event.data)) {
      refresh();
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
};
