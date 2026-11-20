// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

/**
 * Ticket 07: adding a channel from the parent application.
 *
 * Embedded (iframe) adds open a popup at the relay with the current session in
 * the hash. Ordinary browser windows navigate the current window. A 402 from
 * the connect request stops the flow before anything is parsed or opened.
 */

const push = vi.fn();
let relaySearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(relaySearch),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => variables,
}));
const showToast = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: showToast }),
}));
const closeAll = vi.fn();
vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

const setEmbedded = (value: boolean) => {
  // openChannelOAuth asks window.self !== window.top; shadow `top` so the
  // parent-iframe branch is exercised without a real iframe.
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: value ? {} : window,
  });
};

import { AddProviderComponent } from '@gitroom/frontend/components/launches/add.provider.component';
import { useExtensionConnect } from '@gitroom/frontend/components/launches/add.provider.component';

let variables = { isGeneral: false, extensionId: '', backendUrl: '' };

const social = [
  { identifier: 'linkedin', name: 'LinkedIn', isExternal: false, isWeb3: false },
  { identifier: 'youtube', name: 'YouTube', isExternal: false, isWeb3: false },
];

interface StubLocation {
  href: string;
  hash: string;
}

const stubLocation = (): StubLocation => {
  const location: StubLocation = {
    href: 'http://localhost:4200/launches',
    hash: '',
  };
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

const clickTile = (container: HTMLElement, icon: string) => {
  const image = container.querySelector(`img[src="${icon}"]`);
  expect(image).not.toBeNull();
  fireEvent.click(image!);
};

const renderAdd = () =>
  render(<AddProviderComponent social={social} article={[]} invite={false} />);

beforeEach(() => {
  setEmbedded(false);
  relaySearch = '';
  push.mockReset();
  closeAll.mockReset();
  showToast.mockReset();
  window.sessionStorage.clear();
  variables = { isGeneral: false, extensionId: '', backendUrl: '' };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).top;
});

describe('adding a channel in an ordinary window', () => {
  it('navigates the current window to the provider', async () => {
    const location = stubLocation();
    const opened = openSpy();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ url: 'https://provider.example/oauth' }),
            { status: 200 }
          )
      )
    );

    const { container } = renderAdd();
    clickTile(container, '/icons/platforms/linkedin.png');

    await waitFor(() =>
      expect(location.href).toBe('https://provider.example/oauth')
    );
    expect(opened).toHaveLength(0);
    expect(closeAll).not.toHaveBeenCalled();
  });

  it('stops on 402 without parsing the body or navigating', async () => {
    const location = stubLocation();
    const opened = openSpy();
    const json = vi.fn();
    const fetchMock = vi.fn(async () => ({ status: 402, json }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderAdd();
    clickTile(container, '/icons/platforms/linkedin.png');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(json).not.toHaveBeenCalled();
    expect(location.href).toBe('http://localhost:4200/launches');
    expect(opened).toHaveLength(0);
  });
});

