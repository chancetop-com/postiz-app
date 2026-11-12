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

const build = ({ user = null as any } = {}) => {
  const userService = {
    getUserByEmail: vi.fn().mockResolvedValue(user),
    getUserByProvider: vi.fn().mockResolvedValue(null),
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
  const controller = new AuthController(
    new AuthService(
      userService as never,
      organizationService as never,
      emailService as never,
      {} as never,
      {} as never
    ),
    emailService as never
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

  it('activates an account with auth and onboarding headers', async () => {
    const { controller } = build();
    const authService = (controller as any)._authService;
    vi.spyOn(authService, 'activate').mockResolvedValue('jwt-activated');
    const { response, headers, state } = recordedResponse();

    await controller.activate(
      'activation-code',
      undefined as never,
      response as never
    );

    expect(state.body).toEqual({ can: true });
    expect(headers.auth).toBe('jwt-activated');
    expect(headers.onboarding).toBe('true');
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
        expected
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
