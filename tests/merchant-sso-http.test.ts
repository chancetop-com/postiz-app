import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MiddlewareConsumer, Module, ValidationPipe,
  type INestApplication, type NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { Provider, Role } from '@prisma/client';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { SsoService } from '@gitroom/backend/services/auth/sso.service';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { getCorsOptions } from '@gitroom/backend/cors.config';

process.env.JWT_SECRET = 'ticket-02-http-secret';
process.env.FRONTEND_URL = 'http://localhost:4302';
process.env.NOT_SECURED = 'true';

type User = {
  id: string;
  email: string;
  providerName: Provider;
  activated: boolean;
  isSuperAdmin?: boolean;
};

const buildWorld = () => {
  const users = new Map<string, User>();
  const memberships = new Map<string, { id: string; userId: string; organizationId: string; role: Role; disabled: boolean }>();
  const orgs = new Map<string, { id: string; name: string; apiKey?: string; paymentId?: string }>();
  const byProvider = new Map<string, User>();

  const getUserOrg = vi.fn(async (id: string) => {
    const membership = memberships.get(id);
    if (!membership) return null;
    const user = users.get(membership.userId);
    const organization = orgs.get(membership.organizationId);
    if (!user || !organization) return null;
    return {
      user: { ...user },
      organization: {
        ...organization,
        users: [
          {
            id: membership.id,
            userId: membership.userId,
            disabled: membership.disabled,
            role: membership.role,
          },
        ],
      },
    };
  });

  const userService = {
    getUserByProvider: vi.fn(async (providerId: string, provider: Provider) => {
      return byProvider.get(`${provider}:${providerId}`) || null;
    }),
    getUserById: vi.fn(async (id: string) => users.get(id) || null),
  };

  const organizationService = {
    getActiveMembership: async (userId: string, organizationId: string) => {
      const active = [...memberships.values()].some((membership) =>
        membership.userId === userId &&
        membership.organizationId === organizationId &&
        !membership.disabled
      );
      return active && { organizationId };
    },
    getOrgsByUserId: vi.fn(async (userId: string) => {
      return [...memberships.values()]
        .filter((membership) => membership.userId === userId)
        .map((membership) => ({
          ...orgs.get(membership.organizationId)!,
          users: [{ disabled: membership.disabled, role: membership.role }],
        }));
    }),
    updateApiKey: vi.fn(async (orgId: string) => {
      const org = orgs.get(orgId);
      if (org) org.apiKey = `key-${orgId}`;
    }),
    getUserOrg,
    createOrgAndUser: vi.fn(
      async (
        body: {
          company: string;
          email: string;
          provider: Provider;
          providerId?: string;
        },
        _ip: string,
        _userAgent: string
      ) => {
        const user: User = {
          id: `user-${body.providerId}`,
          email: body.email,
          providerName: body.provider,
          activated: body.provider !== 'LOCAL',
        };
        const org = { id: `org-${body.providerId}`, name: body.company };
        users.set(user.id, user);
        orgs.set(org.id, org);
        const membership = {
          id: `uo-${body.providerId}`,
          userId: user.id,
          organizationId: org.id,
          role: Role.SUPERADMIN,
          disabled: false,
        };
        memberships.set(membership.id, membership);
        byProvider.set(`${body.provider}:${body.providerId}`, user);
        return { id: org.id, users: [{ user }] };
      }
    ),
  };

  return { users, orgs, memberships, byProvider, userService, organizationService };
};

