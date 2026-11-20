import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

/**
 * Ticket 04: the ordinary entry points that must keep working next to SSO.
 *
 * Only the database/provider layer is stubbed; the controller, validation pipe
 * and AuthService are the real implementation. OAuth login state is returned
 * in headers for sessionStorage, then supplied as a proof header to the code
 * exchange; neither end requires a browser cookie.
 */

process.env.JWT_SECRET = 'ticket-04-login-secret';
process.env.FRONTEND_URL = 'http://localhost:4200';

const pipe = new ValidationPipe({ transform: true });

const recordedResponse = () => {
  const headers: Record<string, string> = {};
  const cookies: { name: string; value: string; options: any }[] = [];
  const state: {
    status: number;
    body?: unknown;
    sent?: string;
    redirect?: string;
  } = { status: 200 };
  const response = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
    cookie(name: string, value: string, options: any) {
      cookies.push({ name, value, options });
      return response;
    },
    status(code: number) {
      state.status = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
    send(body: string) {
      state.sent = body;
      return response;
    },
    redirect(status: number, url: string) {
      state.status = status;
      state.redirect = url;
      return response;
    },
  };
  return { response, headers, cookies, state };
};

const build = ({
  user = null as any,
  providerManager = {} as any,
} = {}) => {
  const userService = {
    getUserByEmail: vi.fn().mockResolvedValue(user),
    getUserByProvider: vi.fn().mockResolvedValue(user),
  };
  const organizationService = {
    createOrgAndUser: vi.fn().mockResolvedValue({
      id: 'org-new',
      users: [{ user: { id: 'user-new', email: 'new@example.test' } }],
    }),
    addUserToOrg: vi.fn().mockResolvedValue({ organizationId: 'org-invited' }),
    getCount: vi.fn().mockResolvedValue(0),
  };
  const emailService = {
    hasProvider: () => false,
    sendEmailSync: vi.fn(),
  };
  const attributionService = {
    lead: vi.fn().mockResolvedValue(undefined),
    queryParams: vi.fn().mockReturnValue([]),
  };
  const controller = new AuthController(
    new AuthService(
      userService as never,
      organizationService as never,
      emailService as never,
      providerManager as never,
      {} as never,
      attributionService as never
    ),
    emailService as never,
    attributionService as never
  );
  return { controller, userService, organizationService };
};

const localLogin = async (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: LoginUserDto });

const localRegister = async (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: CreateOrgUserDto });

describe('email and password login', () => {
  it('starts a session with auth and reload headers', async () => {
    const password = AuthChecker.hashPassword('correct horse');
    const { controller } = build({
      user: {
        id: 'user-1',
        email: 'merchant@example.test',
        password,
        activated: true,
      },
    });
    const body = await localLogin({
      email: 'merchant@example.test',
      password: 'correct horse',
      provider: 'LOCAL',
      providerToken: '',
    });
    const { response, headers, state } = recordedResponse();

    await controller.login(
      { cookies: {} } as never,
      body,
      response as never,
      '203.0.113.7',
      'ticket-04'
    );

    expect(state.status).toBe(200);
    expect(state.body).toEqual({ login: true });
    expect(AuthChecker.verifyJWT(headers.auth)).toEqual(
      expect.objectContaining({ id: 'user-1' })
    );
    expect(headers.reload).toBe('true');
  });

  it('rejects a wrong password without a session', async () => {
    const password = AuthChecker.hashPassword('correct horse');
    const { controller } = build({
      user: {
        id: 'user-1',
        email: 'merchant@example.test',
        password,
        activated: true,
      },
    });
    const body = await localLogin({
      email: 'merchant@example.test',
      password: 'wrong',
      provider: 'LOCAL',
      providerToken: '',
    });
    const { response, headers, state } = recordedResponse();

    await controller.login(
      { cookies: {} } as never,
      body,
      response as never,
      '203.0.113.7',
      'ticket-04'
    );

    expect(state.status).toBe(400);
    expect(state.sent).toBe('Invalid user name or password');
    expect(headers.auth).toBeUndefined();
  });
});

