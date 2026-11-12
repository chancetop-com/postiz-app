// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import OAuthAuthorizePage from '@gitroom/frontend/app/(app)/oauth/authorize/page';

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      'client_id=client-1&response_type=code&state=client-state'
    ),
}));
vi.mock('next/headers', () => ({
  cookies: () => {
    throw new Error('Session pages must not read auth cookies');
  },
}));
vi.mock('@gitroom/frontend/components/new-layout/logo', () => ({
  Logo: () => null,
}));
vi.mock('@gitroom/frontend/components/oauth/self.hosted.component', () => ({
  OAuthSelfHosted: () => <div>Self-hosted connection</div>,
}));

beforeEach(() => {
  window.sessionStorage.clear();
  document.cookie = 'auth=;max-age=0;path=/';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OAuth consent with tab-scoped authentication', () => {
  it.each(['Authorize', 'Deny'])(
    'allows %s with sessionStorage and no auth cookie',
    async (button) => {
      window.sessionStorage.setItem('auth', 'session-jwt');
      window.sessionStorage.setItem('showorg', 'merchant-org');
      window.sessionStorage.setItem('impersonate', 'admin-target');
      const fetchMock = vi.fn(
        async (_url, options: RequestInit) =>
          new Response(
            JSON.stringify(
              options.method === 'POST' ? {} : { app: { name: 'Test client' } }
            )
          )
      );
      vi.stubGlobal('fetch', fetchMock);

      render(<OAuthAuthorizePage />);
      fireEvent.click(await screen.findByRole('button', { name: button }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const [, options] = fetchMock.mock.calls[1];
      expect(options.headers).toEqual(
        expect.objectContaining({
          auth: 'session-jwt',
          showorg: 'merchant-org',
          impersonate: 'admin-target',
        })
      );
      expect(JSON.parse(options.body as string).action).toBe(
        button === 'Authorize' ? 'approve' : 'deny'
      );
      expect(
        screen.queryByRole('button', { name: 'Sign in to Postiz' })
      ).toBeNull();
    }
  );

  it('offers sign-in and self-hosted access without a tab session, even with a stale auth cookie', async () => {
    document.cookie = 'auth=legacy-jwt;path=/';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app: { name: 'Test client' },
              selfHosted: true,
            })
          )
      )
    );
    render(<OAuthAuthorizePage />);
    expect(
      await screen.findByRole('button', { name: 'Sign in to Postiz' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use self-hosted' }));
    expect(screen.getByText('Self-hosted connection')).toBeTruthy();
  });
});
