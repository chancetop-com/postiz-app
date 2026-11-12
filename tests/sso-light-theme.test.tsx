// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * The SSO entry keeps the light layout and forces the light cookie on success
 * (ticket 06 / spec "默认 light、SSO 浅色布局及成功后写 light cookie").
 * `document.cookie` is the observable contract the main layout's ModeComponent
 * reads, so the assertion is on the cookie and the redirect, not on source text.
 */

const replace = vi.fn();
const push = vi.fn();
const fetchMock = vi.fn();
let search = 'auth_code=abc';
let isGeneral = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/sso',
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isGeneral }),
}));

import SsoLoginPage from '@gitroom/frontend/app/(app)/sso/page';

const clearCookies = () => {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name) {
      document.cookie = `${name}=;path=/;max-age=0`;
    }
  }
};

beforeEach(() => {
  clearCookies();
  replace.mockReset();
  push.mockReset();
  fetchMock.mockReset();
  search = 'auth_code=abc';
  isGeneral = false;
  delete process.env.NEXT_PUBLIC_SSO_PARENT_ORIGINS;
});

afterEach(() => {
  cleanup();
});

describe('SSO login page theme', () => {
  it('exchanges the URL auth_code and writes the light cookie on success', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    render(<SsoLoginPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/sso',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ auth_code: 'abc' })
    );
    expect(document.cookie).toContain('mode=light');
  });

  it('sends general deployments to launches', async () => {
    isGeneral = true;
    fetchMock.mockResolvedValue({ ok: true });

    render(<SsoLoginPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/launches'));
    expect(document.cookie).toContain('mode=light');
  });

  it('does not touch the theme when the exchange fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => 'invalid code',
    });

    render(<SsoLoginPage />);

    expect(await screen.findByText('invalid code')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('mode=light');
  });

  it('accepts a parent message from an allowed origin only', async () => {
    search = '';
    process.env.NEXT_PUBLIC_SSO_PARENT_ORIGINS = 'https://parent.example';
    fetchMock.mockResolvedValue({ ok: true });

    render(<SsoLoginPage />);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'SSO_TOKEN', auth_code: 'from-evil' },
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://parent.example',
        data: { type: 'SSO_TOKEN', auth_code: 'from-parent' },
      })
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ auth_code: 'from-parent' })
    );
  });
});