describe('register and activate', () => {
  it('registers a local account and starts onboarding', async () => {
    const { controller, organizationService } = build();
    const body = await localRegister({
      email: 'new@example.test',
      password: 'a password',
      company: 'New Co',
      provider: 'LOCAL',
      providerToken: '',
    });
    const { response, headers, state } = recordedResponse();

    await controller.register(
      { cookies: {} } as never,
      body,
      response as never,
      '203.0.113.7',
      'ticket-04'
    );

    expect(organizationService.createOrgAndUser).toHaveBeenCalledTimes(1);
    expect(state.body).toEqual({ register: true });
    expect(headers.auth).toBeTruthy();
    expect(headers.onboarding).toBe('true');
    expect(headers.activate).toBeUndefined();
  });

  it('adds a matching invite to a new registration', async () => {
    const { controller, organizationService } = build();
    const body = await localRegister({
      email: 'new@example.test',
      password: 'a password',
      company: 'New Co',
      provider: 'LOCAL',
      providerToken: '',
    });
    const { response, headers } = recordedResponse();

    await controller.register(
      {
        cookies: {},
        headers: { 'org-invite': inviteToken({ email: 'new@example.test' }) },
      } as never,
      body,
      response as never,
      '203.0.113.7',
      'ticket-04'
    );

    expect(organizationService.addUserToOrg).toHaveBeenCalledTimes(1);
    expect(headers.showorg).toBe('org-invited');
  });

  it('does not add a registration to an invitation for another email', async () => {
    const { controller, organizationService } = build();
    const body = await localRegister({
      email: 'new@example.test',
      password: 'a password',
      company: 'New Co',
      provider: 'LOCAL',
      providerToken: '',
    });
    const { response, headers, state } = recordedResponse();

    await controller.register(
      {
        cookies: {},
        headers: { 'org-invite': inviteToken() },
      } as never,
      body,
      response as never,
      '203.0.113.7',
      'ticket-04'
    );

    expect(state.body).toEqual({ register: true });
    expect(organizationService.addUserToOrg).not.toHaveBeenCalled();
    expect(headers.showorg).toBeUndefined();
  });

  it('activates an account with auth and onboarding headers', async () => {
    const { controller } = build();
    const authService = (controller as any)._authService;
    vi.spyOn(authService, 'activate').mockResolvedValue({
      jwt: 'jwt-activated',
      addedOrg: false,
    });
    const { response, headers, state } = recordedResponse();

    await controller.activate(
      { cookies: {}, headers: {} } as never,
      'activation-code',
      undefined as never,
      response as never
    );

    expect(state.body).toEqual({ can: true });
    expect(headers.auth).toBe('jwt-activated');
    expect(headers.onboarding).toBe('true');
  });

  const activationService = (
    user: Record<string, unknown>,
    addUserToOrg = vi.fn().mockResolvedValue(false)
  ) => {
    const userService = {
      getUserByEmail: vi.fn().mockResolvedValue(user),
      activateUser: vi.fn(),
    };
    const organizationService = { addUserToOrg };
    const service = new AuthService(
      userService as never,
      organizationService as never,
      { hasProvider: () => false, sendEmailSync: vi.fn() } as never,
      {} as never,
      {} as never,
      { lead: vi.fn(), queryParams: vi.fn() } as never
    );
    return {
      service,
      addUserToOrg,
      controller: new AuthController(
        service,
        { hasProvider: () => false } as never,
        { lead: vi.fn() } as never
      ),
    };
  };

  it('answers showorg when the activation tab presents the accepted invitation', async () => {
    const { controller, addUserToOrg } = activationService({
      id: 'user-1',
      email: 'merchant@example.test',
      activated: false,
      inviteId: 'invite-1',
    });
    const code = AuthChecker.signJWT({
      id: 'user-1',
      email: 'merchant@example.test',
      activated: false,
    });
    const { response, headers, state } = recordedResponse();

    await controller.activate(
      {
        cookies: {},
        headers: { 'org-invite': inviteToken() },
      } as never,
      code,
      undefined as never,
      response as never
    );

    expect(state.body).toEqual({ can: true });
    expect(addUserToOrg).toHaveBeenCalledWith(
      'user-1',
      'invite-1',
      'org-invited',
      'USER'
    );
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBe('org-invited');
  });

  it('does not emit showorg on activation for another recipient', async () => {
    const { controller, addUserToOrg } = activationService({
      id: 'user-1',
      email: 'other@example.test',
      activated: false,
      inviteId: null,
    });
    const code = AuthChecker.signJWT({
      id: 'user-1',
      email: 'other@example.test',
      activated: false,
    });
    const { response, headers } = recordedResponse();

    await controller.activate(
      {
        cookies: {},
        headers: { 'org-invite': inviteToken() },
      } as never,
      code,
      undefined as never,
      response as never
    );

    expect(addUserToOrg).not.toHaveBeenCalled();
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });
});

