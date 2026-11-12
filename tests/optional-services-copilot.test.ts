import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';

/**
 * Ticket 12: the Copilot endpoints stay an *optional* service.
 *
 * The real controller, the real authentication middleware, the real policy
 * guard and the real subscription filter run behind a real HTTP server. Only
 * persistence, the agent runtime and the CopilotKit node handler are replaced
 * at their external boundary. The assertions are on status codes, bodies and
 * what the request path did or did not construct.
 *
 * The node handler is stubbed because a configured CopilotKit request would
 * otherwise call the OpenAI API; the point here is that the handler is still
 * wired for configured deployments and never reached when the key is absent.
 */

process.env.JWT_SECRET = 'ticket-12-copilot-secret';
process.env.FRONTEND_URL = 'http://localhost:4200';

const runtime = vi.hoisted(() => ({
  nodeOptions: [] as any[],
  handled: 0,
  runtimeOptions: [] as any[],
  adapterOptions: [] as any[],
}));

vi.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: vi.fn(function (this: any, options: any) {
    runtime.runtimeOptions.push(options);
  }),
  OpenAIAdapter: vi.fn(function (this: any, options: any) {
    runtime.adapterOptions.push(options);
  }),
  copilotRuntimeNodeHttpEndpoint: vi.fn((options: any) => {
    runtime.nodeOptions.push(options);
    return (_req: any, res: any) => {
      runtime.handled++;
      // the real handler streams on its own; a 204 proves it took over the
      // response without reaching any external service
      res.status(204).end();
    };
  }),
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class MastraService {},
}));

vi.mock('@ag-ui/mastra', () => ({
  MastraAgent: {
    getLocalAgents: vi.fn(() => ({})),
  },
}));

vi.mock('@mastra/core/di', () => ({
  RequestContext: class RequestContext {
    set() {}
  },
}));

import { CopilotController } from '@gitroom/backend/api/routes/copilot.controller';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { PoliciesGuard } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import cookieParser from 'cookie-parser';

const org = {
  id: 'org-a',
  apiKey: 'api-key-a',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  users: [{ role: 'USER', disabled: false, user: { id: 'user-1' } }],
};

const user = {
  id: 'user-1',
  email: 'merchant@example.invalid',
  activated: true,
  isSuperAdmin: false,
};

const subscription = {
  getSubscriptionByOrganizationId: vi.fn(async () => ({
    subscriptionTier: 'FREE',
  })),
};

const mastraService = {
  mastra: vi.fn(async () => ({ getAgent: vi.fn() })),
};

@Module({
  controllers: [CopilotController],
  providers: [
    AuthMiddleware,
    PermissionsService,
    PoliciesGuard,
    { provide: APP_GUARD, useClass: PoliciesGuard },
    { provide: SubscriptionService, useValue: subscription },
    { provide: MastraService, useValue: mastraService },
    {
      provide: UsersService,
      useValue: { getUserById: vi.fn(async () => ({ ...user })) },
    },
    {
      provide: OrganizationService,
      useValue: {
        getOrgsByUserId: vi.fn(async () => [org]),
        updateApiKey: vi.fn(async () => 'generated-key'),
      },
    },
    { provide: PostsService, useValue: {} },
    { provide: IntegrationService, useValue: {} },
    { provide: WebhooksService, useValue: {} },
  ],
})
class CopilotBoundaryModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(CopilotController);
  }
}

let app: INestApplication;
let baseUrl: string;
let warnSpy: ReturnType<typeof vi.spyOn>;
const originalEnv = { ...process.env };

beforeAll(async () => {
  const { Test } = await import('@nestjs/testing');
  const moduleRef = await Test.createTestingModule({
    imports: [CopilotBoundaryModule],
  }).compile();

  app = moduleRef.createNestApplication({ logger: false });
  // main.ts installs the cookie parser before the auth middleware reads
  // req.cookies; the boundary app keeps that order
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(
    new SubscriptionExceptionFilter(),
    new HttpExceptionFilter()
  );
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  process.env = { ...originalEnv };
});

