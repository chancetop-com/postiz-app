import { describe, expect, it, vi } from 'vitest';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
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

  it('prefers the accepting tab header over a legacy shared showorg cookie', async () => {
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: vi
          .fn()
          .mockResolvedValue([org('org-cookie'), org('org-accepting-tab')]),
        updateApiKey: vi.fn(),
        getUserOrg: vi.fn(),
      } as never,
      {
        getUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', activated: true, isSuperAdmin: false }),
      } as never
    );
    const req: any = {
      headers: {
        auth: AuthChecker.signJWT({
          id: 'user-1',
          email: 'merchant@example.test',
          providerName: 'GENERIC',
          activated: true,
        }),
        showorg: 'org-accepting-tab',
      },
      // A stale first-party cookie from an older deployment must not move the
      // tab that just accepted the invitation.
      cookies: { showorg: 'org-cookie' },
    };

    await middleware.use(req, {} as never, vi.fn());

    expect(req.org.id).toBe('org-accepting-tab');
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

describe('accepting an invitation from an existing tab session', () => {
  const invite = (overrides: Record<string, unknown> = {}) =>
    AuthChecker.signJWT({
      email: 'merchant@example.test',
      role: 'USER',
      orgId: 'org-invited',
      timeLimit: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      id: 'invite-1',
      ...overrides,
    });

  const response = () => {
    const headers: Record<string, string> = {};
    const cookies: unknown[] = [];
    let body: unknown;
    let status = 200;
    const res = {
      header(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return res;
      },
      cookie(...args: unknown[]) {
        cookies.push(args);
        return res;
      },
      status(code: number) {
        status = code;
        return res;
      },
      json(value: unknown) {
        body = value;
        return res;
      },
    };
    return {
      res,
      headers,
      cookies,
      get body() {
        return body;
      },
      get status() {
        return status;
      },
    };
  };

  const build = (addUserToOrg: any) => {
    const auth = new AuthService(
      {} as never,
      { addUserToOrg } as never,
      {} as never,
      {} as never,
      {} as never,
      { lead: vi.fn() } as never
    );
    const controller = new UsersController(
      {} as never,
      {} as never,
      auth,
      { addUserToOrg } as never,
      {} as never,
      {} as never
    );
    return { controller, addUserToOrg };
  };

  it('adds one membership and returns showorg for the accepting tab', async () => {
    const addUserToOrg = vi
      .fn()
      .mockResolvedValue({ organizationId: 'org-invited' });
    const { controller } = build(addUserToOrg);
    const recorded = response();

    await controller.joinOrg(
      { id: 'user-1' } as never,
      invite({ role: 'ADMIN' }),
      recorded.res as never
    );

    expect(addUserToOrg).toHaveBeenCalledTimes(1);
    expect(addUserToOrg).toHaveBeenCalledWith(
      'user-1',
      'invite-1',
      'org-invited',
      'ADMIN'
    );
    expect(recorded.status).toBe(200);
    expect(recorded.body).toEqual({ id: 'org-invited' });
    expect(recorded.headers.showorg).toBe('org-invited');
    // tab-scoped: the switch travels in the response header, not a cookie
    expect(recorded.cookies).toHaveLength(0);
  });

  it('keeps a repeated acceptance at one membership and emits no showorg', async () => {
    const addUserToOrg = vi.fn().mockResolvedValue(false);
    const { controller } = build(addUserToOrg);
    const recorded = response();

    await controller.joinOrg(
      { id: 'user-1' } as never,
      invite(),
      recorded.res as never
    );

    expect(addUserToOrg).toHaveBeenCalledTimes(1);
    expect(recorded.body).toEqual({ id: null });
    expect(recorded.headers.showorg).toBeUndefined();
  });

  it.each([
    ['expired', invite({ timeLimit: '2000-01-01T00:00:00.000Z' })],
    ['invalid', 'not-a-signed-invite'],
    ['unsigned org id', 'org-invited'],
  ])('leaves membership untouched for an %s invitation', async (_label, value) => {
    const addUserToOrg = vi.fn();
    const { controller } = build(addUserToOrg);
    const recorded = response();

    await controller.joinOrg(
      { id: 'user-1' } as never,
      value,
      recorded.res as never
    );

    expect(addUserToOrg).not.toHaveBeenCalled();
    expect(recorded.body).toEqual({ id: null });
    expect(recorded.headers.showorg).toBeUndefined();
  });
});