describe('standard OAuth login state round trip', () => {
  it('returns session state headers without setting cookies and gives the nonce to the provider', async () => {
    const { controller } = build();
    const authService = (controller as any)._authService;
    const oauthLink = vi
      .spyOn(authService, 'oauthLink')
      .mockResolvedValue({ url: 'https://provider.example/authorize' });
    const { response, cookies, headers } = recordedResponse();

    await controller.oauthLink('github', {}, response as never);

    expect(cookies).toHaveLength(0);
    expect(headers['oauth-state']).toMatch(/^login-/);
    expect(headers['oauth-state-token']).toEqual(expect.any(String));
    expect(headers['cache-control']).toBe('no-store');
    expect(oauthLink).toHaveBeenCalledWith(
      'github',
      expect.objectContaining({ state: headers['oauth-state'] })
    );
  });

  it('switches the tab to the invited organization after the exchange', async () => {
    const { controller } = build();
    const authService = (controller as any)._authService;
    vi.spyOn(authService, 'checkExists').mockResolvedValue({
      jwt: 'jwt-oauth',
      token: null,
      addedOrg: { organizationId: 'org-invited' },
    } as never);
    const { response, cookies, headers, state } = recordedResponse();

    await controller.oauthExists(
      {
        headers: { 'content-type': 'application/json' },
        get: () => 'signed-state-token',
        cookies: {},
      } as never,
      'provider-code',
      'redirect-uri',
      'login-abc',
      'github',
      response as never
    );

    expect(state.status).toBe(200);
    expect(headers.auth).toBe('jwt-oauth');
    expect(headers.showorg).toBe('org-invited');
    expect(headers.reload).toBe('true');
    expect(cookies).toHaveLength(0);
  });

  it.each([
    ['a session proof header', 'signed-state-token', 'signed-state-token'],
    ['a missing proof header', undefined, undefined],
  ])(
    'passes the state from %s into the callback exchange',
    async (_label, stateToken, expected) => {
      const { controller } = build();
      const authService = (controller as any)._authService;
      const checkExists = vi
        .spyOn(authService, 'checkExists')
        .mockResolvedValue({ jwt: 'jwt-oauth', token: null } as never);
      const { response, headers, state } = recordedResponse();

      await controller.oauthExists(
        {
          headers: { 'content-type': 'application/json' },
          get: () => stateToken,
          cookies: { oauth_state: 'ignored-cookie' },
        } as never,
        'provider-code',
        'redirect-uri',
        'login-abc',
        'github',
        response as never
      );

      expect(checkExists).toHaveBeenCalledWith(
        'github',
        'provider-code',
        'redirect-uri',
        'login-abc',
        expected,
        false
      );
      expect(state.status).toBe(200);
      expect(headers.auth).toBe('jwt-oauth');
    }
  );

  it('rejects a non-JSON callback post before exchanging the code', async () => {
    const { controller } = build();
    const authService = (controller as any)._authService;
    const checkExists = vi.spyOn(authService, 'checkExists');
    const { response, state } = recordedResponse();

    await controller.oauthExists(
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        cookies: {},
      } as never,
      'provider-code',
      'redirect-uri',
      'state',
      'github',
      response as never
    );

    expect(state.status).toBe(400);
    expect(checkExists).not.toHaveBeenCalled();
  });
});

const inviteToken = (overrides: Record<string, unknown> = {}) =>
  AuthChecker.signJWT({
    email: 'merchant@example.test',
    role: 'USER',
    orgId: 'org-invited',
    timeLimit: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    id: 'invite-1',
    ...overrides,
  });

const passwordUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'merchant@example.test',
  password: AuthChecker.hashPassword('correct horse'),
  activated: true,
  providerName: 'LOCAL',
  ...overrides,
});

