import { afterEach, describe, expect, it, vi } from 'vitest';
import { SsoService } from '@gitroom/backend/services/auth/sso.service';

const sso = new SsoService();

const stubFetch = (impl: (url: string, init: RequestInit) => unknown) => {
  const spy = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SSO_SERVER_URL;
});

describe('SsoService.verifyToken', () => {
  it('posts the auth_code to the full configured endpoint', async () => {
    process.env.SSO_SERVER_URL = 'https://sso.example.invalid/exchange/auth-code';
    const fetchSpy = stubFetch(() => ({
      ok: true,
      json: async () => ({ merchant_id: 'm-1', merchant_name: 'Acme' }),
    }));

    const result = await sso.verifyToken('code-123');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://sso.example.invalid/exchange/auth-code');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ auth_code: 'code-123' });
    expect(result).toEqual({ merchantId: 'm-1', merchantName: 'Acme' });
  });

  it('does not append a path to the configured endpoint', async () => {
    process.env.SSO_SERVER_URL = 'https://sso.example.invalid/only/this';
    const fetchSpy = stubFetch(() => ({
      ok: true,
      json: async () => ({ merchant_id: 'm-1', merchant_name: 'Acme' }),
    }));

    await sso.verifyToken('code');

    expect(fetchSpy.mock.calls[0][0]).toBe('https://sso.example.invalid/only/this');
  });

  it('fails when SSO_SERVER_URL is not configured', async () => {
    await expect(sso.verifyToken('code')).rejects.toThrow(/SSO_SERVER_URL/);
  });

  it('fails when the exchange is rejected', async () => {
    process.env.SSO_SERVER_URL = 'https://sso.example.invalid/exchange';
    stubFetch(() => ({ ok: false, status: 401, json: async () => ({}) }));

    await expect(sso.verifyToken('expired')).rejects.toThrow(/Invalid or expired/);
  });

  it('fails when the reply is missing merchant fields', async () => {
    process.env.SSO_SERVER_URL = 'https://sso.example.invalid/exchange';
    stubFetch(() => ({ ok: true, json: async () => ({ merchant_id: 'm-1' }) }));

    await expect(sso.verifyToken('code')).rejects.toThrow(/incomplete/);
  });
});
