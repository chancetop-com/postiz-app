// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_RELAY_PATH,
  CHANNEL_UPDATED,
  buildChannelRelayUrl,
  channelUpdatedMessage,
  isChannelUpdatedMessage,
  notifyChannelPopupOpener,
  subscribeToChannelUpdates,
} from '@gitroom/frontend/components/launches/channel.popup';

/**
 * Ticket 07: the iframe OAuth hand-off is one wire contract used by three
 * places — the parent that opens the relay, the relay page that seeds the
 * popup session and the popup that announces completion.
 *
 * The message keeps its `type`/`provider` fields. It means "refresh the list",
 * not "a channel was connected": 412/406 also send it.
 */

describe('the channel relay URL', () => {
  it('carries the session in the hash and the OAuth URL as the redirect', () => {
    const url = buildChannelRelayUrl('https://provider.example/oauth?a=1', {
      auth: 'jwt-a',
      showorg: 'org-a',
      impersonate: 'imp-a',
    });

    expect(url.startsWith(`${CHANNEL_RELAY_PATH}?redirect=`)).toBe(true);
    const [search, hash] = url.slice(CHANNEL_RELAY_PATH.length + 1).split('#');
    expect(new URLSearchParams(search).get('redirect')).toBe(
      'https://provider.example/oauth?a=1'
    );
    expect(new URLSearchParams(hash).get('auth')).toBe('jwt-a');
    expect(new URLSearchParams(hash).get('showorg')).toBe('org-a');
    expect(new URLSearchParams(hash).get('impersonate')).toBe('imp-a');
  });

  it('only sends the optional session values that exist', () => {
    const url = buildChannelRelayUrl('https://provider.example/oauth', {
      auth: 'jwt-a',
      showorg: '',
      impersonate: null,
    });

    expect(url).toBe(
      `${CHANNEL_RELAY_PATH}?redirect=${encodeURIComponent(
        'https://provider.example/oauth'
      )}#auth=jwt-a`
    );
  });
});

describe('the CHANNEL_UPDATED message', () => {
  it('keeps its type and provider fields', () => {
    expect(channelUpdatedMessage('instagram-standalone')).toEqual({
      type: CHANNEL_UPDATED,
      provider: 'instagram-standalone',
    });
    expect(isChannelUpdatedMessage(channelUpdatedMessage('tiktok'))).toBe(true);
  });

  it('is recognised by type only, as the current receiver does', () => {
    // baseline: no origin or source check is added by this merge
    expect(isChannelUpdatedMessage({ type: 'CHANNEL_UPDATED' })).toBe(true);
    expect(isChannelUpdatedMessage({ type: 'SOMETHING_ELSE' })).toBe(false);
    expect(isChannelUpdatedMessage(null)).toBe(false);
  });
});

describe('notifying the opener', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts once with the wildcard target the current flow uses', () => {
    const opener = { closed: false, postMessage: vi.fn() };
    notifyChannelPopupOpener('linkedin', opener as unknown as Window);

    expect(opener.postMessage).toHaveBeenCalledTimes(1);
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: 'CHANNEL_UPDATED', provider: 'linkedin' },
      '*'
    );
  });

  it('does nothing when the opener was lost or already closed', () => {
    expect(() =>
      notifyChannelPopupOpener('linkedin', null as unknown as Window)
    ).not.toThrow();
    const closed = { closed: true, postMessage: vi.fn() };
    notifyChannelPopupOpener('linkedin', closed as unknown as Window);
    expect(closed.postMessage).not.toHaveBeenCalled();
  });

  it('swallows cross-origin failures instead of breaking the close', () => {
    const opener = {
      closed: false,
      postMessage: () => {
        throw new Error('cross-origin');
      },
    };
    expect(() =>
      notifyChannelPopupOpener('linkedin', opener as unknown as Window)
    ).not.toThrow();
  });
});

describe('refreshing from the message', () => {
  it('only refreshes the list, and stops when unsubscribed', () => {
    const refresh = vi.fn();
    const unsubscribe = subscribeToChannelUpdates(refresh);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'CHANNEL_UPDATED', provider: 'youtube' },
      })
    );
    expect(refresh).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'x' } }));
    expect(refresh).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'CHANNEL_UPDATED' } })
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