const loginWithInvite = async (
  invite: string | undefined,
  {
    user = passwordUser(),
    addUserToOrg = {} as any,
    loginEmail = 'merchant@example.test',
  } = {}
) => {
  const organizationService = {
    createOrgAndUser: vi.fn(),
    addUserToOrg,
    getCount: vi.fn().mockResolvedValue(0),
  };
  const userService = {
    getUserByEmail: vi.fn().mockResolvedValue(user),
    getUserByProvider: vi.fn().mockResolvedValue(null),
  };
  const emailService = { hasProvider: () => false, sendEmailSync: vi.fn() };
  const attributionService = { lead: vi.fn(), queryParams: vi.fn() };
  const service = new AuthService(
    userService as never,
    organizationService as never,
    emailService as never,
    {} as never,
    {} as never,
    attributionService as never
  );
  const controller = new AuthController(
    service,
    emailService as never,
    attributionService as never
  );
  const body = await localLogin({
    email: loginEmail,
    password: 'correct horse',
    provider: 'LOCAL',
    providerToken: '',
  });
  const recorded = recordedResponse();

  await controller.login(
    {
      cookies: {},
      headers: invite ? { 'org-invite': invite } : {},
    } as never,
    body,
    recorded.response as never,
    '203.0.113.7',
    'ticket-03'
  );

  return { ...recorded, organizationService, controller };
};

describe('organization invitation through password login', () => {
  it('joins the invited organization once, in the invited role, and answers showorg', async () => {
    const addUserToOrg = vi
      .fn()
      .mockResolvedValue({ organizationId: 'org-invited' });

    const { headers, cookies, state, organizationService } =
      await loginWithInvite(inviteToken(), { addUserToOrg });

    expect(state.status).toBe(200);
    expect(organizationService.addUserToOrg).toHaveBeenCalledTimes(1);
    expect(organizationService.addUserToOrg).toHaveBeenCalledWith(
      'user-1',
      'invite-1',
      'org-invited',
      'USER'
    );
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBe('org-invited');
    // Only this response carries the switch; no shared cookie is written.
    expect(cookies).toHaveLength(0);
  });

  it('does not join an invitation addressed to another account', async () => {
    const addUserToOrg = vi.fn();

    const { headers, state, organizationService } = await loginWithInvite(
      inviteToken(),
      {
        addUserToOrg,
        user: passwordUser({ email: 'other@example.test' }),
        loginEmail: 'other@example.test',
      }
    );

    // The ordinary login still succeeds, but the signed invite is only a
    // bearer token for its named recipient.
    expect(state.status).toBe(200);
    expect(organizationService.addUserToOrg).not.toHaveBeenCalled();
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });

  it('matches the invited email case-insensitively', async () => {
    const addUserToOrg = vi
      .fn()
      .mockResolvedValue({ organizationId: 'org-invited' });

    const { headers, organizationService } = await loginWithInvite(
      inviteToken({ email: 'Merchant@Example.test' }),
      { addUserToOrg }
    );

    expect(organizationService.addUserToOrg).toHaveBeenCalledTimes(1);
    expect(headers.showorg).toBe('org-invited');
  });

  it('keeps a repeated acceptance to one membership and emits no showorg', async () => {
    const addUserToOrg = vi.fn().mockResolvedValue(false);

    const { headers, state, organizationService } = await loginWithInvite(
      inviteToken(),
      { addUserToOrg, user: passwordUser({ inviteId: 'another-invite' }) }
    );

    expect(state.status).toBe(200);
    expect(organizationService.addUserToOrg).toHaveBeenCalledTimes(1);
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });

  it('re-selects the invited organization when the accepted invitation is presented again after activation', async () => {
    // The pre-activation accept already recorded the membership (and
    // `inviteId` proves it came from this invite). Once activated, presenting
    // the still-valid invite must update the accepting tab via showorg.
    const addUserToOrg = vi.fn().mockResolvedValue(false);

    const { headers, state } = await loginWithInvite(inviteToken(), {
      addUserToOrg,
      user: passwordUser({ inviteId: 'invite-1' }),
    });

    expect(state.status).toBe(200);
    expect(addUserToOrg).toHaveBeenCalledTimes(1);
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBe('org-invited');
  });

  it.each([
    ['expired', inviteToken({ timeLimit: '2000-01-01T00:00:00.000Z' })],
    ['invalid', 'not-a-signed-invite'],
  ])(
    'ignores an %s invitation while the ordinary login still succeeds',
    async (_label, invite) => {
      const addUserToOrg = vi.fn();

      const { headers, state, organizationService } = await loginWithInvite(
        invite,
        { addUserToOrg }
      );

      expect(state.status).toBe(200);
      expect(organizationService.addUserToOrg).not.toHaveBeenCalled();
      expect(headers.auth).toBeTruthy();
      expect(headers.showorg).toBeUndefined();
    }
  );

  it('records the membership before the activation gate, without starting a session', async () => {
    const addUserToOrg = vi
      .fn()
      .mockResolvedValue({ organizationId: 'org-invited' });

    const { headers, state, organizationService } = await loginWithInvite(
      inviteToken({ role: 'ADMIN' }),
      { addUserToOrg, user: passwordUser({ activated: false }) }
    );

    expect(state.status).toBe(400);
    expect(state.sent).toBe('User is not activated');
    expect(organizationService.addUserToOrg).toHaveBeenCalledWith(
      'user-1',
      'invite-1',
      'org-invited',
      'ADMIN'
    );
    expect(headers.auth).toBeUndefined();
    expect(headers.showorg).toBeUndefined();
  });

  it('keeps the default organization when the login has no invitation', async () => {
    const addUserToOrg = vi.fn();

    const { headers, state, organizationService } = await loginWithInvite(
      undefined,
      { addUserToOrg }
    );

    expect(state.status).toBe(200);
    expect(organizationService.addUserToOrg).not.toHaveBeenCalled();
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });

  it('still reads the historical org cookie for existing deployments', async () => {
    const addUserToOrg = vi
      .fn()
      .mockResolvedValue({ organizationId: 'org-invited' });
    const organizationService = {
      createOrgAndUser: vi.fn(),
      addUserToOrg,
      getCount: vi.fn().mockResolvedValue(0),
    };
    const controller = new AuthController(
      new AuthService(
        {
          getUserByEmail: vi.fn().mockResolvedValue(passwordUser()),
          getUserByProvider: vi.fn(),
        } as never,
        organizationService as never,
        { hasProvider: () => false } as never,
        {} as never,
        {} as never,
        { lead: vi.fn() } as never
      ),
      { hasProvider: () => false } as never,
      { lead: vi.fn() } as never
    );
    const body = await localLogin({
      email: 'merchant@example.test',
      password: 'correct horse',
      provider: 'LOCAL',
      providerToken: '',
    });
    const recorded = recordedResponse();

    await controller.login(
      { cookies: { org: inviteToken() }, headers: {} } as never,
      body,
      recorded.response as never,
      '203.0.113.7',
      'ticket-03'
    );

    expect(recorded.headers.showorg).toBe('org-invited');
    expect(addUserToOrg).toHaveBeenCalledTimes(1);
  });
});

