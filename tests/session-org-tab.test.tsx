// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Ticket 05: one tab moving from merchant A to merchant B.
 *
 * The specification keeps the historical behaviour: the exchange replaces the
 * auth/showorg values it receives, but does not clear anything else, and does
 * not synchronise tabs. That leaves a stale `impersonate` value (and, after a
 * failed exchange, the whole previous merchant session) in place. Those are
 * recorded baseline gaps, not permissions to add a cleanup this merge.
 */

let backendUrl = '';
let isGeneral = false;
const push = vi.fn();
const replace = vi.fn();
let search = 'auth_code=merchant-b';

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
import SsoLoginPage from '@gitroom/frontend/app/(app)/sso/page';
import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';

const reply = (headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify({ ok: true }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const seedMerchantA = () => {
  window.sessionStorage.setItem('auth', 'jwt-a');
  window.sessionStorage.setItem('showorg', 'org-a');
  window.sessionStorage.setItem('impersonate', 'imp-person-a');
};

const renderSso = () =>
  render(
    <LayoutContext>
      <SsoLoginPage />
    </LayoutContext>
  );

const headersOf = async (
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex = 0
) => {
  const [, init] = fetchMock.mock.calls[callIndex];
  return (init!.headers || {}) as Record<string, string>;
};

beforeEach(() => {
  backendUrl = '';
  isGeneral = false;
  search = 'auth_code=merchant-b';
  replace.mockReset();
  push.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('merchant A to merchant B in the same tab', () => {
  it('replaces auth/showorg but keeps the old impersonate on the next real request', async () => {
    seedMerchantA();
    const fetchMock = vi.fn(async () =>
      reply({ auth: 'jwt-b', showorg: 'org-b' })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSso();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-b');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-b');

    // baseline gap: the exchange response has no impersonate header, so the
    // request that follows still carries merchant A's impersonation value
    const request = customFetch({ baseUrl: '' });
    await request('/posts');
    const headers = await headersOf(fetchMock, 1);
    expect(headers.auth).toBe('jwt-b');
    expect(headers.showorg).toBe('org-b');
    expect(headers.impersonate).toBe('imp-person-a');
  });

  it('leaves merchant A active when merchant B fails', async () => {
    seedMerchantA();
    const fetchMock = vi.fn(async () => reply({}, 400));
    vi.spyOn(Response.prototype, 'text').mockResolvedValue('invalid code');
    vi.stubGlobal('fetch', fetchMock);
    renderSso();

    await waitFor(() => expect(replace).not.toHaveBeenCalled());

    const request = customFetch({ baseUrl: '' });
    await request('/posts');
    const headers = await headersOf(fetchMock, 1);
    expect(headers.auth).toBe('jwt-a');
    expect(headers.showorg).toBe('org-a');
    expect(headers.impersonate).toBe('imp-person-a');
  });
});

describe('tab lifetime', () => {
  it('keeps the same sessionStorage after a remount (refresh) and sends it again', async () => {
    seedMerchantA();
    const fetchMock = vi.fn(async () => reply());
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<LayoutContext>{null}</LayoutContext>);
    first.unmount();

    render(<LayoutContext>{null}</LayoutContext>);
    const request = customFetch({ baseUrl: '' });
    await request('/posts');

    const headers = await headersOf(fetchMock);
    expect(headers.auth).toBe('jwt-a');
    expect(headers.showorg).toBe('org-a');
    expect(headers.impersonate).toBe('imp-person-a');
  });

  it('starts a new/duplicated tab from its own sessionStorage, never localStorage', async () => {
    // a duplicated tab inherits the source tab's sessionStorage and nothing
    // else; the app must not migrate or re-hydrate the session elsewhere
    seedMerchantA();
    const fetchMock = vi.fn(async () => reply());
    vi.stubGlobal('fetch', fetchMock);
    render(<LayoutContext>{null}</LayoutContext>);

    await customFetch({ baseUrl: '' })('/posts');

    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).not.toContain('auth=');
    expect(await headersOf(fetchMock)).toEqual({
      showorg: 'org-a',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      auth: 'jwt-a',
      impersonate: 'imp-person-a',
    });
  });

  it('a tab with no session sends no identity headers', async () => {
    const fetchMock = vi.fn(async () => reply());
    vi.stubGlobal('fetch', fetchMock);
    render(<LayoutContext>{null}</LayoutContext>);

    await customFetch({ baseUrl: '' })('/user/self');

    const headers = await headersOf(fetchMock);
    expect(headers.auth).toBeUndefined();
    expect(headers.showorg).toBeUndefined();
    expect(headers.impersonate).toBeUndefined();
  });
});
