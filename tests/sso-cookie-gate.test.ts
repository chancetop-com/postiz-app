import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@gitroom/frontend/proxy';

/**
 * Ticket 04: an iframe landing on SSO must not be bounced by a cookie gate.
 *
 * The proxy in front of every non-API page must pass the SSO handoff, the SSO
 * page and the ordinary login pages straight through without an `auth` cookie.
 * A redirect here would break the parent app's iframe before the exchange runs.
 */

process.env.FRONTEND_URL = 'http://localhost:4200';

const visit = (path: string, cookies: Record<string, string> = {}) => {
  const request = new NextRequest(new URL(path, 'http://localhost:4200'));
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return proxy(request);
};

afterEach(() => vi.unstubAllEnvs());

describe('login callback routing without auth cookies', () => {
  it.each([
    ['/integrations/social/youtube', true, false, 'GOOGLE'],
    ['/settings', false, false, 'GITHUB'],
    ['/settings', true, true, 'GENERIC'],
    ['/settings', false, true, 'GITHUB'],
    ['/settings', true, false, 'GITHUB'],
  ])(
    'routes %s login callbacks to the session-aware exchange',
    async (path, general, generic, provider) => {
      vi.stubEnv('IS_GENERAL', general ? 'true' : '');
      vi.stubEnv('POSTIZ_GENERIC_OAUTH', generic ? 'true' : '');
      const response = await visit(
        `${path}?state=login-nonce&code=provider-code`
      );
      const redirect = new URL(response.headers.get('location')!);
      expect(redirect.pathname).toBe('/auth');
      expect(redirect.searchParams.get('provider')).toBe(provider);
      expect(redirect.searchParams.get('code')).toBe('provider-code');
      expect(redirect.searchParams.get('state')).toBe('login-nonce');
    }
  );

  it('leaves social channel binding callbacks on their own route', async () => {
    const response = await visit(
      '/integrations/social/youtube?state=channel-nonce&code=code'
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('routes provider denial to the login error UI', async () => {
    const response = await visit(
      '/integrations/social/youtube?state=login-nonce&error=access_denied'
    );
    const redirect = new URL(response.headers.get('location')!);
    expect(redirect.pathname).toBe('/auth');
    expect(redirect.searchParams.get('error')).toBe('access_denied');
  });
});

describe('page proxy without an auth cookie', () => {
  it.each([
    '/sso?auth_code=abc',
    '/auth/sso?token=abc',
    '/auth/login',
    '/auth/register',
    '/auth/activate',
    '/analytics',
  ])('passes %s through instead of redirecting to login', async (path) => {
    const response = await visit(path);

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('passes the SSO page through even when only unrelated cookies exist', async () => {
    const response = await visit('/sso', { lang: 'en', mode: 'light' });

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('keeps the dedicated logout route redirecting', async () => {
    const response = await visit('/auth/logout', { auth: 'jwt-stale' });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get('location')).toContain('/auth/login');
  });
});