const startExchange = () => {
  const consumed = new Set<string>();
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const code = JSON.parse(body).auth_code as string;
      if (consumed.has(code) || code.startsWith('invalid')) {
        res.writeHead(401).end();
        return;
      }
      consumed.add(code);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ merchant_id: 'merchant-acme', merchant_name: 'Acme Ltd' }));
    });
  });
  return new Promise<{ server: Server; url: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/verify`,
      });
    });
  });
};

const world = buildWorld();

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 1000 }] })],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    SsoService,
    AuthMiddleware,
    { provide: UsersService, useValue: world.userService },
    { provide: OrganizationService, useValue: world.organizationService },
  ],
})
class MerchantSessionModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(UsersController);
  }
}

let app: INestApplication;
let exchange: Awaited<ReturnType<typeof startExchange>>;
let baseUrl = '';

beforeAll(async () => {
  exchange = await startExchange();
  vi.stubEnv('SSO_SERVER_URL', exchange.url);
  const module = await Test.createTestingModule({
    imports: [MerchantSessionModule],
  })
    .useMocker(() => ({}))
    .compile();
  app = module.createNestApplication({ logger: false });
  app.enableCors(getCorsOptions());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

beforeEach(() => {
  world.users.clear();
  world.orgs.clear();
  world.memberships.clear();
  world.byProvider.clear();
  world.organizationService.createOrgAndUser.mockClear();
});

afterAll(async () => {
  await app?.close();
  if (exchange) {
    await new Promise<void>((resolve) => {
      exchange.server.close(() => resolve());
      exchange.server.closeAllConnections();
    });
  }
  vi.unstubAllEnvs();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const postSso = (auth_code: string) =>
  post('/auth/sso', { auth_code }, { Origin: 'http://localhost:4302' });

describe('merchant SSO over HTTP', () => {
  it('creates the shared account once and reuses it on the next exchange', async () => {
    const first = await postSso('code-first');
    expect(first.status).toBe(200);
    const firstAuth = first.headers.get('auth')!;
    const firstOrg = first.headers.get('showorg')!;
    expect(JSON.parse(await first.text())).toEqual({ login: true });
    expect(AuthChecker.verifyJWT(firstAuth)).toEqual(
      expect.objectContaining({ email: 'merchant-acme@sso.merchant', providerName: 'GENERIC' })
    );

    const second = await postSso('code-second');
    expect(second.status).toBe(200);
    expect(AuthChecker.verifyJWT(second.headers.get('auth')!)).toEqual(
      expect.objectContaining({ id: AuthChecker.verifyJWT(firstAuth).id })
    );
    expect(second.headers.get('showorg')).toBe(firstOrg);
    expect(world.organizationService.createOrgAndUser).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid code without a session', async () => {
    const invalid = await postSso('invalid-code');
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('auth')).toBeNull();
    expect(invalid.headers.get('showorg')).toBeNull();
    expect(await invalid.text()).toMatch(/Invalid or expired SSO token/);
  });

  it('exposes the session headers to a cross-origin caller and allows them on requests', async () => {
    const preflight = await fetch(baseUrl + '/user/self', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:4302',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'auth,showorg,impersonate',
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:4302'
    );
    expect(preflight.headers.get('access-control-allow-headers')).toContain('auth');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('showorg');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('impersonate');

    const exchange = await postSso('code-cors');
    expect(exchange.headers.get('access-control-expose-headers')).toContain('auth');
    expect(exchange.headers.get('access-control-expose-headers')).toContain('showorg');
    expect(exchange.headers.get('access-control-expose-headers')).toContain('impersonate');
    expect(exchange.headers.get('access-control-expose-headers')).toContain('logout');
  });
});

describe('tab session and request identity over HTTP', () => {
  const merchant = () => world.byProvider.get(`${Provider.GENERIC}:merchant-acme`)!;
  const authHeader = () => AuthChecker.signJWT(merchant());

  beforeEach(async () => {
    expect((await postSso(randomUUID())).status).toBe(200);
    world.orgs.set('org-b', { id: 'org-b', name: 'Tab B' });
    world.memberships.set('uo-b', {
      id: 'uo-b',
      userId: merchant().id,
      organizationId: 'org-b',
      role: Role.USER,
      disabled: false,
    });
  });

  const self = (headers: Record<string, string>) =>
    fetch(baseUrl + '/user/self', { headers });

  it('selects the organisation sent by the tab header, independently per tab', async () => {
    const auth = authHeader();
    const home = [...world.memberships.values()].find(
      (membership) => membership.userId === merchant().id && membership.organizationId !== 'org-b'
    )!;

    const tabA = await self({ auth, showorg: home.organizationId });
    const tabB = await self({ auth, showorg: 'org-b' });

    expect((await tabA.json()).orgId).toBe(home.organizationId);
    expect((await tabB.json()).orgId).toBe('org-b');
  });

  it('falls back to the first usable membership for a foreign or missing selection', async () => {
    const auth = authHeader();

    const response = await self({ auth, showorg: 'org-not-mine' });
    const body = await response.json();

    expect(body.orgId).not.toBe('org-not-mine');
    expect(body.orgId).toBe('org-merchant-acme');
  });

  it('keeps accepting the legacy cookie when no headers are present', async () => {
    const auth = authHeader();

    const response = await self({
      cookie: `auth=${auth}; showorg=org-b`,
    });

    expect((await response.json()).orgId).toBe('org-b');
  });

  it('lets the tab header win over a stale shared cookie', async () => {
    const auth = authHeader();

    const response = await self({
      auth,
      showorg: 'org-b',
      cookie: `auth=${auth}; showorg=org-merchant-acme`,
    });

    expect((await response.json()).orgId).toBe('org-b');
  });

  it('answers an invalid identity with 401, a logout header and an expired cookie', async () => {
    const response = await self({ auth: 'not-a-session' });

    expect(response.status).toBe(401);
    expect(response.headers.get('logout')).toBe('true');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('auth=;');
    expect(cookie).toMatch(/Max-Age=(?:0|-\d+)(?:;|$)/i);
  });

  it('signals ordinary logout with the logout header', async () => {
    const response = await post('/user/logout', {}, { auth: authHeader() });

    expect(response.status).toBe(200);
    expect(response.headers.get('logout')).toBe('true');
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('switches the next request through the change-org response header', async () => {
    const auth = authHeader();

    const switched = await post(
      '/user/change-org',
      { id: 'org-b' },
      { auth, showorg: 'org-merchant-acme' }
    );
    expect(switched.headers.get('showorg')).toBe('org-b');

    const next = await self({ auth, showorg: switched.headers.get('showorg')! });
    expect((await next.json()).orgId).toBe('org-b');
  });

  it('resolves an administrator impersonation to the target account and organisation', async () => {
    world.users.set('admin-user', {
      id: 'admin-user',
      email: 'admin@ticket02.test',
      providerName: Provider.GENERIC,
      activated: true,
      isSuperAdmin: true,
    });
    world.orgs.set('org-admin', { id: 'org-admin', name: 'Admin Org' });
    world.memberships.set('uo-admin', {
      id: 'uo-admin',
      userId: 'admin-user',
      organizationId: 'org-admin',
      role: Role.SUPERADMIN,
      disabled: false,
    });
    const adminAuth = AuthChecker.signJWT(world.users.get('admin-user')!);

    const response = await self({
      auth: adminAuth,
      showorg: 'org-admin',
      impersonate: 'uo-b',
    });
    const body = await response.json();

    expect(body.id).toBe(merchant().id);
    expect(body.orgId).toBe('org-b');
    expect(body.admin).toBe(true);
    expect(body.impersonate).toBe(true);

    const start = await post(
      '/user/impersonate',
      { id: 'uo-b' },
      { auth: adminAuth, showorg: 'org-admin' }
    );
    expect(start.status).toBe(201);
    expect(start.headers.get('impersonate')).toBe('uo-b');

    const stop = await post(
      '/user/impersonate',
      { id: '' },
      { auth: adminAuth, showorg: 'org-admin', impersonate: 'uo-b' }
    );
    expect(stop.status).toBe(201);
    expect(stop.headers.get('impersonate')).toBe('');
  });
});
