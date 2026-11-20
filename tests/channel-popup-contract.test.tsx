// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_RELAY_PATH,
  CHANNEL_UPDATED,
  buildChannelRelayUrl,
  channelUpdatedMessage,
  isChannelUpdatedMessage,
  notifyChannelPopupOpener,
  openChannelOAuth,
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

describe('opening a channel OAuth from the dashboard', () => {
  const stubLocation = () => {
    const location = { href: 'http://localhost:4200/launches', hash: '' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).location;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).location = location;
    return location;
  };

  const openSpy = () => {
    const opened: any[] = [];
    vi.spyOn(window, 'open').mockImplementation(((...args: any[]) => {
      opened.push(args);
      return { closed: false } as any;
    }) as any);
    return opened;
  };

  // The helper decides from window.self !== window.top. Shadow `top` for the
  // duration of one call so both branches are exercised without an iframe.
  const stubEmbedded = (embedded: boolean) => {
    Object.defineProperty(window, 'top', {
      configurable: true,
      value: embedded ? {} : window,
    });
  };

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).top;
    window.sessionStorage.clear();
  });

  it('navigates the current window in a standalone window', () => {
    const location = stubLocation();
    const opened = openSpy();
    stubEmbedded(false);

    const mode = openChannelOAuth('https://provider.example/oauth');

    expect(mode).toBe('window');
    expect(location.href).toBe('https://provider.example/oauth');
    expect(opened).toHaveLength(0);
  });

  it('opens the relay popup with the tab session inside the iframe', () => {
    const location = stubLocation();
    const opened = openSpy();
    stubEmbedded(true);
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    window.sessionStorage.setItem('impersonate', 'imp-a');

    const mode = openChannelOAuth('https://provider.example/oauth?x=1');

    expect(mode).toBe('popup');
    expect(location.href).toBe('http://localhost:4200/launches');
    expect(opened).toHaveLength(1);
    expect(opened[0][1]).toBe('_blank');
    expect(opened[0][2]).toBe('popup,width=600,height=700');

    const url = new URL(opened[0][0], 'http://localhost:4200');
    expect(url.pathname).toBe(CHANNEL_RELAY_PATH);
    expect(url.searchParams.get('redirect')).toBe(
      'https://provider.example/oauth?x=1'
    );
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(hash.get('auth')).toBe('jwt-a');
    expect(hash.get('showorg')).toBe('org-a');
    expect(hash.get('impersonate')).toBe('imp-a');
  });
});