beforeEach(() => {
  runtime.nodeOptions.length = 0;
  runtime.runtimeOptions.length = 0;
  runtime.adapterOptions.length = 0;
  runtime.handled = 0;
  mastraService.mastra.mockClear();
  subscription.getSubscriptionByOrganizationId.mockClear();
  delete process.env.OPENAI_API_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  delete process.env.OPENAI_API_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
});

const token = () => AuthChecker.signJWT({ id: 'user-1', email: 'merchant@example.test', providerName: 'GENERIC', activated: true });

const copilot = (
  path: '/copilot/chat' | '/copilot/agent',
  { authorized = true }: { authorized?: boolean } = {}
) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { auth: token(), showorg: 'org-a' } : {}),
    },
    body: JSON.stringify({ body: { messages: [] } }),
    // an unconfigured endpoint must answer, not hang
    signal: AbortSignal.timeout(3000),
  });

describe('no OpenAI key', () => {
  it.each(['/copilot/chat', '/copilot/agent'] as const)(
    'answers %s with the established 503 JSON when the key is undefined',
    async (path) => {
      const response = await copilot(path);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'AI not configured' });
      expect(runtime.nodeOptions).toHaveLength(0);
      expect(runtime.runtimeOptions).toHaveLength(0);
      expect(runtime.adapterOptions).toHaveLength(0);
      expect(mastraService.mastra).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'OpenAI API key not set, chat functionality will not work'
      );
    }
  );

  it.each(['/copilot/chat', '/copilot/agent'] as const)(
    'answers %s with the established 503 JSON when the key is an empty string',
    async (path) => {
      process.env.OPENAI_API_KEY = '';

      const response = await copilot(path);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'AI not configured' });
      expect(runtime.nodeOptions).toHaveLength(0);
      expect(mastraService.mastra).not.toHaveBeenCalled();
    }
  );

  it.each(['/copilot/chat', '/copilot/agent'] as const)(
    'rejects an unauthenticated caller on %s before the AI check runs',
    async (path) => {
      const response = await copilot(path, { authorized: false });
      const body = await response.text();

      expect(response.status).toBe(401);
      expect(body).toBe('');
      expect(body).not.toContain('AI not configured');
      expect(response.headers.get('logout')).toBe('true');
      expect(runtime.nodeOptions).toHaveLength(0);
      expect(mastraService.mastra).not.toHaveBeenCalled();
      // the handler must not disclose the AI configuration state to a caller
      // that never reached the handler
      expect(warnSpy).not.toHaveBeenCalled();
    }
  );

  it('keeps the subscription policy ahead of the AI check on /copilot/agent', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_ticket_12';

    const response = await copilot('/copilot/agent');
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.statusCode).toBe(402);
    expect(body.url).toBe('http://localhost:4200/billing');
    expect(body.error).toBeUndefined();
    expect(runtime.nodeOptions).toHaveLength(0);
    expect(mastraService.mastra).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('OpenAI key configured', () => {
  it('keeps the upstream node handler and CORS for /copilot/chat', async () => {
    process.env.OPENAI_API_KEY = 'sk-ticket-12';

    const response = await copilot('/copilot/chat');

    expect(response.status).toBe(204);
    expect(runtime.handled).toBe(1);
    expect(runtime.nodeOptions).toHaveLength(1);
    expect(runtime.nodeOptions[0].endpoint).toBe('/copilot/chat');
    expect(runtime.nodeOptions[0].cors.origin).toContain(
      'http://localhost:4200'
    );
    expect(runtime.nodeOptions[0].cors.credentials).toBe(true);
    expect(runtime.adapterOptions).toEqual([{ model: 'gpt-4.1' }]);
    expect(mastraService.mastra).not.toHaveBeenCalled();
  });

  it('keeps the agent runtime behind the same policy when configured', async () => {
    process.env.OPENAI_API_KEY = 'sk-ticket-12';

    const response = await copilot('/copilot/agent');

    expect(response.status).toBe(204);
    expect(mastraService.mastra).toHaveBeenCalledTimes(1);
    expect(runtime.nodeOptions[0].endpoint).toBe('/copilot/agent');
    expect(runtime.adapterOptions).toEqual([{ model: 'gpt-4.1' }]);
  });
});
