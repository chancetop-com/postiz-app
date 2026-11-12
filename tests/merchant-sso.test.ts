import { describe, expect, it, vi } from 'vitest';
import { Provider } from '@prisma/client';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';

type Stubs = {
  existingUser?: { id: string } | null;
  orgs?: { id: string }[];
};

/**
 * AuthService.ssoLogin is the only place that turns a merchant identity into
 * a Postiz account. These tests pin the contract: reuse an existing
 * GENERIC + merchantId account, otherwise create one organisation.
 */
const buildService = ({ existingUser = null, orgs = [] }: Stubs) => {
  const userService = {
    getUserByProvider: vi.fn().mockResolvedValue(existingUser),
  };
  const organizationService = {
    getOrgsByUserId: vi.fn().mockResolvedValue(orgs),
    createOrgAndUser: vi.fn().mockResolvedValue({
      id: 'org-new',
      users: [{ user: { id: 'user-new' } }],
    }),
  };
  const ssoService = {
    verifyToken: vi
      .fn()
      .mockResolvedValue({ merchantId: 'merchant-9', merchantName: 'Acme Ltd' }),
  };

  const service = new AuthService(
    userService as never,
    organizationService as never,
    { sendEmailSync: vi.fn() } as never,
    {} as never,
    ssoService as never
  );

  return { service, userService, organizationService, ssoService };
};

describe('AuthService.ssoLogin', () => {
  it('looks the merchant up as a GENERIC provider account', async () => {
    const { service, userService } = buildService({ existingUser: { id: 'u-1' }, orgs: [{ id: 'org-1' }] });

    await service.ssoLogin('code');

    expect(userService.getUserByProvider).toHaveBeenCalledWith('merchant-9', Provider.GENERIC);
  });

  it('reuses the existing account and its first organisation', async () => {
    const { service, organizationService } = buildService({
      existingUser: { id: 'u-1' },
      orgs: [{ id: 'org-1' }, { id: 'org-2' }],
    });

    const result = await service.ssoLogin('code');

    expect(result).toEqual({ user: { id: 'u-1' }, orgId: 'org-1' });
    expect(organizationService.createOrgAndUser).not.toHaveBeenCalled();
  });

  it('returns a null organisation when the existing user has none', async () => {
    const { service, organizationService } = buildService({ existingUser: { id: 'u-1' }, orgs: [] });

    const result = await service.ssoLogin('code');

    expect(result.orgId).toBeNull();
    expect(organizationService.createOrgAndUser).not.toHaveBeenCalled();
  });

  it('creates an organisation for a first-time merchant', async () => {
    const { service, organizationService } = buildService({ existingUser: null });

    const result = await service.ssoLogin('code');

    expect(organizationService.createOrgAndUser).toHaveBeenCalledTimes(1);
    expect(organizationService.createOrgAndUser).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Acme Ltd',
        provider: Provider.GENERIC,
        providerId: 'merchant-9',
      }),
      expect.any(String),
      expect.any(String)
    );
    expect(result).toEqual({ user: { id: 'user-new' }, orgId: 'org-new' });
  });
});