describe('adding a channel inside the parent application iframe', () => {
  beforeEach(() => {
    setEmbedded(true);
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    window.sessionStorage.setItem('impersonate', 'imp-a');
  });

  it('opens the relay popup with the session in the hash instead of navigating', async () => {
    const location = stubLocation();
    const opened = openSpy();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ url: 'https://provider.example/oauth?x=1' }),
            { status: 200 }
          )
      )
    );

    const { container } = renderAdd();
    clickTile(container, '/icons/platforms/youtube.svg');

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0][1]).toBe('_blank');
    expect(opened[0][2]).toBe('popup,width=600,height=700');

    const url = new URL(opened[0][0], 'http://localhost:4200');
    expect(url.pathname).toBe('/channel-relay');
    expect(url.searchParams.get('redirect')).toBe(
      'https://provider.example/oauth?x=1'
    );
    expect(new URLSearchParams(url.hash.slice(1)).get('auth')).toBe('jwt-a');
    expect(new URLSearchParams(url.hash.slice(1)).get('showorg')).toBe('org-a');
    expect(new URLSearchParams(url.hash.slice(1)).get('impersonate')).toBe(
      'imp-a'
    );

    // the iframe itself must not leave the parent application
    expect(location.href).toBe('http://localhost:4200/launches');
    expect(closeAll).toHaveBeenCalled();
  });

  it('stops on 402 before opening any popup', async () => {
    const location = stubLocation();
    const opened = openSpy();
    const good = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 402, json: good })));

    const { container } = renderAdd();
    clickTile(container, '/icons/platforms/linkedin.png');

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(good).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0);
    expect(location.href).toBe('http://localhost:4200/launches');
  });

  it('leaves the iframe in place when the popup is blocked', async () => {
    const location = stubLocation();
    vi.spyOn(window, 'open').mockImplementation((() => null) as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ url: 'https://provider.example/oauth' }),
            { status: 200 }
          )
      )
    );

    const { container } = renderAdd();
    clickTile(container, '/icons/platforms/linkedin.png');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('pop-ups'),
        'warning'
      )
    );
    expect(closeAll).not.toHaveBeenCalled();
    expect(location.href).toBe('http://localhost:4200/launches');
  });

  it('hands the session to the popup through the relay page, hop by hop', async () => {
    const location = stubLocation();
    const opened = openSpy();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ url: 'https://provider.example/oauth?x=1' }),
            { status: 200 }
          )
      )
    );

    const { container } = renderAdd();
    clickTile(container, '/icons/platforms/youtube.svg');
    await waitFor(() => expect(opened).toHaveLength(1));

    const relayUrl = new URL(opened[0][0], 'http://localhost:4200');

    // the popup is a fresh window: nothing inherited from the parent
    window.sessionStorage.clear();
    relaySearch = relayUrl.search.replace(/^\?/, '');
    location.hash = relayUrl.hash;
    location.href = relayUrl.origin + relayUrl.pathname;

    const { default: ChannelRelayPage } = await import(
      '@gitroom/frontend/app/(app)/channel-relay/page'
    );
    render(<ChannelRelayPage />);

    await waitFor(() =>
      expect(location.href).toBe('https://provider.example/oauth?x=1')
    );
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-a');
    expect(window.sessionStorage.getItem('channel_popup_mode')).toBe('true');
  });
});

describe('reconnecting an existing extension channel', () => {
  const ExtensionReconnect = ({
    identifier,
    refresh,
  }: {
    identifier: string;
    refresh: string;
  }) => {
    const connect = useExtensionConnect();
    return (
      <button onClick={() => connect(identifier, { refresh })}>Reconnect</button>
    );
  };

  const stubChrome = (cookies: Array<Record<string, string>>) => {
    const chromeMock = {
      runtime: {
        lastError: null,
        sendMessage: vi.fn(
          (_id: string, message: any, callback: (value: any) => void) => {
            if (message.type === 'PING') {
              callback({ status: true });
              return;
            }
            if (message.type === 'GET_COOKIES') {
              callback({ success: true, cookies });
            }
          }
        ),
      },
    };
    vi.stubGlobal('chrome', chromeMock);
    return chromeMock;
  };

  it('reuses the cookie hand-off with the channel refresh id', async () => {
    variables = {
      isGeneral: false,
      extensionId: 'extension-id',
      backendUrl: 'http://localhost:3105',
    };
    const chromeMock = stubChrome([{ name: 'session', value: 'cookie-1' }]);
    const location = stubLocation();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: 'state-token' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByText } = render(
      <ExtensionReconnect identifier="skool" refresh="internal-9" />
    );
    fireEvent.click(getByText('Reconnect'));

    await waitFor(() =>
      expect(location.href).toContain('/integrations/social/skool')
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/integrations/social/skool?refresh=internal-9',
      expect.anything()
    );
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      'extension-id',
      { type: 'GET_COOKIES', provider: 'skool' },
      expect.any(Function)
    );

    const url = new URL(location.href, 'http://localhost:4200');
    expect(url.searchParams.get('state')).toBe('state-token');
    expect(
      JSON.parse(
        Buffer.from(url.searchParams.get('code')!, 'base64').toString()
      )
    ).toEqual([{ name: 'session', value: 'cookie-1' }]);
    expect(url.searchParams.get('onboarding')).toBeNull();
  });
});
