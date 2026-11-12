import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, sign } from 'jsonwebtoken';
import crypto from 'crypto';
import dayjs from 'dayjs';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { Provider } from '@prisma/client';

const user = {
  id: 'user-reset',
  email: 'reset@example.test',
  providerName: Provider.LOCAL,
  activated: true,
  isSuperAdmin: false,
};
const now = new Date('2026-11-13T04:00:00Z');

const build = () => {
  const users = {
    getUserByEmail: vi.fn(async () => ({ ...user })),
    getUserById: vi.fn(async () => ({ ...user })),
    updatePassword: vi.fn().mockResolvedValue({ id: user.id }),
  };
  const organizations = {
    getOrgsByUserId: vi.fn().mockResolvedValue([
      { id: 'org-first', apiKey: 'key-first', users: [{ disabled: false }] },
      { id: 'org-chosen', apiKey: 'key-chosen', users: [{ disabled: false }] },
    ]),
    getUserOrg: vi.fn(),
  };
  const email = { sendEmailSync: vi.fn() };
  const service = new AuthService(
    users as never,
    organizations as never,
    email as never,
    {} as never,
    {} as never
  );
  const middleware = new AuthMiddleware(organizations as never, users as never);
  const controller = new AuthController(service, email as never);
  const issueReset = async () => {
    await service.forgot(user.email);
    const message = email.sendEmailSync.mock.calls.at(-1)![2] as string;
    return message.match(/\/auth\/forgot\/([^\"]+)/)![1];
  };
  const request = (auth: string, cookies = false, extraHeaders = {}) => {
    const req: any = {
      headers: { ...(cookies ? {} : { auth }), ...extraHeaders },
      cookies: cookies ? { auth } : {},
    };
    const next = vi.fn();
    const response = { header: vi.fn(), cookie: vi.fn() };
    return {
      req,
      next,
      response,
      run: () => middleware.use(req, response as never, next),
    };
  };
  return { users, organizations, service, controller, issueReset, request };
};

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', 'password-reset-regression-secret');
  vi.stubEnv('FRONTEND_URL', 'https://postiz.example.test');
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('password reset tokens cannot become login sessions', () => {
  it.each([false, true])(
    'rejects a newly issued reset token (cookie=%s)',
    async (cookie) => {
      const { issueReset, request, users } = build();
      const call = request(await issueReset(), cookie);
      await expect(call.run()).rejects.toMatchObject({ status: 403 });
      expect(call.next).not.toHaveBeenCalled();
      expect(users.getUserById).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'rejects a new expired reset token (cookie=%s)',
    async (cookie) => {
      const { issueReset, request } = build();
      const token = await issueReset();
      vi.setSystemTime(new Date(now.getTime() + 20 * 60 * 1000));
      await expect(request(token, cookie).run()).rejects.toMatchObject({
        status: 403,
      });
    }
  );

  it.each([-60, 0, 20])(
    'rejects legacy reset tokens with expiry offset %s minutes',
    async (minutes) => {
      const { request, users } = build();
      const token = AuthChecker.signJWT({
        id: user.id,
        expires: dayjs().add(minutes, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
      });
      for (const cookie of [false, true]) {
        await expect(request(token, cookie).run()).rejects.toMatchObject({
          status: 403,
        });
      }
      expect(users.getUserById).not.toHaveBeenCalled();
    }
  );

  it('rejects a reset token even if it includes user-shaped claims', async () => {
    const { request } = build();
    const token = AuthChecker.signJWT({
      ...user,
      expires: '2099-01-01 00:00:00',
    });
    await expect(request(token).run()).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    {
      id: user.id,
      email: user.email,
      orgId: 'org-first',
      role: 'ADMIN',
      timeLimit: '2099-01-01',
    },
    { id: user.id, apiKey: 'provisioning-key', provider: 'GENERIC' },
    { ...user, purpose: 'oauth-state' },
  ])('rejects a signed token for a different purpose: %j', async (claims) => {
    const { request } = build();
    await expect(
      request(AuthChecker.signJWT(claims)).run()
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('reset endpoint validates purpose and expiry', () => {
  it('issues a separate password-reset token with a twenty-minute standard expiry', async () => {
    const { issueReset } = build();
    const token = await issueReset();
    expect(decode(token)).toMatchObject({
      sub: user.id,
      purpose: 'password-reset',
      iss: 'postiz',
      aud: 'password-reset',
      exp: now.getTime() / 1000 + 20 * 60,
    });
    expect(() => AuthChecker.verifyJWT(token)).toThrow();
  });

  it('resets a password using the newly issued link until its expiry', async () => {
    const { issueReset, controller, users } = build();
    const token = await issueReset();
    vi.setSystemTime(new Date(now.getTime() + 20 * 60 * 1000 - 1));
    await expect(
      controller.forgotReturn({ token, password: 'new-password' })
    ).resolves.toEqual({ reset: true });
    expect(users.updatePassword).toHaveBeenCalledWith(user.id, 'new-password');
  });

  it('rejects a new reset token exactly at expiry without changing the password', async () => {
    const { issueReset, controller, users } = build();
    const token = await issueReset();
    vi.setSystemTime(new Date(now.getTime() + 20 * 60 * 1000));
    await expect(
      controller.forgotReturn({ token, password: 'new-password' })
    ).resolves.toEqual({ reset: false });
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it('preserves an unexpired reset link sent before the upgrade', async () => {
    const { controller, users } = build();
    const token = AuthChecker.signJWT({
      id: user.id,
      expires: dayjs().add(20, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    });
    await expect(
      controller.forgotReturn({ token, password: 'new-password' })
    ).resolves.toEqual({ reset: true });
    expect(users.updatePassword).toHaveBeenCalledWith(user.id, 'new-password');
  });

  it.each([
    { id: user.id, expires: '2020-01-01 00:00:00' },
    { id: user.id, expires: dayjs(now).format('YYYY-MM-DD HH:mm:ss') },
    { id: user.id, expires: 'invalid' },
    { id: user.id, expires: '2099-02-31 00:00:00' },
    { id: user.id },
    { ...user },
    { id: user.id, expires: '2099-01-01 00:00:00', purpose: 'session' },
  ])('rejects a non-reset or invalid legacy token: %j', async (claims) => {
    const { controller, users } = build();
    await expect(
      controller.forgotReturn({
        token: AuthChecker.signJWT(claims),
        password: 'new-password',
      })
    ).resolves.toEqual({ reset: false });
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures without changing the password', async () => {
    const { controller, users } = build();
    const token = sign(
      { id: user.id, expires: '2099-01-01 00:00:00' },
      'wrong-secret'
    );
    await expect(
      controller.forgotReturn({ token, password: 'new-password' })
    ).resolves.toEqual({ reset: false });
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it.each(['purpose', 'issuer', 'audience', 'expiry', 'subject', 'algorithm'])(
    'rejects a new token with invalid %s',
    async (invalid) => {
      const { controller, users } = build();
      const key = crypto
        .createHmac('sha256', process.env.JWT_SECRET!)
        .update('postiz:user-auth:v1:password-reset')
        .digest();
      const token = sign(
        {
          purpose: invalid === 'purpose' ? 'session' : 'password-reset',
          ...(invalid === 'expiry' ? {} : { exp: now.getTime() / 1000 + 1200 }),
        },
        key,
        {
          algorithm: invalid === 'algorithm' ? 'HS384' : 'HS256',
          issuer: invalid === 'issuer' ? 'other' : 'postiz',
          audience: invalid === 'audience' ? 'session' : 'password-reset',
          subject: invalid === 'subject' ? '' : user.id,
        }
      );
      await expect(
        controller.forgotReturn({ token, password: 'new-password' })
      ).resolves.toEqual({ reset: false });
      expect(users.updatePassword).not.toHaveBeenCalled();
    }
  );
});

describe('existing session compatibility', () => {
  it.each(Object.values(Provider))(
    'preserves the full-User session format used by the old commits for %s',
    async (providerName) => {
      const { request } = build();
      // Both f042c177 and 6fdf7cb5 sign the User object, minus its password.
      const token = AuthChecker.signJWT({ ...user, providerName });
      const call = request(token, false, { showorg: 'org-chosen' });
      await call.run();
      expect(call.req.org.id).toBe('org-chosen');
      expect(call.next).toHaveBeenCalledOnce();
      expect(call.response.cookie).not.toHaveBeenCalled();
    }
  );

  it('accepts a current session from the same signJwt path used by SSO and OAuth', async () => {
    const { service, request } = build();
    const token = await service.signJwt({ ...user, password: 'hash' } as never);
    const call = request(token);
    await call.run();
    expect(call.req.user.id).toBe(user.id);
    expect(decode(token)).not.toHaveProperty('password');
  });

  it('exchanges merchant SSO into response headers that authenticate the next request', async () => {
    const { users, organizations, request } = build();
    const merchant = { ...user, providerName: Provider.GENERIC };
    const service = new AuthService(
      {
        ...users,
        getUserByProvider: vi.fn().mockResolvedValue(merchant),
      } as never,
      organizations as never,
      {} as never,
      {} as never,
      {
        verifyToken: vi
          .fn()
          .mockResolvedValue({
            merchantId: 'merchant',
            merchantName: 'Merchant',
          }),
      } as never
    );
    const headers: Record<string, string> = {};
    const response = {
      header: vi.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      send: vi.fn(),
    };
    await new AuthController(service, {} as never).ssoLogin(
      { auth_code: 'one-use-code' },
      response as never
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.cookie).not.toHaveBeenCalled();
    const call = request(headers.auth, false, { showorg: headers.showorg });
    await call.run();
    expect(call.req.org.id).toBe('org-first');
    expect(call.next).toHaveBeenCalledOnce();
  });

  it('exchanges standard OAuth with sessionStorage proof into a usable session', async () => {
    const { users, organizations, request } = build();
    const service = new AuthService(
      {
        ...users,
        getUserByProvider: vi
          .fn()
          .mockResolvedValue({ ...user, providerName: Provider.GOOGLE }),
      } as never,
      organizations as never,
      {} as never,
      {
        getProvider: () => ({
          getToken: vi.fn().mockResolvedValue('provider-access'),
          getUser: vi.fn().mockResolvedValue({ id: 'provider-user' }),
        }),
      } as never,
      {} as never
    );
    const proof = service.createOAuthStateToken('GOOGLE', 'login-state');
    const { jwt } = await service.checkExists(
      'GOOGLE',
      'code',
      undefined,
      'login-state',
      proof
    );
    const call = request(jwt!);
    await call.run();
    expect(call.next).toHaveBeenCalledOnce();
  });

  it('keeps legacy cookie transport working while preferring the sessionStorage auth header', async () => {
    const { request } = build();
    const token = AuthChecker.signJWT(user);
    await request(token, true).run();
    const call = request(token);
    call.req.cookies.auth = AuthChecker.signJWT({
      id: user.id,
      expires: '2020-01-01 00:00:00',
    });
    await call.run();
    expect(call.next).toHaveBeenCalledOnce();
  });

  it('uses current database activation and privileges rather than old JWT claims', async () => {
    const { request, users, organizations } = build();
    const call = request(
      AuthChecker.signJWT({ ...user, isSuperAdmin: true }),
      false,
      { impersonate: 'target' }
    );
    await call.run();
    expect(organizations.getUserOrg).not.toHaveBeenCalled();
    users.getUserById.mockResolvedValueOnce({ ...user, activated: false });
    await expect(
      request(AuthChecker.signJWT(user)).run()
    ).rejects.toMatchObject({ status: 403 });
  });

  it('preserves administrator impersonation after checking the session token', async () => {
    const { request, users, organizations } = build();
    users.getUserById.mockResolvedValueOnce({ ...user, isSuperAdmin: true });
    organizations.getUserOrg.mockResolvedValueOnce({
      user: { ...user, id: 'target-user' },
      organization: { id: 'target-org', users: [{ userId: 'target-user' }] },
    });
    const call = request(AuthChecker.signJWT(user), false, {
      impersonate: 'target-org',
    });
    await call.run();
    expect(call.req.user.id).toBe('target-user');
    expect(call.req.org.id).toBe('target-org');
    expect(call.next).toHaveBeenCalledOnce();
  });
});
