import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

/**
 * Ticket 05: standard OAuth login keeps its state round trip and its failure
 * check without depending on third-party cookies. The signed proof is kept in
 * sessionStorage separately from the state exposed in the callback URL.
 */

process.env.JWT_SECRET = 'ticket-05-oauth-secret';

const build = () => {
  const getToken = vi.fn().mockResolvedValue('provider-token');
  const getUser = vi.fn().mockResolvedValue({ id: 'provider-user' });
  const service = new AuthService(
    {
      getUserByProvider: vi.fn().mockResolvedValue({ id: 'user-1' }),
    } as never,
    {} as never,
    {} as never,
    {
      getProvider: () => ({ getToken, getUser }),
    } as never,
    {} as never
  );
  return { service, getToken };
};

afterEach(() => {
  delete process.env.NOT_SECURED;
  vi.useRealTimers();
});

describe('standard OAuth state validation', () => {
  it('rejects a callback whose state does not match the stored proof', async () => {
    delete process.env.NOT_SECURED;
    const { service, getToken } = build();

    await expect(
      service.checkExists(
        'github',
        'code',
        undefined,
        'state-a',
        service.createOAuthStateToken('github', 'state-b')
      )
    ).rejects.toThrow('Invalid state');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('rejects a callback with no session proof', async () => {
    delete process.env.NOT_SECURED;
    const { service, getToken } = build();

    await expect(
      service.checkExists('github', 'code', undefined, 'state-a', undefined)
    ).rejects.toThrow('Invalid state');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('exchanges the code when the state matches', async () => {
    delete process.env.NOT_SECURED;
    const { service, getToken } = build();

    await expect(
      service.checkExists(
        'github',
        'code',
        undefined,
        'state-a',
        service.createOAuthStateToken('github', 'state-a')
      )
    ).resolves.toEqual({ jwt: expect.any(String) });
    expect(getToken).toHaveBeenCalledWith('code', undefined);
  });

  it('rejects a proof issued for another provider', async () => {
    const { service, getToken } = build();
    await expect(
      service.checkExists(
        'github',
        'code',
        undefined,
        'state-a',
        service.createOAuthStateToken('google', 'state-a')
      )
    ).rejects.toThrow('Invalid state');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('rejects expired proofs before contacting the provider', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { service, getToken } = build();
    const proof = service.createOAuthStateToken('github', 'state-a');
    vi.setSystemTime(new Date('2026-01-01T00:10:01Z'));
    await expect(
      service.checkExists('github', 'code', undefined, 'state-a', proof)
    ).rejects.toThrow('Invalid state');
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each([
    ['an unsigned echo of the URL state', () => 'state-a'],
    [
      'a signed token for another purpose',
      () =>
        AuthChecker.signJWT({
          purpose: 'reset',
          state: 'state-a',
          provider: 'GITHUB',
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
    ],
    [
      'a proof without an expiry',
      () =>
        AuthChecker.signJWT({
          purpose: 'oauth-state',
          state: 'state-a',
          provider: 'GITHUB',
        }),
    ],
  ])('rejects %s', async (_label, token) => {
    const { service, getToken } = build();
    await expect(
      service.checkExists('github', 'code', undefined, 'state-a', token())
    ).rejects.toThrow('Invalid state');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('keeps state validation enabled on HTTP development deployments', async () => {
    process.env.NOT_SECURED = 'true';
    const { service, getToken } = build();
    await expect(
      service.checkExists('github', 'code', undefined, 'state-a')
    ).rejects.toThrow('Invalid state');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('keeps the mobile/redirect_uri path exempt as before', async () => {
    delete process.env.NOT_SECURED;
    const { service, getToken } = build();

    await service.checkExists(
      'github',
      'code',
      'postiz://callback',
      undefined,
      undefined
    );

    expect(getToken).toHaveBeenCalledWith('code', 'postiz://callback');
  });
});
