import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { SsoService } from '@gitroom/backend/services/auth/sso.service';
import { SsoLoginDto } from '@gitroom/nestjs-libraries/dtos/auth/sso.login.dto';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

/**
 * Ticket 04: the `/auth/sso` route as the parent app and the SSO page see it.
 *
 * The controller, the validation pipe, AuthService and SsoService are the real
 * implementation. Only the external SSO provider (fetch / a local socket) and
 * the persistence layer are replaced. The assertions are on the HTTP response
 * headers and body, not on internal helper calls.
 */

process.env.JWT_SECRET = 'ticket-04-test-secret';

const pipe = new ValidationPipe({ transform: true });

const recordedResponse = () => {
  const headers: Record<string, string> = {};
  const state: { status: number; body?: unknown; sent?: string } = {
    status: 200,
  };
  const response = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
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
  };
  return { response, headers, state };
};

type Merchant = { id: string; email: string };

const buildController = ({
  existing = null as Merchant | null,
  orgs = [] as { id: string; users?: { disabled: boolean }[] }[],
  merchant = { merchantId: 'merchant-9', merchantName: 'Acme Ltd' },
} = {}) => {
  const userService = {
    getUserByProvider: vi.fn().mockResolvedValue(existing),
  };
  const created = {
    id: 'org-new',
    users: [{ user: { id: 'user-new', email: `${merchant.merchantId}@sso.merchant` } }],
  };
  const organizationService = {
    getOrgsByUserId: vi.fn().mockResolvedValue(orgs),
    createOrgAndUser: vi.fn().mockResolvedValue(created),
  };
  const ssoService = {
    verifyToken: vi.fn().mockResolvedValue(merchant),
  };

  const authService = new AuthService(
    userService as never,
    organizationService as never,
    { sendEmailSync: vi.fn() } as never,
    {} as never,
    ssoService as never
  );
  const controller = new AuthController(authService, {
    hasProvider: () => false,
  } as never);

  return { controller, userService, organizationService, ssoService, created };
};

const postSso = async (
  controller: AuthController,
  body: Record<string, unknown>
) => {
  const validated = (await pipe.transform(body, {
    type: 'body',
    metatype: SsoLoginDto,
  })) as SsoLoginDto;
  const { response, headers, state } = recordedResponse();
  await controller.ssoLogin(validated, response as never);
  return { headers, state };
};

describe('POST /auth/sso - merchant exchange', () => {
  it('creates the shared account once for a first-time merchant and starts the session', async () => {
    const { controller, organizationService, created } = buildController();

    const { headers, state } = await postSso(controller, { auth_code: 'c-1' });

    expect(state.status).toBe(200);
    expect(state.body).toEqual({ login: true });
    expect(JSON.stringify(state.body)).not.toContain('needsCreation');

    // one user, one organisation, bound to the merchant identity
    expect(organizationService.createOrgAndUser).toHaveBeenCalledTimes(1);
    expect(organizationService.createOrgAndUser).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Acme Ltd',
        email: 'merchant-9@sso.merchant',
        provider: Provider.GENERIC,
        providerId: 'merchant-9',
      }),
      'sso-auto',
      'sso-client'
    );

    // session headers point at the new user and organisation
    expect(AuthChecker.verifyJWT(headers.auth)).toEqual(
      expect.objectContaining({ id: 'user-new' })
    );
    expect(headers.showorg).toBe(created.id);
  });

  it('reuses the existing merchant account and its first organisation', async () => {
    const { controller, organizationService } = buildController({
      existing: { id: 'user-existing', email: 'merchant-9@sso.merchant' },
      orgs: [{ id: 'org-1' }, { id: 'org-2' }],
    });

    const { headers, state } = await postSso(controller, { auth_code: 'c-2' });

    expect(state.body).toEqual({ login: true });
    expect(organizationService.createOrgAndUser).not.toHaveBeenCalled();
    expect(AuthChecker.verifyJWT(headers.auth)).toEqual(
      expect.objectContaining({ id: 'user-existing' })
    );
    expect(headers.showorg).toBe('org-1');
  });

  it('starts the session without an organisation when the merchant has none', async () => {
    const { controller, organizationService } = buildController({
      existing: { id: 'user-existing', email: 'merchant-9@sso.merchant' },
      orgs: [],
    });

    const { headers, state } = await postSso(controller, { auth_code: 'c-3' });

    expect(state.body).toEqual({ login: true });
    expect(organizationService.createOrgAndUser).not.toHaveBeenCalled();
    expect(headers.auth).toBeTruthy();
    expect(headers.showorg).toBeUndefined();
  });

  it('gives every user of the same merchant the same shared account', async () => {
    let account: { id: string; email: string } | null = null;
    const userService = {
      getUserByProvider: vi.fn(async () => account),
    };
    const organizationService = {
      getOrgsByUserId: vi.fn(async () => [{ id: 'org-shared' }]),
      createOrgAndUser: vi.fn(async () => {
        account = { id: 'user-shared', email: 'merchant-9@sso.merchant' };
        return {
          id: 'org-shared',
          users: [{ user: account }],
        };
      }),
    };
    const controller = new AuthController(
      new AuthService(
        userService as never,
        organizationService as never,
        { sendEmailSync: vi.fn() } as never,
        {} as never,
        {
          verifyToken: vi
            .fn()
            .mockResolvedValue({ merchantId: 'merchant-9', merchantName: 'Acme Ltd' }),
        } as never
      ),
      { hasProvider: () => false } as never
    );

    const first = await postSso(controller, { auth_code: 'first-user' });
    const second = await postSso(controller, { auth_code: 'second-user' });

    expect(organizationService.createOrgAndUser).toHaveBeenCalledTimes(1);
    expect(AuthChecker.verifyJWT(first.headers.auth)).toEqual(
      expect.objectContaining({ id: 'user-shared' })
    );
    expect(AuthChecker.verifyJWT(second.headers.auth)).toEqual(
      expect.objectContaining({ id: 'user-shared' })
    );
    expect(first.headers.showorg).toBe('org-shared');
    expect(second.headers.showorg).toBe('org-shared');
  });
});

