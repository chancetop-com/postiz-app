import { describe, expect, it, vi } from 'vitest';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

/**
 * Administrator impersonation is tab-scoped like auth/showorg.
 *
 * The selected target lives in this tab's sessionStorage and travels as the
 * `impersonate` header. A legacy shared cookie is only a fallback: two tabs
 * with the same cookie must still be able to hold different impersonation
 * states, so the header wins whenever it is present.
 */

process.env.JWT_SECRET = 'impersonation-precedence-secret';

const admin = {
  id: 'admin-1',
  email: 'admin@example.test',
  activated: true,
  isSuperAdmin: true,
};

const auth = () =>
  AuthChecker.signJWT({
    id: admin.id,
    email: admin.email,
    providerName: 'GENERIC',
    activated: true,
  });

const build = () => {
  const getUserOrg = vi.fn(async (id: string) => ({
    user: {
      id,
      email: `${id}@example.test`,
      activated: true,
      isSuperAdmin: false,
    },
    organization: {
      id: `org-${id}`,
      apiKey: `key-${id}`,
      paymentId: null,
      users: [{ userId: id, disabled: false }],
    },
  }));
  const organizations = {
    getOrgsByUserId: vi.fn().mockResolvedValue([
      {
        id: 'org-admin',
        apiKey: 'key-admin',
        users: [{ disabled: false, role: 'SUPERADMIN' }],
      },
    ]),
    updateApiKey: vi.fn(),
    getUserOrg,
  };
  const users = {
    getUserById: vi.fn().mockResolvedValue({ ...admin }),
  };
  const middleware = new AuthMiddleware(
    organizations as never,
    users as never
  );
  return { middleware, organizations, users, getUserOrg };
};

const run = async (
  middleware: AuthMiddleware,
  { header, cookie }: { header?: string; cookie?: string } = {}
) => {
  const req: any = {
    headers: {
      auth: auth(),
      ...(header === undefined ? {} : { impersonate: header }),
    },
    cookies: cookie === undefined ? {} : { impersonate: cookie },
  };
  const next = vi.fn();

  await middleware.use(req, { header: vi.fn(), cookie: vi.fn() } as never, next);

  return { req, next };
};

describe('the tab header wins over the legacy cookie', () => {
  it('impersonates the tab target, not the cookie target', async () => {
    const { middleware, getUserOrg } = build();

    const { req } = await run(middleware, {
      header: 'header-user',
      cookie: 'cookie-user',
    });

    expect(getUserOrg).toHaveBeenCalledWith('header-user');
    expect(req.user.id).toBe('header-user');
    expect(req.org.id).toBe('org-header-user');
  });

  it('keeps two tabs on two targets despite one shared cookie', async () => {
    const { middleware } = build();

    const tabOne = await run(middleware, {
      header: 'user-one',
      cookie: 'user-one',
    });
    const tabTwo = await run(middleware, {
      header: 'user-two',
      cookie: 'user-one',
    });

    expect(tabOne.req.user.id).toBe('user-one');
    expect(tabTwo.req.user.id).toBe('user-two');
  });

  it('falls back to the legacy cookie when the tab sends no header', async () => {
    const { middleware, getUserOrg } = build();

    const { req } = await run(middleware, { cookie: 'legacy-target' });

    expect(getUserOrg).toHaveBeenCalledWith('legacy-target');
    expect(req.user.id).toBe('legacy-target');
  });
});

describe('other impersonation readers', () => {
  const controller = () =>
    new UsersController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

  it('expires the legacy domain cookie when the administrator stops impersonating', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://dashboard.example.com');
    vi.stubEnv('NOT_SECURED', '');
    const response = { clearCookie: vi.fn(), header: vi.fn() };
    try {
      await controller().setImpersonate(
        { ...admin } as never,
        '',
        response as never
      );
      expect(response.clearCookie).toHaveBeenCalledWith('impersonate', {
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'none',
      });
      expect(response.header).toHaveBeenCalledWith('impersonate', '');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('/user/self reads the tab header first', async () => {
    const self = await controller().getSelf(
      { ...admin } as never,
      {
        id: 'org-admin',
        apiKey: 'key-admin',
        subscription: null,
        users: [{ role: 'SUPERADMIN' }],
      } as never,
      {
        headers: { impersonate: 'header-user' },
        cookies: { impersonate: 'cookie-user' },
      } as never
    );

    expect(self.impersonate).toBe(true);
  });

  it('delete-account rejects a tab header even without the cookie', async () => {
    await expect(
      controller().deleteAccount(
        { ...admin } as never,
        {
          headers: { impersonate: 'header-user' },
          cookies: {},
        } as never,
        {} as never
      )
    ).rejects.toThrow('Account cannot be deleted while impersonating');
  });

  it('delete-account still honours the legacy cookie fallback', async () => {
    await expect(
      controller().deleteAccount(
        { ...admin } as never,
        {
          headers: {},
          cookies: { impersonate: 'cookie-user' },
        } as never,
        {} as never
      )
    ).rejects.toThrow('Account cannot be deleted while impersonating');
  });
});
