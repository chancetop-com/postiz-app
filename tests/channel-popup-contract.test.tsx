// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_RELAY_PATH,
  buildChannelRelayUrl,
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
  it('only sends the optional session values that exist', () => {
    const url = new URL(buildChannelRelayUrl('https://provider.example/oauth', {
      auth: 'jwt-a',
      showorg: '',
      impersonate: null,
    }), 'https://dashboard.example');

    expect(url.pathname).toBe(CHANNEL_RELAY_PATH);
    expect(url.searchParams.get('redirect')).toBe('https://provider.example/oauth');
    expect([...new URLSearchParams(url.hash.slice(1))]).toEqual([['auth', 'jwt-a']]);
  });
});

describe('notifying the opener', () => {
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
