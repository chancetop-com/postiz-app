import { describe, expect, it, vi } from 'vitest';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

/**
 * Ticket 05: which organisation a signed-in person actually works in.
 *
 * The historical rule is: an explicitly chosen organisation wins, a disabled
 * membership is skipped, and the default is the first usable membership in the
 * order the database returns. Ticket 04 pinned the SSO handoff and the manual
 * switch; this file pins the default attribution and the unusable cases.
 *
 * Upstream v2.25.3 started preferring an organisation with a subscription as
 * the default. The specification forbids letting that reorder attribution, so
 * the default stays orgs[0] (after filtering disabled memberships).
 */

process.env.JWT_SECRET = 'ticket-05-org-secret';

const org = (id: string, extra: any = {}) => ({
  id,
  apiKey: `key-${id}`,
  users: [{ disabled: false, role: 'SUPERADMIN' }],
  ...extra,
});

const run = async (
  orgs: any[],
  { showorg, activated = true } = {
    showorg: undefined as string | undefined,
    activated: true,
  }
) => {
  const updateApiKey = vi.fn();
  const middleware = new AuthMiddleware(
    {
      getOrgsByUserId: vi.fn().mockResolvedValue(orgs),
      updateApiKey,
      getUserOrg: vi.fn(),
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
  const res: any = { header: vi.fn(), cookie: vi.fn() };
  const next = vi.fn();

  await middleware.use(req, res, next);
  return { req, next };
};

describe('default organisation attribution', () => {
  it('defaults to the first usable membership, not a later subscribed organisation', async () => {
    const { req, next } = await run([
      org('org-first'),
      org('org-subscribed', { subscription: { subscriptionTier: 'PRO' } }),
    ]);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.org.id).toBe('org-first');
  });

  it('skips a disabled first membership and runs in the next usable one', async () => {
    const { req } = await run([
      org('org-disabled', { users: [{ disabled: true }] }),
      org('org-enabled'),
      org('org-later'),
    ]);

    expect(req.org.id).toBe('org-enabled');
  });

  it('honours a manual switch to a non-default organisation', async () => {
    const { req } = await run(
      [
        org('org-first'),
        org('org-second'),
        org('org-subscribed', { subscription: {} }),
      ],
      { showorg: 'org-second' }
    );

    expect(req.org.id).toBe('org-second');
  });

  it('keeps the requested organisation even when another one has a subscription', async () => {
    const { req } = await run(
      [
        org('org-subscribed', { subscription: {} }),
        org('org-chosen'),
      ],
      { showorg: 'org-chosen' }
    );

    expect(req.org.id).toBe('org-chosen');
  });

  it('rejects every membership being disabled', async () => {
    await expect(
      run([
        org('org-a', { users: [{ disabled: true }] }),
        org('org-b', { users: [{ disabled: true }] }),
      ])
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a user that has no organisation at all', async () => {
    await expect(run([])).rejects.toMatchObject({ status: 403 });
  });
});

describe('manual organisation switch endpoint', () => {
  const controller = () =>
    new UsersController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

  const recordedResponse = () => {
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
    return { response, headers };
  };

  it('returns the selected organisation so the tab can store it', () => {
    const { response, headers } = recordedResponse();

    controller().changeOrg('org-2', response as never);

    expect(headers.showorg).toBe('org-2');
  });

  it('creates the api key of the organisation that was actually selected', async () => {
    const updateApiKey = vi.fn();
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: vi
          .fn()
          .mockResolvedValue([org('org-first'), org('org-chosen', { apiKey: null })]),
        updateApiKey,
        getUserOrg: vi.fn(),
      } as never,
      {
        getUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', activated: true, isSuperAdmin: false }),
      } as never
    );
    const req: any = {
      headers: { auth: AuthChecker.signJWT({ id: 'user-1', email: 'merchant@example.test', providerName: 'GENERIC', activated: true }), showorg: 'org-chosen' },
      cookies: {},
    };

    await middleware.use(req, {} as never, vi.fn());

    expect(req.org.id).toBe('org-chosen');
    expect(updateApiKey).toHaveBeenCalledWith('org-chosen');
  });
});