describe('organization invitation through standard OAuth login', () => {
  const oauthUser = {
    id: 'user-1',
    email: 'merchant@example.test',
    password: '',
    providerName: 'GITHUB',
    activated: true,
  };

  const buildOAuth = (
    addUserToOrg = vi.fn() as any,
    {
      user = oauthUser,
      providerEmail = 'merchant@example.test',
    }: { user?: any; providerEmail?: string } = {}
  ) => {
    const getToken = vi.fn().mockResolvedValue('provider-token');
    const getUser = vi
      .fn()
      .mockResolvedValue({ id: 'provider-user', email: providerEmail });
    const built = build({
      user,
      providerManager: { getProvider: () => ({ getToken, getUser }) },
    });
    built.organizationService.addUserToOrg = addUserToOrg;
    const authService = (built.controller as any)._authService;
    return { ...built, authService, getToken, getUser, addUserToOrg };
  };

  const exchange = async (
    controller: AuthController,
    {
      invite,
      stateToken,
      state = 'login-abc',
    }: { invite?: string; stateToken?: string; state?: string }
  ) => {
    const recorded = recordedResponse();
    await controller.oauthExists(
      {
        headers: {
          'content-type': 'application/json',
          ...(invite ? { 'org-invite': invite } : {}),
        },
        get: () => stateToken,
        cookies: {},
      } as never,
      'provider-code',
      undefined,
      state,
      'github',
      recorded.response as never
    );
    return recorded;
  };

  it('joins the invited organization once after the state proof verifies', async () => {
    const addUserToOrg = vi
      .fn()
      .mockResolvedValue({ organizationId: 'org-invited' });
    const { controller, authService, getToken } = buildOAuth(addUserToOrg);
    const stateToken = authService.createOAuthStateToken('github', 'login-abc');

    const { headers, cookies, state } = await exchange(controller, {
      invite: inviteToken({ role: 'ADMIN' }),
      stateToken,
    });

    expect(state.status).toBe(200);
    expect(getToken).toHaveBeenCalledWith('provider-code', undefined);
    expect(addUserToOrg).toHaveBeenCalledTimes(1);
    expect(addUserToOrg).toHaveBeenCalledWith(
      'user-1',
      'invite-1',
      'org-invited',
      'ADMIN'
    );
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBe('org-invited');
    expect(cookies).toHaveLength(0);
  });

  it('does not join an invitation addressed to another account', async () => {
    const addUserToOrg = vi.fn();
    const { controller, authService } = buildOAuth(addUserToOrg, {
      user: { ...oauthUser, email: 'other@example.test' },
    });
    const stateToken = authService.createOAuthStateToken('github', 'login-abc');

    const { headers, state } = await exchange(controller, {
      invite: inviteToken(),
      stateToken,
    });

    expect(state.status).toBe(200);
    expect(addUserToOrg).not.toHaveBeenCalled();
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });

  it('re-selects the invited organization when the accepted OAuth invitation is presented again', async () => {
    const addUserToOrg = vi.fn().mockResolvedValue(false);
    const { controller, authService } = buildOAuth(addUserToOrg, {
      user: { ...oauthUser, inviteId: 'invite-1' },
    });
    const stateToken = authService.createOAuthStateToken('github', 'login-abc');

    const { headers } = await exchange(controller, {
      invite: inviteToken(),
      stateToken,
    });

    expect(addUserToOrg).toHaveBeenCalledTimes(1);
    expect(headers.showorg).toBe('org-invited');
  });

  it('keeps a repeated OAuth acceptance to one membership and emits no showorg', async () => {
    const addUserToOrg = vi.fn().mockResolvedValue(false);
    const { controller, authService } = buildOAuth(addUserToOrg, {
      user: { ...oauthUser, inviteId: 'another-invite' },
    });
    const stateToken = authService.createOAuthStateToken('github', 'login-abc');

    const { headers, state } = await exchange(controller, {
      invite: inviteToken(),
      stateToken,
    });

    expect(state.status).toBe(200);
    expect(addUserToOrg).toHaveBeenCalledTimes(1);
    expect(headers.showorg).toBeUndefined();
  });

  it.each([
    ['expired', inviteToken({ timeLimit: '2000-01-01T00:00:00.000Z' })],
    ['invalid', 'not-a-signed-invite'],
  ])('ignores an %s invitation after a valid sign-in', async (_label, invite) => {
    const addUserToOrg = vi.fn();
    const { controller, authService } = buildOAuth(addUserToOrg);
    const stateToken = authService.createOAuthStateToken('github', 'login-abc');

    const { headers, state } = await exchange(controller, {
      invite,
      stateToken,
    });

    expect(state.status).toBe(200);
    expect(addUserToOrg).not.toHaveBeenCalled();
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });

  it('rejects a callback without the tab state proof before joining anything', async () => {
    const addUserToOrg = vi.fn();
    const { controller, getToken } = buildOAuth(addUserToOrg);

    await expect(
      exchange(controller, { invite: inviteToken() })
    ).rejects.toThrow('Invalid state');

    expect(getToken).not.toHaveBeenCalled();
    expect(addUserToOrg).not.toHaveBeenCalled();
  });

  it('rejects a state proof issued for another provider before joining anything', async () => {
    const addUserToOrg = vi.fn();
    const { controller, authService } = buildOAuth(addUserToOrg);
    const stateToken = authService.createOAuthStateToken('google', 'login-abc');

    await expect(
      exchange(controller, { invite: inviteToken(), stateToken })
    ).rejects.toThrow('Invalid state');

    expect(addUserToOrg).not.toHaveBeenCalled();
  });
});
