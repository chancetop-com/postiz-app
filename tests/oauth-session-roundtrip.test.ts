import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';

process.env.JWT_SECRET = 'synthetic-oauth-session-test-secret';
const storage = new Map<string, string>();
const requests: { url: string; headers: Headers }[] = [];
const getToken = vi.fn(async () => 'provider-token');

beforeEach(() => {
  storage.clear();
  requests.length = 0;
  getToken.mockClear();
  vi.stubGlobal('window', {
    location: { href: 'https://postiz.example/auth' },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const service = new AuthService(
    {
      getUserByProvider: async () => ({ id: 'user-1', activated: true }),
    } as never,
    {} as never,
    {} as never,
    {
      getProvider: () => ({
        generateLink: ({ state }: { state: string }) =>
          `https://provider.example/authorize?state=${state}`,
        getToken,
        getUser: async () => ({ id: 'provider-user' }),
      }),
    } as never,
    {} as never
  );
  const controller = new AuthController(service, {} as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const headers = new Headers(init.headers);
      requests.push({ url, headers });
      const provider = path.split('/')[3];
      const responseHeaders = new Headers();
      let body: unknown;
      const response = {
        header: (key: string, value: string) => {
          responseHeaders.set(key, value);
          return response;
        },
        cookie: () => {
          throw new Error('No cookies should be issued');
        },
        status: () => response,
        json: (value: unknown) => {
          body = value;
          return response;
        },
      };
      if (path.endsWith('/exists')) {
        try {
          const input = JSON.parse(init.body as string);
          await controller.oauthExists(
            {
              headers: Object.fromEntries(headers),
              get: (name: string) => headers.get(name),
              get cookies() {
                throw new Error('No cookies should be read');
              },
            } as never,
            input.code,
            undefined,
            input.state,
            provider,
            response as never
          );
        } catch (error) {
          return new Response(
            JSON.stringify({ message: (error as Error).message }),
            { status: 400 }
          );
        }
        return new Response(JSON.stringify(body), { headers: responseHeaders });
      }
      const link = await controller.oauthLink(provider, {}, response as never);
      return new Response(link, { headers: responseHeaders });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());
const client = customFetch({ baseUrl: 'https://api.postiz.example' });
const start = async () => {
  const response = await client('/auth/oauth/GITHUB');
  return new URL(await response.text()).searchParams.get('state');
};
const complete = (state: string | null) =>
  client('/auth/oauth/GITHUB/exists', {
    method: 'POST',
    body: JSON.stringify({ code: 'provider-code', state }),
  });

describe('cookie-free OAuth browser and API round trip', () => {
  it('stores the server proof in the tab, returns it as a header and consumes it after login', async () => {
    const state = await start();
    const proof = storage.get('oauth_state:GITHUB');
    expect(proof).toBeTruthy();
    expect(state).toMatch(/^login-/);
    expect(state).not.toContain(proof);

    const response = await complete(state);
    expect(response.ok).toBe(true);
    expect(response.headers.get('auth')).toBeTruthy();
    expect(requests[1].headers.get('oauth-state-token')).toBe(proof);
    expect(storage.has('oauth_state:GITHUB')).toBe(false);
    expect(getToken).toHaveBeenCalledTimes(1);

    expect((await complete(state)).status).toBe(400);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback copied into another tab without the initiating proof', async () => {
    const state = await start();
    storage.clear();
    expect((await complete(state)).status).toBe(400);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('rejects a mismatched callback state without exchanging its code', async () => {
    await start();
    expect((await complete('login-wrong-state')).status).toBe(400);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('does not attach the login proof to other API requests', async () => {
    await start();
    await client('/auth/oauth/GOOGLE');
    expect(requests[1].headers.get('oauth-state-token')).toBeNull();
    expect(storage.has('oauth_state:GITHUB')).toBe(true);
    expect(storage.has('oauth_state:GOOGLE')).toBe(true);
  });
});
