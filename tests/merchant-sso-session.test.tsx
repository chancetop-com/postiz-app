// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams('auth_code=url-code'),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: '', isGeneral: false, ssoParentOrigins: '' }),
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


beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  request = undefined;
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sessionStorage contract', () => {
  it('sends the stored session on every request', async () => {
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');
    window.sessionStorage.setItem('impersonate', 'imp-a');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
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
    fetchMock.mockResolvedValueOnce(
      new Response(null, { headers: { showorg: 'org-new' } })
    );
    fetchMock.mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/user/change-org', {
      method: 'POST',
      body: JSON.stringify({ id: 'org-new' }),
    });
    expect(window.sessionStorage.getItem('showorg')).toBe('org-new');

    await request!('/posts');
    const [, init] = fetchMock.mock.calls[1];
    expect((init!.headers as Record<string, string>).showorg).toBe('org-new');
  });

  it('sends no identity headers when the tab has no session', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ register: false })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderShell();

    await request!('/auth/can-register');

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    for (const name of ['auth', 'showorg', 'impersonate']) {
      expect(headers.has(name)).toBe(false);
    }
  });
});

describe('SSO with an existing session', () => {
  const seed = () => {
    window.sessionStorage.setItem('auth', 'jwt-previous');
    window.sessionStorage.setItem('showorg', 'org-previous');
    window.sessionStorage.setItem('impersonate', 'imp-previous');
  };

  it('leaves the old session untouched when the SSO exchange fails', async () => {
    seed();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid code', { status: 400 }))
    );

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

  it('moves the tab from merchant A to merchant B on a successful exchange', async () => {
    seed();
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        expect(window.sessionStorage.getItem('auth')).toBe('jwt-previous');
        return Response.json({ login: true }, {
          headers: { auth: 'jwt-b', showorg: 'org-b' },
        });
      })
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LayoutContext>
        <SsoLoginPage />
        <Harness />
      </LayoutContext>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-b');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-b');
    expect(window.localStorage.getItem('auth')).toBeNull();
    expect(window.localStorage.getItem('showorg')).toBeNull();
    await request!('/posts');
    const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(headers.get('auth')).toBe('jwt-b');
    expect(headers.get('showorg')).toBe('org-b');
  });
});
