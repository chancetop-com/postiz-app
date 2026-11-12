import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';

/**
 * Ticket 12: the core merchant flow does not need an optional service.
 *
 * SSO entry, the calendar range query, media upload, scheduling, editing,
 * analytics and the anonymous public preview all run through the shipped
 * controllers, the shipped auth middleware and the shipped policy guard on a
 * real HTTP server. Persistence and platform analytics are the only stubs.
 *
 * No OPENAI_API_KEY / RUNPOD_* / DEEPGRAM_* value is present for any request.
 */

process.env.JWT_SECRET = 'ticket-12-core-secret';
process.env.FRONTEND_URL = 'http://localhost:4200';

// MediaController evaluates `streamUploadOptions()` in its decorators while the
// module is being imported, so the upload directory must exist before the
// static imports below run.
const uploadRoot = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || '/tmp'}/postiz-optional-services-${process.pid}`;
  process.env.UPLOAD_DIRECTORY = root;
  process.env.STORAGE_PROVIDER = 'local';
  return root;
});

import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { PostsController } from '@gitroom/backend/api/routes/posts.controller';
import { AnalyticsController } from '@gitroom/backend/api/routes/analytics.controller';
import { MediaController } from '@gitroom/backend/api/routes/media.controller';
import { PublicController } from '@gitroom/backend/api/routes/public.controller';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { SsoService } from '@gitroom/backend/services/auth/sso.service';
import { PoliciesGuard } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { PostValidationExceptionFilter } from '@gitroom/backend/api/routes/posts.validation.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { Provider } from '@prisma/client';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ORGANIZATION_ID = 'org-1';
const org = {
  id: ORGANIZATION_ID,
  apiKey: 'api-key-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  users: [{ role: 'USER', disabled: false, user: { id: 'user-1' } }],
};

const sso = { merchantId: 'merchant-12', merchantName: 'Acme Ltd' };
let ssoUser: { id: string; email: string } | null = null;

const usersService = {
  getUserById: vi.fn(async () => ({
    id: 'user-1',
    email: 'merchant@example.invalid',
    activated: true,
    isSuperAdmin: false,
  })),
  getUserByProvider: vi.fn(async () => ssoUser),
};

const organizationService = {
  getOrgsByUserId: vi.fn(async () => [org]),
  updateApiKey: vi.fn(async () => 'generated'),
  createOrgAndUser: vi.fn(async () => {
    ssoUser = { id: 'user-sso', email: `${sso.merchantId}@sso.merchant` };
    return {
      id: 'org-sso',
      users: [{ user: ssoUser }],
    };
  }),
};

const savedMedia: any[] = [];
const mediaService = {
  saveFile: vi.fn(
    (organizationId: string, name: string, filePath: string, originalName?: string) => {
      const saved = {
        id: 'media-1',
        name,
        path: filePath,
        originalName: originalName || null,
        // local storage without a RunPod processor has nothing to normalize
        status: 'ready',
      };
      savedMedia.push({ organizationId, ...saved });
      return saved;
    },
  ),
};

const calendarPosts = [
  { id: 'post-1', state: 'QUEUE', publishDate: '2026-11-20T10:00:00.000Z' },
];

const postsService = {
  getPostsMinified: vi.fn(async () => calendarPosts),
  validatePosts: vi.fn(async () => [
    {
      identifier: 'x',
      name: 'X',
      valid: true,
      errors: true,
      emptyContent: false,
      tooLong: false,
    },
  ]),
  mapTypeToPost: vi.fn(async (body: any) => body),
  createPost: vi.fn(async () => ({ id: 'post-1', state: 'QUEUE' })),
  changeDate: vi.fn(async () => ({ id: 'post-1', state: 'QUEUE' })),
  getPostsRecursively: vi.fn(async () => [
    {
      id: 'post-1',
      content: '<p>Hello</p>',
      childrenPost: [{ id: 'child' }],
      batchId: 'batch-1',
      integration: {
        id: 'int-1',
        name: 'Acme',
        picture: 'avatar.png',
        providerIdentifier: 'x',
        profile: 'acme',
      },
    },
  ]),
};

const analytics = [{ label: 'Followers', data: [{ date: '2026-11-01', total: 10 }] }];
const integrationService = {
  checkAnalytics: vi.fn(async () => analytics),
};

const subscriptionService = {
  getSubscriptionByOrganizationId: vi.fn(async () => ({
    subscriptionTier: 'FREE',
  })),
};

const ssoService = {
  verifyToken: vi.fn(async () => sso),
};

@Module({
  // AuthController's route-level throttling guard needs the module that
  // main.ts installs; the limits themselves are not under test here
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 1000 }] })],
  controllers: [
    AuthController,
    PostsController,
    AnalyticsController,
    MediaController,
    PublicController,
  ],
  providers: [
    AuthService,
    AuthMiddleware,
    PermissionsService,
    PoliciesGuard,
    { provide: APP_GUARD, useClass: PoliciesGuard },
    { provide: SsoService, useValue: ssoService },
    { provide: EmailService, useValue: { hasProvider: () => false } },
    { provide: AuthProviderManager, useValue: {} },
    { provide: UsersService, useValue: usersService },
    { provide: OrganizationService, useValue: organizationService },
    { provide: SubscriptionService, useValue: subscriptionService },
    { provide: PostsService, useValue: postsService },
    { provide: IntegrationService, useValue: integrationService },
    { provide: WebhooksService, useValue: {} },
    { provide: MediaService, useValue: mediaService },
    { provide: AgentGraphService, useValue: {} },
    { provide: AgentGraphInsertService, useValue: { newPost: vi.fn() } },
    { provide: ShortLinkService, useValue: {} },
    { provide: TrackService, useValue: { track: vi.fn() } },
  ],
})
class CoreFlowModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // the same authenticated controller set as ApiModule; public and auth
    // routes deliberately stay outside it
    consumer
      .apply(AuthMiddleware)
      .forRoutes(PostsController, AnalyticsController, MediaController);
  }
}

const root = uploadRoot;
let app: INestApplication;
let baseUrl: string;
const optionalKeys = [
  'OPENAI_API_KEY',
  'RUNPOD_API_KEY',
  'RUNPOD_ENDPOINT_ID',
  'RUNPOD_INGEST_ENDPOINT_ID',
  'RUNPOD_CLIPPER_ENDPOINT_ID',
  'DEEPGRAM_API_KEY',
];
const originalEnv = { ...process.env };

beforeAll(async () => {
  for (const key of optionalKeys) {
    delete process.env[key];
  }
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  mkdirSync(root, { recursive: true });

  const { Test } = await import('@nestjs/testing');
  const moduleRef = await Test.createTestingModule({
    imports: [CoreFlowModule],
  }).compile();

  app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(
    new SubscriptionExceptionFilter(),
    new PostValidationExceptionFilter(),
    new HttpExceptionFilter()
  );
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  process.env = { ...originalEnv };
  rmSync(root, { recursive: true, force: true });
});

const authHeaders = () => ({
  auth: AuthChecker.signJWT({ id: 'user-1', email: 'merchant@example.test', providerName: 'GENERIC', activated: true }),
  showorg: ORGANIZATION_ID,
});

const jsonPost = (path: string, body: unknown, withAuth = true) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? authHeaders() : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });

const jsonPut = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });

describe('core flows without optional services', () => {
  it('starts with no optional service configured', () => {
    for (const key of optionalKeys) {
      expect(process.env[key]).toBeUndefined();
    }
    expect(UploadFactory.processorEnabled()).toBe(false);
  });

  it('enters through the merchant SSO entry and starts a session', async () => {
    const response = await jsonPost(
      '/auth/sso',
      { auth_code: 'merchant-code' },
      false
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ login: true });
    expect(AuthChecker.verifyJWT(response.headers.get('auth')!)).toMatchObject({
      id: 'user-sso',
    });
    expect(response.headers.get('showorg')).toBe('org-sso');
    expect(organizationService.createOrgAndUser).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Acme Ltd',
        email: 'merchant-12@sso.merchant',
        provider: Provider.GENERIC,
      }),
      'sso-auto',
      'sso-client'
    );
  });

  it('serves the calendar range through the posts API', async () => {
    const response = await fetch(
      `${baseUrl}/posts?startDate=2026-11-01T00:00:00.000Z&endDate=2026-11-30T00:00:00.000Z`,
      { headers: authHeaders(), signal: AbortSignal.timeout(3000) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(calendarPosts);
    expect(postsService.getPostsMinified).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      expect.objectContaining({
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-30T00:00:00.000Z',
      })
    );
  });

  it('uploads media with the original upload path and no processing step', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: 'image/png' }),
      'legacy.png'
    );

    const response = await fetch(`${baseUrl}/media/upload-server`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(3000),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'media-1', status: 'ready' });
    expect(savedMedia.at(-1)).toMatchObject({
      organizationId: ORGANIZATION_ID,
      originalName: 'legacy.png',
      status: 'ready',
    });
    // the upload was stored for real by the local storage provider
    expect(readdirSync(root, { recursive: true }).length).toBeGreaterThan(0);
  });

  it('submits a scheduled post through the internal posts API', async () => {
    const body = {
      type: 'schedule',
      posts: [
        {
          integration: { id: 'int-1' },
          content: 'hello',
          settings: {},
        },
      ],
    };

    const response = await jsonPost('/posts', body);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'post-1', state: 'QUEUE' });
    expect(postsService.validatePosts).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      body.posts
    );
    expect(postsService.createPost).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      body,
      'WEB'
    );
  });

  it('edits a scheduled post date', async () => {
    const response = await jsonPut('/posts/post-1/date', {
      date: '2026-11-25T12:00:00.000Z',
      action: 'schedule',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'post-1', state: 'QUEUE' });
    expect(postsService.changeDate).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      'post-1',
      '2026-11-25T12:00:00.000Z',
      'schedule',
      false
    );
  });

  it('serves analytics for a connected channel', async () => {
    const response = await fetch(`${baseUrl}/analytics/int-1?date=30`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analytics);
    expect(integrationService.checkAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORGANIZATION_ID }),
      'int-1',
      '30'
    );
  });

  it('serves the anonymous public preview with no session', async () => {
    const response = await fetch(`${baseUrl}/public/posts/post-1`, {
      signal: AbortSignal.timeout(3000),
    });

    expect(response.status).toBe(200);
    const [post] = await response.json();
    expect(post).toMatchObject({ id: 'post-1', content: '<p>Hello</p>' });
    expect(post.integration).toEqual({
      id: 'int-1',
      name: 'Acme',
      picture: 'avatar.png',
      providerIdentifier: 'x',
      profile: 'acme',
    });
    // batch links and children stay inside the dashboard
    expect(post.batchId).toBeUndefined();
    expect(post.childrenPost).toBeUndefined();
    expect(postsService.getPostsRecursively).toHaveBeenCalledWith('post-1', true);
  });
});

describe('media processing configuration gate', () => {
  const withEnv = (values: Record<string, string | undefined>, run: () => void) => {
    const saved = {
      STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
      RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
      RUNPOD_ENDPOINT_ID: process.env.RUNPOD_ENDPOINT_ID,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      run();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it('stays off for local storage even when RunPod is configured', () => {
    withEnv(
      {
        STORAGE_PROVIDER: 'local',
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: 'endpoint-id',
      },
      () => expect(UploadFactory.processorEnabled()).toBe(false)
    );
  });

  it('stays off until both RunPod values are present', () => {
    withEnv(
      {
        STORAGE_PROVIDER: 'cloudflare',
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: undefined,
      },
      () => expect(UploadFactory.processorEnabled()).toBe(false)
    );
    withEnv(
      {
        STORAGE_PROVIDER: 'cloudflare',
        RUNPOD_API_KEY: undefined,
        RUNPOD_ENDPOINT_ID: 'endpoint-id',
      },
      () => expect(UploadFactory.processorEnabled()).toBe(false)
    );
  });

  it('creates no processor while it is off', () => {
    withEnv(
      {
        STORAGE_PROVIDER: 'local',
        RUNPOD_API_KEY: undefined,
        RUNPOD_ENDPOINT_ID: undefined,
      },
      () => {
        expect(UploadFactory.processorEnabled()).toBe(false);
        expect(UploadFactory.createProcessor()).toBeNull();
      }
    );
  });

  it('turns on only for cloud storage with both RunPod values', () => {
    withEnv(
      {
        STORAGE_PROVIDER: 'cloudflare',
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: 'endpoint-id',
      },
      () => expect(UploadFactory.processorEnabled()).toBe(true)
    );
  });
});
