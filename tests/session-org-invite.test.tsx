// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

/**
 * Ticket 03: accepting an invitation in the tab that carries the session.
 *
 * The session lives in sessionStorage, so the invite link reaches a client
 * page. That page keeps the signed token in sessionStorage and sends it as the
 * `org-invite` header. The switch to the invited organization comes back as
 * `showorg`, which LayoutContext stores for this tab only.
 */

const query = vi.hoisted(() => ({ value: '' }));
let isGeneral = true;
const location = { href: 'http://localhost:4200/auth/login', pathname: '/auth/login' };

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query.value),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: '', isGeneral }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(async () => false),
}));

vi.mock('@gitroom/frontend/components/auth/providers/google.provider', () => ({
  GoogleProvider: () => null,
}));
vi.mock('@gitroom/frontend/components/auth/providers/github.provider', () => ({
  GithubProvider: () => null,
}));
vi.mock('@gitroom/frontend/components/auth/providers/oauth.provider', () => ({
  OauthProvider: () => null,
}));
vi.mock('@gitroom/frontend/components/auth/providers/apple.provider', () => ({
  AppleProvider: () => null,
}));
vi.mock(
  '@gitroom/frontend/components/auth/providers/farcaster.provider',
  () => ({ FarcasterProvider: () => null })
);
vi.mock('@gitroom/frontend/components/auth/providers/wallet.provider', () => ({
  default: () => null,
}));

import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { Login } from '@gitroom/frontend/components/auth/login';

const reply = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const renderLogin = () =>
  render(
    <LayoutContext>
      <Login />
    </LayoutContext>
  );

const joinCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/user/join-org');

const loginCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/auth/login');

beforeEach(() => {
  query.value = '';
  isGeneral = true;
  location.href = 'http://localhost:4200/auth/login';
  location.pathname = '/auth/login';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).location;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).location = location;
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.cookie = 'showorg=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a signed-in tab accepting an invitation', () => {
  it('adds the membership, stores showorg for this tab and leaves the app', async () => {
    query.value = 'org=signed-invite';
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    const fetchMock = vi.fn(async () =>
      reply({ id: 'org-b' }, { showorg: 'org-b' })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();

    await waitFor(() => expect(location.href).toBe('/launches'));
    expect(joinCalls(fetchMock)).toHaveLength(1);
    const [, init] = joinCalls(fetchMock)[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ org: 'signed-invite' });
    expect(init.headers).toEqual(
      expect.objectContaining({ auth: 'jwt-a', showorg: 'org-a' })
    );
    expect(window.sessionStorage.getItem('showorg')).toBe('org-b');
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).not.toContain('showorg=');
  });

  it('keeps the current organization when the invitation adds no membership', async () => {
    query.value = 'org=already-a-member';
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    const fetchMock = vi.fn(async () => reply({ id: null }));
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();

    await waitFor(() => expect(location.href).toBe('/launches'));
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
  });

  it('keeps the current organization when the invitation is expired or invalid', async () => {
    query.value = 'org=expired-invite';
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    vi.stubGlobal('fetch', vi.fn(async () => reply({ id: null })));

    renderLogin();

    await waitFor(() => expect(location.href).toBe('/launches'));
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
    expect(document.cookie).not.toContain('showorg=');
  });

  it('does not accept an invite in a tab without a session', async () => {
    query.value = 'org=signed-invite';
    const fetchMock = vi.fn(async () => reply({ id: 'org-b' }));
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();

    await waitFor(() =>
      expect(window.sessionStorage.getItem('org-invite')).toBe('signed-invite')
    );
    expect(joinCalls(fetchMock)).toHaveLength(0);
  });
});

describe('password login with a pending invitation', () => {
  const submitCredentials = () => {
    fireEvent.change(document.querySelector('input[type="email"]')!, {
      target: { value: 'merchant@example.test' },
    });
    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: 'correct horse' },
    });
    fireEvent.submit(document.querySelector('form')!);
  };

  it('sends the signed invite as a header and follows the showorg response', async () => {
    query.value = 'org=signed-invite';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/auth/login') {
        return reply({ login: true }, { auth: 'jwt-a', showorg: 'org-b', reload: 'true' });
      }
      return reply({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    await waitFor(() =>
      expect(window.sessionStorage.getItem('org-invite')).toBe('signed-invite')
    );
    submitCredentials();

    await waitFor(() => expect(loginCalls(fetchMock)).toHaveLength(1));
    const [, init] = loginCalls(fetchMock)[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ 'org-invite': 'signed-invite' })
    );
    await waitFor(() => expect(location.href).toBe('/launches'));
    expect(window.sessionStorage.getItem('showorg')).toBe('org-b');
    expect(window.sessionStorage.getItem('org-invite')).toBeNull();
  });

  it('logs in without an invite header when there is no pending invitation', async () => {
    const fetchMock = vi.fn(async () =>
      reply({ login: true }, { auth: 'jwt-a', reload: 'true' })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    submitCredentials();

    await waitFor(() => expect(loginCalls(fetchMock)).toHaveLength(1));
    const [, init] = loginCalls(fetchMock)[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['org-invite']).toBeUndefined();
  });
});