describe('POST /auth/sso - failures', () => {
  const expectRejectedWithoutSession = async (
    controller: AuthController,
    body: Record<string, unknown>
  ) => {
    const { headers, state } = await postSso(controller, body);
    expect(state.status).toBe(400);
    expect(state.sent).toBeTruthy();
    expect(state.body).toBeUndefined();
    expect(headers.auth).toBeUndefined();
    expect(headers.showorg).toBeUndefined();
    return state.sent;
  };

  it('rejects a missing code at the request boundary', async () => {
    await expect(
      pipe.transform({}, { type: 'body', metatype: SsoLoginDto })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blank code at the request boundary', async () => {
    await expect(
      pipe.transform({ auth_code: '' }, { type: 'body', metatype: SsoLoginDto })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports an invalid code without opening a session', async () => {
    const { controller, ssoService } = buildController();
    ssoService.verifyToken.mockRejectedValue(
      new Error('Invalid or expired SSO token')
    );

    await expectRejectedWithoutSession(controller, { auth_code: 'expired' });
  });

  it('reports an exchange rejection without opening a session', async () => {
    const { controller, ssoService } = buildController();
    ssoService.verifyToken.mockRejectedValue(new Error('fetch failed'));

    expect(
      await expectRejectedWithoutSession(controller, { auth_code: 'c-4' })
    ).toBe('fetch failed');
  });

  it('reports an incomplete reply without opening a session', async () => {
    const { controller, ssoService } = buildController();
    ssoService.verifyToken.mockRejectedValue(
      new Error('SSO server returned incomplete user info')
    );

    expect(
      await expectRejectedWithoutSession(controller, { auth_code: 'c-5' })
    ).toBe('SSO server returned incomplete user info');
  });
});

// Same controller and services, but the SSO provider is a real socket. The
// stub consumes its code once, like a one-time auth code.
describe('POST /auth/sso over a real exchange socket', () => {
  let server: Server | undefined;

  const realServiceController = () =>
    new AuthController(
      new AuthService(
        { getUserByProvider: vi.fn().mockResolvedValue(null) } as never,
        {
          getOrgsByUserId: vi.fn(),
          createOrgAndUser: vi.fn().mockResolvedValue({
            id: 'org-new',
            users: [
              { user: { id: 'user-new', email: 'merchant-9@sso.merchant' } },
            ],
          }),
        } as never,
        { sendEmailSync: vi.fn() } as never,
        {} as never,
        new SsoService()
      ),
      { hasProvider: () => false } as never
    );

  const serveExchange = () =>
    new Promise<{
      url: string;
      requests: { path: string; body: string }[];
    }>((resolve) => {
      const requests: { path: string; body: string }[] = [];
      const consumed = new Set<string>();
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          requests.push({ path: req.url || '', body });
          const code = JSON.parse(body).auth_code as string;
          if (consumed.has(code)) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'already used' }));
            return;
          }
          consumed.add(code);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ merchant_id: 'merchant-9', merchant_name: 'Acme Ltd' }));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({
          url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/sso/verify`,
          requests,
        });
      });
    });

  beforeEach(() => {
    delete process.env.SSO_SERVER_URL;
  });

  afterEach(async () => {
    delete process.env.SSO_SERVER_URL;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('accepts the code once and rejects the replay without a session', async () => {
    const exchange = await serveExchange();
    process.env.SSO_SERVER_URL = exchange.url;
    const controller = realServiceController();

    const first = await postSso(controller, { auth_code: 'one-time' });
    expect(first.state.status).toBe(200);
    expect(first.headers.auth).toBeTruthy();
    expect(first.headers.showorg).toBe('org-new');

    const second = await postSso(controller, { auth_code: 'one-time' });
    expect(second.state.status).toBe(400);
    expect(second.state.sent).toMatch(/Invalid or expired SSO token/);
    expect(second.headers.auth).toBeUndefined();
  });

  it('posts { auth_code } to the full configured endpoint without appending a path', async () => {
    const exchange = await serveExchange();
    process.env.SSO_SERVER_URL = exchange.url;
    const controller = realServiceController();

    const { headers } = await postSso(controller, { auth_code: 'shape-check' });

    expect(headers.auth).toBeTruthy();
    expect(exchange.requests).toEqual([
      { path: '/api/sso/verify', body: JSON.stringify({ auth_code: 'shape-check' }) },
    ]);
  });
});
