// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Ticket 05: logout, 401 and impersonation keep their separate paths.
 *
 * Ordinary logout is a client action, a 401/logout header is a response
 * reaction, and the dedicated /auth/logout route is a proxy redirect. They are
 * not unified. Starting impersonation stores the response header; stopping it
 * sends an empty header that the client ignores, so the previous value stays in
 * sessionStorage. The latter is a recorded baseline gap.
 */

const deleteDialog = vi.fn();
let isGeneral = false;
let isSecured = true;

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: (...args: unknown[]) => deleteDialog(...args),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: '', isGeneral, isSecured }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

let request: FetchFn | undefined;
const Harness = () => {
  const fetch = useFetch();
  useEffect(() => {
    request = fetch as FetchFn;
  }, [fetch]);
  return null;
};

const reply = (headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify({ ok: true }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

interface StubLocation {
  href: string;
  pathname: string;
}

const stubLocation = (initial: string): StubLocation => {
  const location: StubLocation = {
    href: initial,
    pathname: new URL(initial).pathname,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).location;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).location = location;
  return location;
};

const seeded = () => {
  window.sessionStorage.setItem('auth', 'jwt-a');
  window.sessionStorage.setItem('showorg', 'org-a');
  window.sessionStorage.setItem('impersonate', 'imp-a');
};

const expectCleared = () => {
  expect(window.sessionStorage.getItem('auth')).toBeNull();
  expect(window.sessionStorage.getItem('showorg')).toBeNull();
  expect(window.sessionStorage.getItem('impersonate')).toBeNull();
};

beforeEach(() => {
  deleteDialog.mockReset();
  deleteDialog.mockResolvedValue(true);
  isGeneral = false;
  isSecured = true;
  request = undefined;
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ordinary logout', () => {
  it('clears the three session values after confirmation and goes to login', async () => {
    const location = stubLocation('http://localhost:4200/analytics');
    seeded();
    render(<LogoutComponent />);

    document.querySelector('div[class*="cursor-pointer"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await waitFor(() => expect(location.href).toBe('/auth/login'));
    expect(deleteDialog).toHaveBeenCalledTimes(1);
    expectCleared();
  });

  it('keeps the session when the person cancels the dialog', async () => {
    const location = stubLocation('http://localhost:4200/analytics');
    deleteDialog.mockResolvedValue(false);
    seeded();
    render(<LogoutComponent />);

    document.querySelector('div[class*="cursor-pointer"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await waitFor(() => expect(deleteDialog).toHaveBeenCalledTimes(1));
    expect(location.href).toBe('http://localhost:4200/analytics');
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-a');
  });
});

describe('401 and logout responses', () => {
  const renderShell = () =>
    render(
      <LayoutContext>
        <Harness />
      </LayoutContext>
    );

  it('clears the session and redirects on a 401', async () => {
    const location = stubLocation('http://localhost:4200/analytics');
    seeded();
    vi.stubGlobal('fetch', vi.fn(async () => reply({}, 401)));
    renderShell();

    await request!('/user/self');

    await waitFor(() => expect(location.href).toBe('/auth/login'));
    expectCleared();
  });

  it('clears the session and redirects on the logout response header', async () => {
    const location = stubLocation('http://localhost:4200/analytics');
    seeded();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ logout: 'true' })));
    renderShell();

    await request!('/posts');

    await waitFor(() => expect(location.href).toBe('/auth/login'));
    expectCleared();
  });

  it('does not clear anything on a network error', async () => {
    const location = stubLocation('http://localhost:4200/analytics');
    seeded();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    renderShell();

    await expect(request!('/posts')).rejects.toThrow('fetch failed');

    expect(location.href).toBe('http://localhost:4200/analytics');
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-a');
  });
});

describe('administrator impersonation', () => {
  const renderShell = () =>
    render(
      <LayoutContext>
        <Harness />
      </LayoutContext>
    );

  it('stores the impersonate header and sends it on the next request', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(reply({ impersonate: 'user-42' }));
    fetchMock.mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/user/impersonate', {
      method: 'POST',
      body: JSON.stringify({ id: 'user-42' }),
    });
    expect(window.sessionStorage.getItem('impersonate')).toBe('user-42');

    await request!('/posts');
    const [, init] = fetchMock.mock.calls[1];
    expect((init!.headers as Record<string, string>).impersonate).toBe(
      'user-42'
    );
  });

  it('recorded gap: stopping impersonation leaves the old value in sessionStorage', async () => {
    // /user/impersonate with id '' answers an empty `impersonate` header; the
    // client only overwrites non-empty headers, so the next request still
    // impersonates the previous user. Historical behaviour, not repaired here.
    window.sessionStorage.setItem('auth', 'jwt-admin');
    window.sessionStorage.setItem('impersonate', 'user-42');
    const location = stubLocation('http://localhost:4200/analytics');
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(reply({ impersonate: '' }));
    fetchMock.mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/user/impersonate', {
      method: 'POST',
      body: JSON.stringify({ id: '' }),
    });

    expect(window.sessionStorage.getItem('impersonate')).toBe('user-42');
    // the secured stop path does not clear the legacy cookie either
    expect(document.cookie).not.toContain('impersonate=');

    await request!('/posts');
    const [, init] = fetchMock.mock.calls[1];
    expect((init!.headers as Record<string, string>).impersonate).toBe(
      'user-42'
    );
    expect(location.href).toBe('http://localhost:4200/analytics');
  });
});
