// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Ticket 04: the three entry points a parent app may use.
 *
 * - `/auth/sso?token=...` is the legacy handoff. It must forward the token to
 *   the new page as `auth_code`, encoded.
 * - `/sso?auth_code=...` exchanges on mount.
 * - `/sso` also accepts an `SSO_TOKEN` message from a configured parent origin.
 *
 * The URL code is authoritative: a message arriving on the same page load must
 * not start a second exchange. The parent app is external and unchanged, so
 * these are the only shapes we accept.
 */

const replace = vi.fn();
const push = vi.fn();
const redirect = vi.fn();
const fetchMock = vi.fn();
let search = '';
let isGeneral = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
  redirect: (url: string) => {
    redirect(url);
  },
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isGeneral }),
}));

import SsoRedirectPage from '@gitroom/frontend/app/(app)/auth/sso/page';
import SsoLoginPage from '@gitroom/frontend/app/(app)/sso/page';

const exchangeBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/auth/sso')
    .map(([, init]) => JSON.parse(init.body).auth_code);

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  redirect.mockReset();
  fetchMock.mockReset();
  search = '';
  isGeneral = false;
  delete process.env.NEXT_PUBLIC_SSO_PARENT_ORIGINS;
});

afterEach(() => {
  cleanup();
});

describe('/auth/sso legacy handoff', () => {
  // Next 16 hands page components a Promise for searchParams.
  it('forwards the token as an encoded auth_code', async () => {
    await SsoRedirectPage({
      searchParams: Promise.resolve({ token: 'code with/slash+plus' }),
    });

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect.mock.calls[0][0]).toBe(
      `/sso?auth_code=${encodeURIComponent('code with/slash+plus')}`
    );
  });

  it('opens the SSO page without a code when the token is absent', async () => {
    await SsoRedirectPage({ searchParams: Promise.resolve({}) });

    expect(redirect).toHaveBeenCalledWith('/sso');
  });

  it('ignores a repeated token parameter instead of guessing', async () => {
    await SsoRedirectPage({
      searchParams: Promise.resolve({ token: ['first', 'second'] }),
    });

    expect(redirect).toHaveBeenCalledWith('/sso');
  });
});

describe('/sso URL code precedence', () => {
  it('exchanges the URL code once and ignores parent messages', async () => {
    search = 'auth_code=url-code';
    process.env.NEXT_PUBLIC_SSO_PARENT_ORIGINS = 'https://parent.example';
    fetchMock.mockResolvedValue({ ok: true });

    render(<SsoLoginPage />);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://parent.example',
        data: { type: 'SSO_TOKEN', auth_code: 'message-code' },
      })
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(exchangeBodies()).toEqual(['url-code']);
  });

  it('falls back to a parent message when the URL code is blank', async () => {
    search = 'auth_code=';
    process.env.NEXT_PUBLIC_SSO_PARENT_ORIGINS = 'https://parent.example';
    fetchMock.mockResolvedValue({ ok: true });

    render(<SsoLoginPage />);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://parent.example',
        data: { type: 'SSO_TOKEN', auth_code: 'message-code' },
      })
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(exchangeBodies()).toEqual(['message-code']);
  });

  it.each([
    ['another message type', { type: 'OTHER', auth_code: 'nope' }],
    ['a missing code', { type: 'SSO_TOKEN' }],
    ['a blank code', { type: 'SSO_TOKEN', auth_code: '' }],
    ['a bare string payload', 'SSO_TOKEN'],
  ])('ignores %s', async (_label, data) => {
    process.env.NEXT_PUBLIC_SSO_PARENT_ORIGINS = 'https://parent.example';
    fetchMock.mockResolvedValue({ ok: true });

    render(<SsoLoginPage />);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://parent.example',
        data,
      })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
