import { describe, expect, it, vi } from 'vitest';
import { Provider, Role } from '@prisma/client';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

/**
 * Ticket 04: what a merchant account looks like and which organisation a
 * request actually runs in.
 *
 * The SSO account is an organisation-scoped SUPERADMIN, never a global admin.
 * Organisation selection keeps the historical order: the requested/SSO-chosen
 * organisation wins, disabled or foreign memberships are skipped, and the
 * first usable membership is the fallback. A missing organisation is not
 * repaired here.
 */

process.env.JWT_SECRET = 'ticket-04-org-secret';

describe('first-time merchant provisioning', () => {
  const run = async () => {
    let captured: any;
    const create = vi.fn(async ({ data }: { data: any }) => {
      captured = data;
      return { id: 'org-new', users: [{ user: { id: 'user-new' } }] };
    });
    const repository = new OrganizationRepository(
      { model: { organization: { create } } } as never,
      {} as never,
      {} as never
    );

    const result = await repository.createOrgAndUser(
      {
        company: 'Acme Ltd',
        email: 'merchant-9@sso.merchant',
        password: '',
        provider: Provider.GENERIC,
        providerId: 'merchant-9',
        datafast_visitor_id: undefined,
      },
      false,
      '203.0.113.7',
      'ticket-04'
    );

    return { result, create, data: captured };
  };

  it('creates exactly one organisation with one SUPERADMIN membership', async () => {
    const { create, data } = await run();

    expect(create).toHaveBeenCalledTimes(1);
    expect(data.name).toBe('Acme Ltd');
    expect(Array.isArray(data.users.create)).toBe(false);
    expect(data.users.create.role).toBe(Role.SUPERADMIN);
  });

  it('binds the user to the merchant identity and activates the shared account', async () => {
    const { data } = await run();

    expect(data.users.create.user.create).toEqual(
      expect.objectContaining({
        email: 'merchant-9@sso.merchant',
        providerName: Provider.GENERIC,
        providerId: 'merchant-9',
        activated: true,
        password: '',
      })
    );
  });

  it('does not grant the global administrator flag', async () => {
    const { data } = await run();

    expect(data.users.create.user.isSuperAdmin).toBeUndefined();
  });
});

describe('merchant organisation selection', () => {
  const serviceWith = (orgs: { id: string }[], existing = true) => {
    const userService = {
      getUserByProvider: vi
        .fn()
        .mockResolvedValue(existing ? { id: 'user-1' } : null),
    };
    const organizationService = {
      getOrgsByUserId: vi.fn().mockResolvedValue(orgs),
      createOrgAndUser: vi.fn(),
    };
    return {
      service: new AuthService(
        userService as never,
        organizationService as never,
        { sendEmailSync: vi.fn() } as never,
        {} as never,
        {
          verifyToken: vi
            .fn()
            .mockResolvedValue({ merchantId: 'merchant-9', merchantName: 'Acme' }),
        } as never
      ),
      organizationService,
    };
  };

  it('selects the first organisation returned for the merchant', async () => {
    const { service } = serviceWith([{ id: 'org-1' }, { id: 'org-2' }]);

    await expect(service.ssoLogin('code')).resolves.toEqual({
      user: { id: 'user-1' },
      orgId: 'org-1',
    });
  });

  it('does not replace an existing merchant selection when the first membership is disabled', async () => {
    const { service } = serviceWith([
      { id: 'org-disabled', users: [{ disabled: true }] } as never,
      { id: 'org-enabled' } as never,
    ]);

    // selection stays orgs[0]; request-time membership validity is applied by
    // the auth middleware, not by rewriting the stored selection
    const result = await service.ssoLogin('code');
    expect(result.orgId).toBe('org-disabled');
  });

  it('returns no organisation instead of creating a replacement', async () => {
    const { service, organizationService } = serviceWith([]);

    const result = await service.ssoLogin('code');

    expect(result.orgId).toBeNull();
    expect(organizationService.createOrgAndUser).not.toHaveBeenCalled();
  });
});

describe('request-time organisation resolution', () => {
  const run = async (
    orgs: any[],
    { showorg, activated = true } = { showorg: undefined as string | undefined, activated: true }
  ) => {
    const updateApiKey = vi.fn();
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: vi.fn().mockResolvedValue(orgs),
        updateApiKey,
      } as never,
      {
        getUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', activated, isSuperAdmin: false }),
      } as never
    );
    const auth = AuthChecker.signJWT({ id: 'user-1', email: 'merchant@example.test', providerName: 'GENERIC', activated: true });
    const req: any = {
      headers: { auth, ...(showorg ? { showorg } : {}) },
      cookies: {},
    };
    const res: any = {};
    const next = vi.fn();

    await middleware.use(req, res, next);
    return { req, next };
  };

  const org = (id: string, extra: any = {}) => ({
    id,
    apiKey: `key-${id}`,
    users: [{ disabled: false }],
    ...extra,
  });

  it('runs in the organisation chosen by the SSO handoff or a manual switch', async () => {
    const { req, next } = await run(
      [org('org-subscribed', { subscription: {} }), org('org-chosen')],
      { showorg: 'org-chosen' }
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.org.id).toBe('org-chosen');
    expect(req.user.id).toBe('user-1');
  });

  it('skips a disabled membership and falls back to the first usable one', async () => {
    const { req } = await run(
      [
        org('org-disabled', { users: [{ disabled: true }] }),
        org('org-enabled'),
      ],
      { showorg: 'org-disabled' }
    );

    expect(req.org.id).toBe('org-enabled');
  });

  it('ignores a requested organisation the user does not belong to', async () => {
    const { req } = await run([org('org-a'), org('org-b')], {
      showorg: 'org-foreign',
    });

    expect(req.org.id).toBe('org-a');
  });

  it('accepts the auth cookie when no auth header is present', async () => {
    const updateApiKey = vi.fn();
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: vi
          .fn()
          .mockResolvedValue([org('org-cookie')]),
        updateApiKey,
      } as never,
      {
        getUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', activated: true, isSuperAdmin: false }),
      } as never
    );
    const req: any = {
      headers: {},
      cookies: { auth: AuthChecker.signJWT({ id: 'user-1', email: 'merchant@example.test', providerName: 'GENERIC', activated: true }) },
    };

    await middleware.use(req, {} as never, vi.fn());

    expect(req.org.id).toBe('org-cookie');
  });

  it('prefers the auth header over a stale cookie', async () => {
    const updateApiKey = vi.fn();
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: vi.fn().mockResolvedValue([org('org-header')]),
        updateApiKey,
      } as never,
      {
        getUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', activated: true, isSuperAdmin: false }),
      } as never
    );
    const req: any = {
      headers: { auth: AuthChecker.signJWT({ id: 'user-1', email: 'merchant@example.test', providerName: 'GENERIC', activated: true }) },
      cookies: { auth: 'stale-cookie-that-is-not-a-jwt' },
    };

    await middleware.use(req, {} as never, vi.fn());

    expect(req.org.id).toBe('org-header');
  });

  it('rejects a merchant account that has no usable organisation', async () => {
    await expect(run([], { showorg: undefined })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects an inactive account', async () => {
    await expect(
      run([org('org-a')], { showorg: undefined, activated: false })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('manual organisation switch endpoint', () => {
  it('returns the selected organisation in the showorg header', () => {
    const headers: Record<string, string> = {};
    const response = {
      header(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return response;
      },
      status() {
        return response;
      },
      send() {
        return response;
      },
    };
    const controller = new UsersController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    controller.changeOrg('org-2', response as never);

    expect(headers.showorg).toBe('org-2');
  });
});
