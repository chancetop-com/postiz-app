// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * Ticket 04: the browser session contract around SSO.
 *
 * auth/showorg/impersonate live in sessionStorage, are overwritten only by a
 * non-empty response header, ride on every request, and stay per tab. SSO does
 * not clear an existing session when it starts or fails, and it introduces no
 * longer-lived storage.
 */

let backendUrl = '';
let isGeneral = false;
const push = vi.fn();
const replace = vi.fn();
let search = 'auth_code=url-code';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl, isGeneral }),
}));

vi.mock('@gitroom/frontend/app/(app)/auth/return.url.component', () => ({
  useReturnUrl: () => ({ getAndClear: () => null }),
}));

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(async () => false),
}));

import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import SsoLoginPage from '@gitroom/frontend/app/(app)/sso/page';

type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

let request: FetchFn | undefined;
const Harness = () => {
  const fetch = useFetch();
  useEffect(() => {
    request = fetch as FetchFn;
  }, [fetch]);
  return null;
};

const renderShell = () => {
  render(
    <LayoutContext>
      <Harness />
    </LayoutContext>
  );
};

const reply = (headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify({ ok: true }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
  backendUrl = '';
  isGeneral = false;
  search = 'auth_code=url-code';
  replace.mockReset();
  push.mockReset();
  request = undefined;
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sessionStorage contract', () => {
  it('stores non-empty auth/showorg/impersonate response headers', async () => {
    const fetchMock = vi.fn(async () =>
      reply({
        auth: 'jwt-a',
        showorg: 'org-a',
        impersonate: 'user-imp',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/auth/sso', { method: 'POST' });

    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
    expect(window.sessionStorage.getItem('impersonate')).toBe('user-imp');
  });

  it('keeps the old values when a response header is empty or absent', async () => {
    window.sessionStorage.setItem('auth', 'jwt-old');
    window.sessionStorage.setItem('showorg', 'org-old');
    window.sessionStorage.setItem('impersonate', 'imp-old');
    const fetchMock = vi.fn(async () =>
      reply({ auth: '', showorg: '', impersonate: '' })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/user/self');

    expect(window.sessionStorage.getItem('auth')).toBe('jwt-old');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-old');
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-old');

    vi.mocked(fetchMock).mockResolvedValueOnce(reply());
    await request!('/user/self');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-old');
  });

  it('sends the stored session on every request', async () => {
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    window.sessionStorage.setItem('impersonate', 'imp-a');
    const fetchMock = vi.fn(async () => reply());
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/posts', { method: 'GET' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init!.headers as Record<string, string>;
    expect(headers.auth).toBe('jwt-a');
    expect(headers.showorg).toBe('org-a');
    expect(headers.impersonate).toBe('imp-a');
  });

  it('a manual organisation switch changes the organisation of the next request', async () => {
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-old');
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(reply({ showorg: 'org-new' }));
    fetchMock.mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/user/change-org', { method: 'POST' });
    expect(window.sessionStorage.getItem('showorg')).toBe('org-new');

    await request!('/posts');
    const [, init] = fetchMock.mock.calls[1];
    expect((init!.headers as Record<string, string>).showorg).toBe('org-new');
  });

  it('stays per tab: sessionStorage only, no cross-tab sync listener', async () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const fetchMock = vi.fn(async () => reply({ auth: 'jwt-a', showorg: 'org-a' }));
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/auth/sso', { method: 'POST' });

    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.localStorage.getItem('auth')).toBeNull();
    expect(window.localStorage.getItem('showorg')).toBeNull();
    expect(
      addListener.mock.calls.filter(([event]) => event === 'storage')
    ).toHaveLength(0);
  });
});

describe('SSO does not clear an existing session', () => {
  const seed = () => {
    window.sessionStorage.setItem('auth', 'jwt-previous');
    window.sessionStorage.setItem('showorg', 'org-previous');
    window.sessionStorage.setItem('impersonate', 'imp-previous');
  };

  it('leaves the old session untouched when the SSO exchange fails', async () => {
    seed();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({}, 400))
    );
    vi.spyOn(Response.prototype, 'text').mockResolvedValue('invalid code');

    render(
      <LayoutContext>
        <SsoLoginPage />
      </LayoutContext>
    );

    expect(await screen.findByText('invalid code')).toBeTruthy();
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-previous');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-previous');
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-previous');
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the old keys while a successful exchange runs', async () => {
    seed();
    const fetchMock = vi.fn(async () => {
      // the store must not be reset before or during the request
      expect(window.sessionStorage.getItem('auth')).toBe('jwt-previous');
      return reply({ auth: 'jwt-new', showorg: 'org-new' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LayoutContext>
        <SsoLoginPage />
      </LayoutContext>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/auth/sso']);
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-previous');
  });

  it('moves the tab from merchant A to merchant B on a successful exchange', async () => {
    seed();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ auth: 'jwt-b', showorg: 'org-b' }))
    );

    render(
      <LayoutContext>
        <SsoLoginPage />
      </LayoutContext>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-b');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-b');
    // baseline residue: the exchange does not set impersonate, so an existing
    // value survives the switch; this is recorded, not repaired here
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-previous');
  });
});
