// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Register } from '@gitroom/frontend/components/auth/register';

const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query.value),
  useRouter: () => ({ push: vi.fn() }),
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
vi.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div>Loading</div>,
}));

beforeEach(() => {
  window.sessionStorage.clear();
  query.value = 'provider=GITHUB&code=provider-code&state=login-nonce';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the OAuth login callback UI', () => {
  it('exchanges once in StrictMode with the proof from this tab', async () => {
    window.sessionStorage.setItem('oauth_state:GITHUB', 'signed-proof');
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ login: true }))
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StrictMode>
        <Register />
      </StrictMode>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe('/auth/oauth/GITHUB/exists');
    expect(init.headers).toEqual(
      expect.objectContaining({ 'oauth-state-token': 'signed-proof' })
    );
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'provider-code',
      state: 'login-nonce',
    });
    await waitFor(() =>
      expect(window.sessionStorage.getItem('oauth_state:GITHUB')).toBeNull()
    );
  });

  it('offers sign-in again when the state exchange is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Invalid state' }), {
            status: 400,
          })
      )
    );
    render(<Register />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')
    ).toBe('/auth/login');
  });

  it('shows provider denial without attempting a code exchange', async () => {
    query.value = 'provider=GITHUB&state=login-nonce&error=access_denied';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Register />);
    expect(screen.getByRole('alert').textContent).toContain(
      'cancelled or denied'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
