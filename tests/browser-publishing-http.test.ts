import { BrowserReviewController } from '@gitroom/backend/api/routes/browser-review.controller';
import { NotificationsController } from '@gitroom/backend/api/routes/notifications.controller';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import type { ReportFault } from './browser-result-fault';
import { Worker, NativeConnection } from '@temporalio/worker';
import { resolve } from 'node:path';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { InfiniteWorkflowRegister } from '@gitroom/nestjs-libraries/temporal/infinite.workflow.register';
import { TemporalService } from 'nestjs-temporal-core';
import { Connection, Client } from '@temporalio/client';
import { expandPosts } from '@gitroom/helpers/utils/posts.list.minify';
import { deliveryFixture, eventually } from './browser-delivery-fixture';
import { BrowserOccurrenceRepository } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/browser-occurrence.repository';
import { BrowserUploadController } from '@gitroom/backend/api/routes/browser-upload.controller';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostsController } from '@gitroom/backend/api/routes/posts.controller';
import { IntegrationsController } from '@gitroom/backend/api/routes/integrations.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { EncryptionService } from '@gitroom/nestjs-libraries/services/encryption.service';
import { PoliciesGuard } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { AuthService as Session } from '@gitroom/helpers/auth/auth.service';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import cookieParser from 'cookie-parser';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BrowserPublishingController } from '@gitroom/backend/api/routes/browser-publishing.controller';
import { BrowserPublishingRepository } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/browser-publishing.repository';
import { BrowserPublishingService } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/browser-publishing.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

vi.hoisted(() => {
  process.env.STORAGE_PROVIDER = 'local';
  process.env.UPLOAD_DIRECTORY = process.env.TMPDIR || '/tmp';
});

const versioned = (url: string) => expect.stringContaining(url + '#sau-media-');
const url = process.env.BROWSER_CHANNEL_TEST_DATABASE_URL;
describe.skipIf(!url)('browser publishing API', () => {
  const organizationId = randomUUID();
  const merchantId = randomUUID();
  const otherOrg = randomUUID();
  const otherMerchant = randomUUID();
  const actors: Record<string, string> = Object.fromEntries(
    ['operator', 'member', 'merchant', 'foreign', 'disabled'].map((key) => [
      key,
      randomUUID(),
    ])
  );
  let temporal: Client | undefined;
  let connection: Connection | undefined;
  let postingAllowed = true;
  const email = vi.fn();
  let interruptEmail = false;
  let db: PrismaService;
  let app: INestApplication;

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    actor = 'operator'
  ) => {
    const response = await fetch((await app.getUrl()) + path, {
      method,
      headers: {
        'content-type': 'application/json',
        auth: Session.signJWT({
          id: actors[actor],
          email: actors[actor] + '@example.test',
          providerName: ['merchant', 'foreign'].includes(actor)
            ? 'GENERIC'
            : 'LOCAL',
          activated: true,
        }),
        authorization: actor === 'foreign' ? otherOrg : organizationId,
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const ops = '/admin/browser-publishing/' + organizationId;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('JWT_SECRET', 'browser-channel-test-only');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    if (process.env.BROWSER_TRACER_SAU) {
      connection = await Connection.connect({
        address: process.env.BROWSER_TRACER_TEMPORAL,
      });
      const namespace =
        process.env.BROWSER_TRACER_NAMESPACE ||
        'browser-tracer-' + randomUUID();
      if (!process.env.BROWSER_TRACER_NAMESPACE) {
        await connection.workflowService.registerNamespace({
          namespace,
          workflowExecutionRetentionPeriod: { seconds: 86400 },
        });
        await connection.operatorService.addSearchAttributes({
          namespace,
          searchAttributes: { postId: 1, organizationId: 1 },
        });
      }
      temporal = new Client({ connection, namespace });
    }
    const module = await Test.createTestingModule({
      controllers: [
        BrowserUploadController,
        BrowserReviewController,
        NotificationsController,
        BrowserPublishingController,
        IntegrationsController,
        PostsController,
        PublicIntegrationsController,
      ],
      providers: [
        {
          provide: TemporalService,
          useValue: {
            client: {
              getRawClient: () => temporal,
              getWorkflowHandle: (id: string) =>
                temporal?.workflow.getHandle(id),
            },
          },
        },
        AuthMiddleware,
        PublicAuthMiddleware,
        UsersService,
        UsersRepository,
        OrganizationService,
        OrganizationRepository,
        PrismaService,
        PrismaRepository,
        BrowserPublishingRepository,
        BrowserOccurrenceRepository,
        BrowserPublishingService,
        IntegrationManager,
        IntegrationRepository,
        IntegrationService,
        NotificationService,
        NotificationsRepository,
        {
          provide: EmailService,
          useValue: {
            sendEmail: (...args: unknown[]) => {
              if (interruptEmail) {
                interruptEmail = false;
                throw new Error('Mail queue unavailable');
              }
              return email(...args);
            },
          },
        },
        PostActivity,
        PostsService,
        PostsRepository,
        EncryptionService,
        { provide: APP_GUARD, useClass: PoliciesGuard },
        {
          provide: PermissionsService,
          useValue: { check: () => ({ can: () => postingAllowed }) },
        },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    db = module.get(PrismaService);
    for (const [id, ssoId, userId] of [
      [organizationId, merchantId, actors.merchant],
      [otherOrg, otherMerchant, actors.foreign],
    ]) {
      await db.organization.create({
        data: {
          id,
          apiKey: id,
          name: 'Merchant workspace',
          users: {
            create: {
              role: 'SUPERADMIN',
              user: {
                create: {
                  id: userId,
                  providerName: 'GENERIC',
                  email: ssoId + '@sso.merchant',
                  providerId: ssoId,
                  timezone: 0,
                },
              },
            },
          },
        },
      });
    }
    for (const actor of ['operator', 'member', 'disabled']) {
      await db.user.create({
        data: {
          id: actors[actor],
          activated: true,
          sendFailureEmails: actor !== 'member',
          providerName: 'LOCAL',
          email: actors[actor] + '@example.test',
          timezone: 0,
          isSuperAdmin: actor === 'operator',
          organizations: {
            create: {
              organizationId,
              role: 'USER',
              disabled: actor === 'disabled',
            },
          },
        },
      });
    }
    app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    const dashboardAuth = module.get(AuthMiddleware);
    const publicAuth = module.get(PublicAuthMiddleware);
    app.use((req: any, res: any, next: any) =>
      req.path.startsWith('/internal/')
        ? next()
        : (req.path.startsWith('/public/v1/') ? publicAuth : dashboardAuth)
            .use(req, res, next)
            .catch(next)
    );
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    if (db) {
      const tenants = { in: [organizationId, otherOrg] };
      await db.post.deleteMany({ where: { organizationId: tenants } });
      await db.media.deleteMany({ where: { organizationId: tenants } });
      await db.integration.deleteMany({ where: { organizationId: tenants } });
      await db.userOrganization.deleteMany({
        where: { organizationId: tenants },
      });
      await db.notifications.deleteMany({ where: { organizationId: tenants } });
      await db.organization.deleteMany({ where: { id: tenants } });
      await db.user.deleteMany({
        where: { id: { in: Object.values(actors) } },
      });
    }
    await connection?.close();
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('only platform operations can enable the organization matched to the SSO merchant', async () => {
    expect(
      (await request('PUT', ops, { merchantId, enabled: true }, 'member'))
        .status
    ).toBe(403);
    expect(
      (
        await request('PUT', ops, {
          merchantId: 'different-merchant',
          enabled: true,
        })
      ).status
    ).toBe(404);
    expect(await request('PUT', ops, { merchantId, enabled: true })).toEqual({
      status: 200,
      body: { organizationId, merchantId, enabled: true },
    });
  });

  it('binds and unbinds a whole profile, preserving the channel IDs through a rename', async () => {
    const profile = {
      provider: 'bitbrowser',
      profileId: 'w-123',
      name: 'Brand',
      platforms: ['tiktok', 'xiaohongshu', 'rednote', 'instagram'],
    };
    await request('PUT', ops, { merchantId, enabled: false });
    expect((await request('PUT', ops + '/bindings', profile)).status).toBe(403);
    await request('PUT', ops, { merchantId, enabled: true });
    const bound = await request('PUT', ops + '/bindings', profile);
    expect(bound.status).toBe(200);
    expect(bound.body.channels.map((c: any) => c.name).sort()).toEqual([
      'Brand · Instagram',
      'Brand · Rednote',
      'Brand · TikTok',
      'Brand · Xiaohongshu',
    ]);
    const renamed = await request('PUT', ops + '/bindings', {
      ...profile,
      name: 'Studio',
    });
    expect(renamed.body.id).toBe(bound.body.id);
    expect(renamed.body.channels.map((c: any) => c.id).sort()).toEqual(
      bound.body.channels.map((c: any) => c.id).sort()
    );
    expect(renamed.body.channels.map((c: any) => c.name)).toContain(
      'Studio · Rednote'
    );
    const second = await request('PUT', ops + '/bindings', {
      ...profile,
      provider: 'adspower',
    });
    expect(second.status).toBe(200);
    expect(second.body.id).not.toBe(bound.body.id);
    expect(
      (await request('DELETE', ops + '/bindings/' + bound.body.id)).body
    ).toEqual({ id: bound.body.id, active: false });
  });

  it('lists the bound channels alongside official accounts only while discovery is enabled', async () => {
    const official = await db.integration.create({
      data: {
        organizationId,
        internalId: 'official',
        name: 'Official',
        providerIdentifier: 'x',
        type: 'social',
        token: '',
      },
    });
    const profile = {
      provider: 'bitbrowser',
      profileId: 'w-discovery',
      name: 'Brand',
      platforms: ['tiktok'],
    };
    await request('PUT', ops, { merchantId, enabled: true });
    await request('PUT', ops + '/bindings', profile);
    vi.stubEnv('BROWSER_PUBLISHING_DISCOVERY', 'false');
    expect(
      (await request('GET', '/integrations/list')).body.integrations.map(
        (c: any) => c.id
      )
    ).toEqual([official.id]);
    vi.stubEnv('BROWSER_PUBLISHING_DISCOVERY', 'true');
    for (const actor of ['merchant', 'member']) {
      const { status, body } = await request(
        'GET',
        '/integrations/list',
        undefined,
        actor
      );
      expect(status).toBe(200);
      expect(body.integrations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Brand · TikTok',
            identifier: 'browser-tiktok',
            browserPublishing: true,
          }),
          expect.objectContaining({ id: official.id }),
        ])
      );
    }
  });

  it('accepts incomplete browser drafts through both posting APIs and rejects unassigned targets before saving siblings', async () => {
    const profile = {
      provider: 'bitbrowser',
      profileId: 'same-window',
      name: 'Shared',
      platforms: ['tiktok'],
    };
    const otherOps = '/admin/browser-publishing/' + otherOrg;
    await request('PUT', ops, { merchantId, enabled: true });
    await request('PUT', otherOps, {
      merchantId: otherMerchant,
      enabled: true,
    });
    const local = (await request('PUT', ops + '/bindings', profile)).body;
    const foreign = (await request('PUT', otherOps + '/bindings', profile))
      .body;
    expect(local.id).not.toBe(foreign.id);
    const post = (id: string, bindingId: string, content = '') => ({
      integration: { id, bindingId },
      settings: { __type: 'x' },
      value: [{ content, image: [] }],
    });
    const payload = (posts: unknown[]) => ({
      type: 'draft',
      tags: [],
      shortLink: false,
      date: new Date().toISOString(),
      posts,
    });
    vi.stubEnv('BROWSER_PUBLISHING_DISCOVERY', 'false');
    for (const [path, actor] of [
      ['/posts', 'member'],
      ['/public/v1/posts', 'merchant'],
    ]) {
      const selected = post(local.channels[0].id, local.id);
      const saved = await request('POST', path, payload([selected]), actor);
      expect(saved, JSON.stringify(saved)).toMatchObject({
        status: 201,
        body: [
          { postId: expect.any(String), integration: local.channels[0].id },
        ],
      });
      expect(
        (
          await request(
            'PUT',
            '/public/v1/posts/' + saved.body[0].postId + '/status',
            { status: 'schedule' }
          )
        ).status
      ).toBe(400);
      const before = await db.post.count({ where: { organizationId } });
      for (const invalid of [
        post(foreign.channels[0].id, foreign.id),
        post(local.channels[0].id, foreign.id),
      ]) {
        expect(
          (await request('POST', path, payload([selected, invalid]), actor))
            .status
        ).toBe(400);
      }
      postingAllowed = false;
      try {
        expect(
          (await request('POST', path, payload([selected]), actor)).status
        ).toBe(402);
      } finally {
        postingAllowed = true;
      }
      await request('PUT', ops, { merchantId, enabled: false });
      expect(
        (await request('POST', path, payload([selected]), actor)).status
      ).toBe(400);
      await request('PUT', ops, { merchantId, enabled: true });
      expect(await db.post.count({ where: { organizationId } })).toBe(before);
    }
    expect(
      (await request('DELETE', ops + '/bindings/' + foreign.id)).status
    ).toBe(404);
    await request('DELETE', ops + '/bindings/' + local.id);
    expect(
      (
        await request(
          'POST',
          '/posts',
          payload([post(local.channels[0].id, local.id, 'Draft')]),
          'member'
        )
      ).status
    ).toBe(400);
  });

  it('reopens shared media and account overrides on the originally selected TikTok profiles', async () => {
    await request('PUT', ops, { merchantId, enabled: true });
    const bind = (name: string, profileId: string) =>
      request('PUT', ops + '/bindings', {
        provider: 'bitbrowser',
        profileId,
        name,
        platforms: ['tiktok'],
      });
    const profileId = randomUUID();
    const first = (await bind('Studio', profileId)).body.channels[0];
    const second = (await bind('Shop', randomUUID())).body.channels[0];
    const clip = await db.media.create({
      data: {
        organizationId,
        name: 'shared.mp4',
        type: 'video',
        path: 'https://media.example.test/shared.mp4',
      },
    });
    const image = [{ id: clip.id, path: clip.path }];
    const shared = [{ content: 'Shared caption', image, delay: 0 }];
    const date = new Date(Date.now() + 3600_000).toISOString();
    const posts = [
      {
        integration: { id: first.id },
        settings: {},
        value: shared,
        draftEditor: { overridesShared: false, shared },
      },
      {
        integration: { id: second.id },
        settings: { privacy: 'friends' },
        value: [{ content: 'Shop caption', image }],
        draftEditor: { overridesShared: true, shared },
      },
    ];
    const saved = await request(
      'POST',
      '/posts',
      { type: 'draft', posts, date, tags: [], shortLink: false },
      'member'
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect((await bind('Renamed Studio', profileId)).body.channels[0].id).toBe(
      first.id
    );
    const { group } = (await request('GET', '/posts/' + saved.body[0].postId))
      .body;
    const editor = (await request('GET', '/posts/group/' + group)).body;
    expect(editor).toMatchObject({
      integration: first.id,
      draftEditor: { overridesShared: false, shared },
      posts: [
        {
          id: saved.body[0].postId,
          content: 'Shared caption',
          image: [{ id: clip.id }],
          integration: { name: 'Renamed Studio · TikTok' },
        },
      ],
      siblings: [
        {
          integration: second.id,
          settings: { privacy: 'friends' },
          draftEditor: { overridesShared: true, shared },
          posts: [
            {
              id: saved.body[1].postId,
              content: 'Shop caption',
              image: [{ id: clip.id }],
            },
          ],
        },
      ],
    });
    for (const path of ['/posts', '/public/v1/posts']) {
      for (const type of ['now', 'schedule']) {
        const result = await request(
          'POST',
          path,
          {
            type,
            date,
            tags: [],
            shortLink: false,
            posts: [posts[0], { ...posts[1], settings: { noPublish: true } }],
          },
          'merchant'
        );
        expect(result.status).toBe(400);
        expect(JSON.stringify(result.body)).toContain(second.name);
      }
    }
    const empty = await request(
      'POST',
      '/public/v1/posts',
      {
        type: 'now',
        date,
        tags: [],
        shortLink: false,
        posts: [posts[0], { ...posts[1], value: [{ content: '', image: [] }] }],
      },
      'merchant'
    );
    expect(empty.status).toBe(400);
    expect(JSON.stringify(empty.body)).toContain(second.name);
    const unknownAction = await request(
      'POST',
      '/public/v1/posts',
      {
        type: 'publish',
        date,
        tags: [],
        shortLink: false,
        posts,
      },
      'merchant'
    );
    expect(unknownAction.status).toBe(400);
    const repeated = await request(
      'POST',
      '/posts',
      {
        type: 'now',
        date,
        tags: [],
        shortLink: false,
        posts: posts.map((post) => ({
          ...post,
          settings: {},
          value: [{ ...post.value[0], id: saved.body[0].postId }],
        })),
      },
      'member'
    );
    expect(repeated.status).toBe(400);
    expect(
      await db.post.count({
        where: { organizationId, integrationId: { in: [first.id, second.id] } },
      })
    ).toBe(2);
  });

  it('rejects every schedule and publish-now sibling when the final account references a foreign post', async () => {
    await request('PUT', ops, { merchantId, enabled: true });
    const bind = async (name: string) =>
      (
        await request('PUT', ops + '/bindings', {
          provider: 'bitbrowser',
          profileId: randomUUID(),
          name,
          platforms: ['tiktok'],
        })
      ).body.channels[0];
    const [first, second] = await Promise.all([bind('One'), bind('Two')]);
    const video = await db.media.create({
      data: {
        organizationId,
        name: 'batch.mp4',
        type: 'video',
        path: 'https://media.example.test/batch.mp4',
      },
    });
    const foreignIntegration = await db.integration.create({
      data: {
        organizationId: otherOrg,
        internalId: randomUUID(),
        name: 'Foreign',
        providerIdentifier: 'x',
        type: 'social',
        token: '',
      },
    });
    const foreign = await db.post.create({
      data: {
        organizationId: otherOrg,
        integrationId: foreignIntegration.id,
        group: randomUUID(),
        state: 'DRAFT',
        publishDate: new Date(),
        content: 'Private draft',
      },
    });
    const date = new Date().toISOString();
    const posts = [first, second].map((channel, index) => ({
      integration: { id: channel.id },
      settings: {},
      value: [
        {
          ...(index === 1 ? { id: foreign.id } : {}),
          content: 'Shared campaign',
          image: [{ id: video.id, path: video.path }],
        },
      ],
    }));
    const count = () => db.post.count({ where: { organizationId } });
    const before = await count();
    const starts = temporal && vi.spyOn(temporal.workflow, 'start');
    try {
      for (const path of ['/posts', '/public/v1/posts']) {
        for (const type of ['schedule', 'now']) {
          const response = await request(
            'POST',
            path,
            { type, date, posts, tags: [], shortLink: false },
            'merchant'
          );
          expect(response.status).toBe(404);
          expect(await count()).toBe(before);
          expect(response.body.message).toContain(second.name);
        }
      }
      if (starts) expect(starts).not.toHaveBeenCalled();
    } finally {
      starts?.mockRestore();
    }
  });

  it('validates Rednote and Xiaohongshu declarations on the selected channel before scheduling', async () => {
    await request('PUT', ops, { merchantId, enabled: true });
    const binding = (
      await request('PUT', ops + '/bindings', {
        provider: 'bitbrowser',
        profileId: 'regional-fixture',
        name: 'Regional',
        platforms: ['rednote', 'xiaohongshu'],
      })
    ).body;
    const photo = await db.media.create({
      data: {
        organizationId,
        name: 'one.jpg',
        path: '/one.jpg',
        type: 'image',
      },
    });
    for (const channel of binding.channels) {
      const validate = async (settings: object) => {
        const response = await request('POST', '/posts/valid', {
          posts: [
            {
              integration: { id: channel.id },
              settings,
              value: [
                {
                  content: 'Photo body',
                  image: [{ id: photo.id, path: photo.path }],
                },
              ],
            },
          ],
        });
        expect(response.status).toBe(201);
        expect(response.body[0].id).toBe(channel.id);
        return response.body[0];
      };
      for (const invalid of [
        {},
        { title: '   ' },
        { title: 'two\nlines' },
        { title: 'two\tcolumns' },
        { title: 'A', location: ' ' },
        { title: 'A', contentType: 'other' },
        { title: 'A', contentType: ['ai', 'fiction'] },
        { title: 'A', original: 'true' },
        { title: 'A', contentType: 'repost' },
        { title: 'A', repostSource: 'News' },
        {
          title: 'A',
          contentType: 'repost',
          repostSource: 'News',
          original: true,
        },
        {
          title: 'A',
          contentType: 'repost',
          repostSource: 'News',
          original: false,
        },
        { title: 'A', contentType: 'self-shot', shootLocation: 'Garden' },
        {
          title: 'A',
          contentType: 'self-shot',
          shootLocation: 'Garden',
          shootDate: '2025-02-29',
        },
        {
          title: 'A',
          contentType: 'self-shot',
          shootLocation: 'Garden',
          shootDate: '2024-02-29',
          original: false,
        },
        { title: 'A', contentType: 'ai', shootDate: '2024-02-29' },
        { title: 'A', privacy: 'public' },
      ]) {
        const result = await validate(invalid);
        expect(
          result.valid && result.errors === true,
          JSON.stringify(invalid)
        ).toBe(false);
      }
      for (const extra of [
        {},
        { original: false },
        { contentType: 'ai', location: 'Shanghai' },
        { contentType: 'marketing' },
        { contentType: 'fiction', original: true },
        { contentType: 'repost', repostSource: 'News' },
        {
          contentType: 'self-shot',
          shootLocation: 'Garden',
          shootDate: '2024-02-29',
          original: true,
        },
      ]) {
        expect(await validate({ title: 'One title', ...extra })).toMatchObject({
          valid: true,
          errors: true,
        });
      }
    }
  });

  it('accepts a saved Azure video cover only under the organization’s upload prefix', async () => {
    await request('PUT', ops, { merchantId, enabled: true });
    const binding = (
      await request('PUT', ops + '/bindings', {
        name: 'Cover fixture',
        platforms: ['rednote'],
        provider: 'bitbrowser',
        profileId: 'azure-cover-fixture',
      })
    ).body;
    const channel = binding.channels[0];
    const root = 'https://assets.example.test/library/uploads/';
    const path = root + organizationId + '/cover.jpg';
    const clip = await db.media.create({
      data: {
        organizationId,
        path: root + organizationId + '/clip.mp4',
        thumbnail: path,
        type: 'video',
        name: 'clip.mp4',
      },
    });
    vi.stubEnv('STORAGE_PROVIDER', 'azure');
    vi.stubEnv(
      'AZURE_CONNECTIONURL',
      'DefaultEndpointsProtocol=https;AccountName=fixture;AccountKey=' +
        Buffer.from('fixture').toString('base64') +
        ';BlobEndpoint=https://assets.example.test'
    );
    vi.stubEnv('AZURE_CONTAINER', 'library');
    vi.stubEnv('AZURE_BASEPATH', 'uploads');
    const validate = async (thumbnail: string) =>
      (
        await request('POST', '/posts/valid', {
          posts: [
            {
              integration: { id: channel.id },
              settings: { title: 'Video' },
              value: [
                {
                  content: '',
                  image: [{ id: clip.id, path: clip.path, thumbnail }],
                },
              ],
            },
          ],
        })
      ).body[0];
    try {
      expect(await validate(path)).toMatchObject({ valid: true, errors: true });
      expect(
        (await validate(root + organizationId + '/unattached.jpg')).errors
      ).toMatch(/cover/i);
      for (const outside of [
        root + otherOrg + '/another.jpg',
        'https://other.example.test/unrelated.jpg',
      ]) {
        await db.media.update({
          where: { id: clip.id },
          data: { thumbnail: outside },
        });
        expect((await validate(outside)).errors).toMatch(/cover/i);
      }
    } finally {
      vi.stubEnv('STORAGE_PROVIDER', 'local');
    }
  });

  it('reports TikTok and Instagram option errors on the selected channel before scheduling', async () => {
    await request('PUT', ops, { merchantId, enabled: true });
    const binding = (
      await request('PUT', ops + '/bindings', {
        provider: 'bitbrowser',
        profileId: 'option-validation',
        name: 'Option validation',
        platforms: ['tiktok', 'instagram'],
      })
    ).body;
    const image = await db.media.create({
      data: {
        organizationId,
        type: 'image',
        name: 'image.png',
        path: 'https://media.example.test/options33.png?signature=end.mp4',
      },
    });
    const video = await db.media.create({
      data: {
        organizationId,
        type: 'video',
        name: 'video.mp4',
        path: 'https://media.example.test/options33.mp4',
      },
    });
    const samples: [
      string,
      typeof image,
      Record<string, unknown>,
      string,
      RegExp
    ][] = [
      ['Instagram', image, {}, 'Body', /title/i],
      [
        'Instagram',
        image,
        { title: 'T', collaborators: ['@Alice', 'alice'] },
        'Body',
        /collaborator/i,
      ],
      [
        'Instagram',
        image,
        { title: 'T', altText: ['one', 'orphan'] },
        'Body',
        /alt text/i,
      ],
      [
        'Instagram',
        video,
        { title: 'T', altText: ['orphan'] },
        'Body',
        /alt text|option/i,
      ],
      ['Instagram', video, { title: 'T' }, '🙂'.repeat(2198), /2,?200/],
      ['TikTok', image, { title: 'one\ntwo' }, '', /title/i],
      [
        'TikTok',
        image,
        { brandedContent: true, privacy: 'only-me' },
        '',
        /privacy|only me|only-me/i,
      ],
      ['TikTok', image, { disableReuse: true }, '', /reuse|option/i],
      ['TikTok', image, {}, 'A'.repeat(4001), /4,?000/],
    ];
    const igId = binding.channels.find((c: any) =>
      c.name.endsWith('Instagram')
    ).id;
    const mediaDefaults = async (
      texts: string[],
      overrides: Record<string, unknown> = {}
    ) => {
      const response = await request(
        'POST',
        '/posts/valid',
        {
          posts: [
            {
              integration: { id: igId },
              settings: { title: 'Photo', ...overrides },
              value: [
                {
                  content: '',
                  image: texts.map((alt) => ({
                    id: image.id,
                    path: image.path,
                    alt,
                  })),
                },
              ],
            },
          ],
        },
        'member'
      );
      return response.body[0];
    };
    expect((await mediaDefaults(['First', ''])).errors).toMatch(/alt text/i);
    expect((await mediaDefaults(['First', 'Second'])).errors).toBe(true);
    expect(
      (
        await mediaDefaults(['First', ''], {
          altText: ['Channel first', 'Channel second'],
        })
      ).errors
    ).toBe(true);
    for (const [platform, media, settings, content, message] of samples) {
      const channel = binding.channels.find((c: any) =>
        c.name.endsWith(platform)
      );
      const result = await request(
        'POST',
        '/posts/valid',
        {
          posts: [
            {
              integration: { id: channel.id },
              settings,
              value: [{ content, image: [{ id: media.id, path: media.path }] }],
            },
          ],
        },
        'member'
      );
      expect(result.status).toBe(201);
      expect(result.body[0]).toMatchObject({
        id: channel.id,
        name: channel.name,
      });
      expect(
        [result.body[0].settingsError, result.body[0].errors].join(' ')
      ).toMatch(message);
    }
  });

  async function withDelivery(
    run: (
      fixture: Awaited<ReturnType<typeof deliveryFixture>>,
      orchestration: { stop: () => Promise<void>; start: () => Promise<void> }
    ) => Promise<void>,
    fault?: ReportFault
  ) {
    vi.stubEnv('BROWSER_RESULT_QUERY_WAIT_SECONDS', '1');
    const fixture = await deliveryFixture(await app.getUrl(), fault);
    const activity = app.get(PostActivity);
    const native = await NativeConnection.connect({
      address: process.env.BROWSER_TRACER_TEMPORAL,
    });
    const launch = () =>
      Worker.create({
        connection: native,
        namespace: temporal!.options.namespace,
        taskQueue: 'main',
        workflowsPath: resolve('tests/browser-recovery-workflows.ts'),
        activities: {
          searchForMissingThreeHoursPosts:
            activity.searchForMissingThreeHoursPosts.bind(activity),
          browserSchedule: activity.browserSchedule.bind(activity),
          browserTiming: activity.browserTiming.bind(activity),
          browserPrepare: activity.browserPrepare.bind(activity),
          browserHandoff: activity.browserHandoff.bind(activity),
          checkPostStatus: activity.checkPostStatus.bind(activity),
          browserNextOccurrence: activity.browserNextOccurrence.bind(activity),
        },
      });
    let worker: Worker | undefined;
    let running: Promise<void> | undefined;
    const start = async () => {
      worker = await launch();
      running = worker.run();
    };
    const stop = async () => {
      if (worker) {
        worker.shutdown();
        await running;
        worker = undefined;
      }
    };
    await start();
    vi.stubEnv(
      'SAU_GATEWAY_URL',
      fault === 'gateway-offline' ? fixture.boundary!.url : fixture.gateway
    );
    vi.stubEnv('GATEWAY_INTERNAL_TOKEN', fixture.token);
    try {
      await run(fixture, { stop, start });
    } finally {
      await stop();
      await native.close();
      await fixture.stop();
    }
  }

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'publishes TikTok and Instagram drafts through their bound CLI actions and keeps late processing subordinate to the final receipt',
    () =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            provider: 'bitbrowser',
            profileId: fixture.alias,
            name: 'Draft trace',
            platforms: ['tiktok', 'instagram'],
          })
        ).body;
        const files = await Promise.all(
          ['b33.jpg', 'a33.png', 'clip33.mp4'].map((name) =>
            db.media.create({
              data: {
                organizationId,
                name,
                path: 'https://example.test/' + name,
                type: name.endsWith('.mp4') ? 'video' : 'image',
              },
            })
          )
        );
        const [b, a, clip] = files.map(({ id, path }) => ({ id, path }));
        await fixture.unknownInstagramVideo();
        const date = new Date().toISOString();
        const cards = async () =>
          expandPosts(
            (
              await request(
                'GET',
                '/posts?startDate=' +
                  date.slice(0, 10) +
                  'T00:00:00Z&endDate=' +
                  date.slice(0, 10) +
                  'T23:59:59Z'
              )
            ).body
          ).posts;
        const cases = [
          {
            platform: 'instagram',
            action: 'upload-note',
            settings: {
              title: '-Photo',
              collaborators: ['@Alice', 'Bob'],
              altText: ['B', 'A', 'B again'],
              aiGenerated: false,
            },
            flags: [
              '--title=-Photo',
              '--collaborator=alice',
              '--collaborator=bob',
              '--no-ai-generated',
              '--alt-text=B',
              '--alt-text=A',
              '--alt-text=B again',
            ],
          },
          {
            platform: 'tiktok',
            action: 'upload-video',
            settings: {
              privacy: 'friends',
              aigc: false,
              yourBrand: true,
              disableReuse: true,
            },
            flags: [
              '--privacy=friends',
              '--your-brand',
              '--no-aigc',
              '--disable-reuse',
            ],
          },
          {
            platform: 'tiktok',
            action: 'upload-note',
            settings: {
              title: 'Photo title',
              privacy: 'public',
              brandedContent: true,
            },
            flags: [
              '--title=Photo title',
              '--privacy=public',
              '--branded-content',
            ],
          },
          {
            platform: 'instagram',
            action: 'upload-video',
            settings: {
              title: 'Reel',
              noComments: true,
              location: 'Park',
              aiGenerated: true,
            },
            flags: [
              '--title=Reel',
              '--no-comments',
              '--location=Park',
              '--ai-generated',
            ],
          },
        ];
        for (const [
          index,
          { platform, action, settings, flags },
        ] of cases.entries()) {
          const channel = binding.channels.find(
            (c: any) => c.providerIdentifier === 'browser-' + platform
          );
          const caption = '-caption ' + platform + '\n#标题';
          const video = action === 'upload-video';
          const selected = video ? [{ ...clip, thumbnail: a.path }] : [b, a, b];
          const draft = await request(
            'POST',
            '/posts',
            {
              type: 'draft',
              date,
              shortLink: false,
              tags: [],
              posts: [
                {
                  integration: { id: channel.id },
                  settings,
                  value: [{ content: caption, image: selected }],
                },
              ],
            },
            'member'
          );
          expect(draft.status, JSON.stringify(draft.body)).toBe(201);
          const id = draft.body[0].postId;
          const get = async () => (await request('GET', '/posts/' + id)).body;
          const saved = await get();
          expect(saved.settings).toMatchObject(settings);
          expect(saved.posts[0].state).toBe('DRAFT');
          const schedule = await request(
            'PUT',
            '/public/v1/posts/' + id + '/status',
            { status: 'schedule' },
            'merchant'
          );
          expect(schedule.status, JSON.stringify(schedule.body)).toBe(200);
          const wf = (await get()).posts[0].browserWorkflowId;
          const status = async () =>
            (await fixture.api('/internal/occurrences/' + wf)).data;
          if (!index) {
            fixture.startDesktop();
            await eventually(
              async () => (await status()).receipt?.outcome === 'processing'
            );
            expect(
              (await cards()).find((card: any) => card.id === id)
            ).toMatchObject({ browserStatus: 'publishing' });
            await fixture.release();
          }
          const uncertain = platform === 'instagram' && video;
          const outcome = uncertain ? 'unknown' : 'published';
          await eventually(
            async () => (await status()).receipt?.outcome === outcome
          );
          const final = await status();
          expect(final.task).toMatchObject({
            workflowId: wf,
            postId: id,
            channelId: channel.id,
            bindingId: binding.id,
            platform,
            action,
            settings,
            caption,
            media: video
              ? [
                  { id: clip.id, url: versioned(clip.path), role: 'video' },
                  { id: a.id, url: versioned(a.path), role: 'cover' },
                ]
              : [b, a, b].map((x) => ({
                  id: x.id,
                  url: versioned(x.path),
                  role: 'image',
                })),
          });
          if (platform === 'instagram') {
            expect(final.receipt).toMatchObject(
              uncertain
                ? { exitCode: 9 }
                : {
                    releaseId: 'SC_33',
                    url: 'https://www.instagram.com/p/SC_33/',
                  }
            );
            const late = await fixture.api(
              '/publish-task/result',
              {
                workflowId: wf,
                sessionId: final.sessionId,
                receipt: {
                  outcome: 'processing',
                  cliInvoked: true,
                  exitCode: null,
                },
              },
              true
            );
            expect(late.data.receipt).toEqual(final.receipt);
          } else expect(final.receipt.releaseId).toBeUndefined();
          const args = (await fixture.calls()).find(
            (call) => call[0] === platform && call[1] === action
          )!;
          expect(args).toEqual(
            expect.arrayContaining([
              ...flags,
              '--profile-id=' + fixture.alias,
              '--' +
                (video ? (platform === 'tiktok' ? 'title' : 'desc') : 'note') +
                '=' +
                caption,
            ])
          );
          if (video)
            expect(args).toEqual(
              expect.arrayContaining([
                versioned('--file=' + clip.path),
                versioned('--thumbnail=' + a.path),
              ])
            );
          else
            expect(args.slice(2, 6)).toEqual([
              '--images',
              versioned(b.path),
              versioned(a.path),
              versioned(b.path),
            ]);
          await eventually(
            async () =>
              (await cards()).find((card: any) => card.id === id)
                ?.browserStatus === (uncertain ? 'needs_review' : 'published')
          );
        }
        expect(
          (await fixture.calls()).filter((call) =>
            ['upload-note', 'upload-video'].includes(call[1])
          )
        ).toHaveLength(4);
      }),
    120000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'publishes each regional video and photo occurrence on its selected channel without a work ID',
    () =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            name: 'Regional',
            platforms: ['rednote', 'xiaohongshu'],
            provider: 'bitbrowser',
            profileId: fixture.alias,
          })
        ).body;
        const media = await Promise.all(
          ['clip.mp4', 'first.jpg', 'second.jpg'].map((name) =>
            db.media.create({
              data: {
                name,
                path: 'https://media.example.test/' + name,
                type: name.endsWith('mp4') ? 'video' : 'image',
                organizationId,
              },
            })
          )
        );
        const [clip, first, second] = media.map(({ id, path }) => ({
          id,
          path,
        }));
        // The media settings editor stores a thumbnail-only upload on its video, outside the library.
        vi.stubEnv('FRONTEND_URL', 'https://postiz.example.test');
        const editorCover = 'https://postiz.example.test/uploads/2026/11/27/cover.jpg';
        await db.media.update({
          where: { id: clip.id },
          data: { thumbnail: editorCover },
        });
        const date = new Date().toISOString();
        const expected = [];
        for (const platform of ['rednote', 'xiaohongshu']) {
          const channel = binding.channels.find(
            (c: any) => c.providerIdentifier === 'browser-' + platform
          );
          const cover =
            platform === 'rednote' ? { id: clip.id, path: editorCover } : first;
          for (const video of [true, false]) {
            const title = '-' + platform + (video ? ' video' : ' photos');
            const caption = 'Line one\n#话题';
            const settings = video
              ? {
                  title,
                  location: 'Post city',
                  original: false,
                  contentType: 'fiction',
                }
              : { title, contentType: 'repost', repostSource: '-Agency' };
            const response = await request(
              'POST',
              '/posts',
              {
                type: 'now',
                date,
                tags: [],
                shortLink: false,
                posts: [
                  {
                    integration: { id: channel.id },
                    settings,
                    value: [
                      {
                        content: caption,
                        image: video
                          ? [{ ...clip, thumbnail: cover.path }]
                          : [second, first, second],
                      },
                    ],
                  },
                ],
              },
              'member'
            );
            expect(response.status, JSON.stringify(response.body)).toBe(201);
            const id = response.body[0].postId;
            const post = (await request('GET', '/posts/' + id)).body.posts[0];
            expected.push({
              cover,
              platform,
              title,
              caption,
              settings,
              video,
              id,
              channelId: channel.id,
              wf: post.browserWorkflowId,
            });
          }
        }
        fixture.startDesktop();
        await fixture.release();
        const cards = async () =>
          expandPosts(
            (
              await request(
                'GET',
                '/posts?startDate=' +
                  date.slice(0, 10) +
                  'T00:00:00Z&endDate=' +
                  date.slice(0, 10) +
                  'T23:59:59Z'
              )
            ).body
          ).posts;
        for (const entry of expected) {
          const cover = entry.cover;
          const {
            platform,
            title,
            caption,
            settings,
            video,
            id,
            channelId,
            wf,
          } = entry;
          const action = video ? 'upload-video' : 'upload-note';
          const lookup = () => fixture.api('/internal/occurrences/' + wf);
          await eventually(async () => (await lookup()).status === 200, 12000);
          const record = (await lookup()).data;
          expect(record.task).toMatchObject({
            platform,
            action,
            settings,
            requiredCapability: platform + '.' + action,
            channelId,
            caption,
            postId: id,
            workflowId: wf,
            bindingId: binding.id,
            provider: 'bitbrowser',
            profileId: fixture.alias,
            media: video
              ? [
                  { id: clip.id, url: versioned(clip.path), role: 'video' },
                  { id: cover.id, url: versioned(cover.path), role: 'cover' },
                ]
              : [second, first, second].map((x) => ({
                  id: x.id,
                  url: versioned(x.path),
                  role: 'image',
                })),
          });
          await eventually(
            async () => (await lookup()).data.receipt?.outcome === 'published'
          );
          const args = (await fixture.calls()).find((row) =>
            row.includes('--title=' + title)
          )!;
          expect(args.slice(0, 2)).toEqual([platform, action]);
          expect(args).toEqual(
            expect.arrayContaining([
              '--profile-id=' + fixture.alias,
              (video ? '--desc=' : '--note=') + caption,
              ...(video
                ? [
                    versioned('--file=' + clip.path),
                    versioned('--thumbnail=' + cover.path),
                    '--location=Post city',
                    '--no-original',
                    '--content-type=fiction',
                  ]
                : ['--repost-source=-Agency', '--content-type=repost']),
            ])
          );
          if (!video)
            expect(
              args.slice(
                args.indexOf('--images') + 1,
                args.indexOf('--images') + 4
              )
            ).toEqual([versioned(second.path), versioned(first.path), versioned(second.path)]);
          expect((await lookup()).data.receipt).toMatchObject({
            outcome: 'published',
            exitCode: 0,
            cliInvoked: true,
          });
          await eventually(async () =>
            (
              await cards()
            ).some(
              (p: any) =>
                p.id === id &&
                p.browserStatus === 'published' &&
                p.state === 'PUBLISHED' &&
                !p.releaseURL
            )
          );
        }
        expect(await fixture.calls()).toHaveLength(4);
      }),
    120000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'recovers missed workflow starts inside the original claim window and expires an older root',
    () =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            provider: 'bitbrowser',
            profileId: fixture.alias,
            name: 'Recovery',
            platforms: ['tiktok'],
          })
        ).body;
        const media = await db.media.create({
          data: {
            organizationId,
            name: 'scan.mp4',
            type: 'video',
            path: 'https://media.example/scan.mp4',
          },
        });
        const now = Math.floor(Date.now() / 1000) * 1000;
        const due = (secondsAgo: number) =>
          new Date(now - secondsAgo * 1000).toISOString();
        const save = async (date: string) => {
          const result = await request(
            'POST',
            '/posts',
            {
              type: 'schedule',
              date,
              shortLink: false,
              tags: [],
              posts: [
                {
                  integration: { id: binding.channels[0].id },
                  settings: {},
                  value: [
                    {
                      content: 'Scan fixture',
                      image: [{ id: media.id, path: media.path }],
                    },
                  ],
                },
              ],
            },
            'member'
          );
          expect(result.status).toBe(201);
          const id = result.body[0].postId;
          return (await request('GET', '/posts/' + id)).body.posts[0];
        };
        // Process loss between committing the post and delivering the workflow start.
        const start = vi
          .spyOn(app.get(PostsService), 'startWorkflow')
          .mockRejectedValue(new Error('offline'));
        vi.stubEnv('BROWSER_CLAIM_TIMEOUT_SECONDS', '60');
        const [eligible, expired, outside] = await Promise.all([
          save(due(5)),
          save(due(90)),
          save(due(172805)),
        ]).finally(() => start.mockRestore());
        vi.stubEnv('BROWSER_CLAIM_TIMEOUT_SECONDS', '1800');
        const scan = () =>
          app.get(PostActivity).searchForMissingThreeHoursPosts();
        const requests: string[] = [];
        let interruptAtCutoff = false;
        const network = globalThis.fetch;
        const fault = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input, options) => {
            if (
              String(input) !== fixture.gateway + '/internal/occurrences' ||
              options?.method !== 'POST'
            )
              return network(input, options);
            const task = JSON.parse(String(options.body));
            requests.push(task.workflowId);
            if (interruptAtCutoff) {
              await new Promise((resolve) =>
                setTimeout(
                  resolve,
                  Math.max(0, Date.parse(task.claimDeadlineAt) - Date.now()) +
                    20
                )
              );
              throw new Error(
                'handoff failed before commit, after original cutoff'
              );
            }
            if (requests.length === 1)
              throw new Error('handoff lost before reaching Gateway');
            const response = await network(input, options);
            if (requests.length === 2 && response.ok)
              throw new Error('lost committed handoff acknowledgement');
            return response;
          });
        const registration = new InfiniteWorkflowRegister(
          app.get(TemporalService)
        );
        const scanner = temporal!.workflow.getHandle('missing-post-workflow');
        try {
          vi.stubEnv('RUN_CRON', 'true');
          await registration.onModuleInit();
          await eventually(
            async () =>
              (
                await scanner.fetchHistory()
              ).events?.some(
                (e) =>
                  Number(
                    e.timerStartedEventAttributes?.startToFireTimeout?.seconds
                  ) === 3600
              ) === true
          );
          vi.useFakeTimers({ toFake: ['Date'] });
          try {
            vi.setSystemTime(now);
            await scan();
          } finally {
            vi.useRealTimers();
          }
          await eventually(
            async () =>
              (
                await request('GET', '/posts/' + expired.id)
              ).body.posts[0]?.state === 'ERROR',
            12000
          );
          const old = (await request('GET', '/posts/' + expired.id)).body
            .posts[0];
          expect(old.error).toContain(
            'Timed out waiting for an execution node'
          );
          const calendar = await request(
            'GET',
            '/posts?startDate=' + due(86400) + '&endDate=' + due(-86400)
          );
          expect(
            expandPosts(calendar.body).posts.find(
              (card: any) => card.id === expired.id
            )
          ).toMatchObject({ state: 'ERROR', browserStatus: 'timed_out' });
          expect(
            (
              await fixture.api(
                '/internal/occurrences/' + expired.browserWorkflowId
              )
            ).status
          ).toBe(404);
          await expect(
            temporal!.workflow.getHandle(outside.browserWorkflowId).describe()
          ).rejects.toThrow();
          await eventually(
            async () =>
              (
                await fixture.api(
                  '/internal/occurrences/' + eligible.browserWorkflowId
                )
              ).status === 200
          );
          const record = (
            await fixture.api(
              '/internal/occurrences/' + eligible.browserWorkflowId
            )
          ).data;
          expect(Date.parse(record.claimDeadlineAt)).toBe(
            Date.parse(due(5)) + 60000
          );
          // A retry crossing the deadline can still reconcile an accepted handoff.
          // A definitive 404 after that cutoff closes an undelivered occurrence.
          vi.stubEnv('BROWSER_CLAIM_TIMEOUT_SECONDS', '3');
          const future = () => new Date(Date.now() + 1200).toISOString();
          const pending = await save(future());
          const pendingPath =
            '/internal/occurrences/' + pending.browserWorkflowId;
          await eventually(
            async () =>
              (await fixture.api(pendingPath)).data.state === 'pending'
          );
          interruptAtCutoff = true;
          const interrupted = await save(future());
          for (const post of [pending, interrupted]) {
            await eventually(
              async () =>
                (
                  await request('GET', '/posts/' + post.id)
                ).body.posts[0].state === 'ERROR'
            );
          }
          expect((await fixture.api(pendingPath)).data).toMatchObject({
            state: 'timed_out',
            sessionId: null,
          });
          expect(
            (
              await fixture.api(
                '/internal/occurrences/' + interrupted.browserWorkflowId
              )
            ).status
          ).toBe(404);
          fixture.startDesktop();
          await fixture.release();
          await eventually(
            async () =>
              (
                await request('GET', '/posts/' + eligible.id)
              ).body.posts[0]?.state === 'PUBLISHED'
          );
          expect(requests).toEqual([
            eligible.browserWorkflowId,
            eligible.browserWorkflowId,
            pending.browserWorkflowId,
            interrupted.browserWorkflowId,
          ]);
          expect(await fixture.calls()).toHaveLength(1);
        } finally {
          fault.mockRestore();
          vi.stubEnv('BROWSER_CLAIM_TIMEOUT_SECONDS', '1800');
          await scanner.terminate();
        }
      }),
    60000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'schedules one authorized video through Temporal, the Gateway, the desktop and the original calendar card',
    () =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            provider: 'bitbrowser',
            profileId: fixture.alias,
            name: 'Scheduled test',
            platforms: ['tiktok'],
          })
        ).body;
        const media = await db.media.create({
          data: {
            organizationId,
            name: 'fixture.mp4',
            type: 'video',
            path: 'https://media.example.test/fixture.mp4',
          },
        });
        const date = new Date(
          Math.ceil(Date.now() / 1000) * 1000 + 2500
        ).toISOString();
        const post = {
          integration: { id: binding.channels[0].id },
          settings: {},
          value: [
            {
              content: 'First caption',
              image: [{ id: media.id, path: media.path }],
            },
          ],
        };
        const payload = {
          type: 'schedule',
          date,
          shortLink: false,
          tags: [],
          posts: [post],
        };
        const saved = await request('POST', '/posts', payload, 'member');
        expect(saved.status, JSON.stringify(saved.body)).toBe(201);
        const id = saved.body[0].postId;
        const original = (await request('GET', '/posts/' + id)).body.posts[0];
        const wf = original.browserWorkflowId;
        const lookup = () => fixture.api('/internal/occurrences/' + wf);
        await eventually(async () => (await lookup()).status === 200, 15000);
        const first = (await lookup()).data;
        expect(first).toMatchObject({
          workflowId: wf,
          state: 'pending',
          task: {
            bindingId: binding.id,
            organizationId,
            postId: id,
            caption: 'First caption',
            profileId: fixture.alias,
            media: [{ id: media.id, url: versioned(media.path), role: 'video' }],
          },
        });
        const edit = {
          ...post,
          group: original.group,
          value: [{ ...post.value[0], id, content: 'Latest caption' }],
        };
        expect(
          (
            await request(
              'POST',
              '/posts',
              { ...payload, type: 'update', posts: [edit] },
              'member'
            )
          ).status
        ).toBe(201);
        expect(
          (await fixture.api('/internal/occurrences', first.task)).data.state
        ).toBe('pending');
        fixture.startDesktop();
        await eventually(async () => (await fixture.calls()).length === 1);
        const card = async () =>
          expandPosts(
            (
              await request(
                'GET',
                '/posts?startDate=' +
                  date.slice(0, 10) +
                  'T00:00:00Z&endDate=' +
                  date.slice(0, 10) +
                  'T23:59:59Z'
              )
            ).body
          ).posts.find((p: any) => p.id === id);
        const uploading = await card();
        expect(uploading).toMatchObject({ browserStatus: 'publishing' });
        expect(
          (
            await request('PUT', '/posts/' + id + '/date', {
              date,
              action: 'schedule',
            })
          ).status
        ).toBe(409);
        expect(
          (await request('DELETE', '/posts/' + uploading.group)).status
        ).toBe(409);
        await request('DELETE', ops + '/bindings/' + binding.id);
        await fixture.release();
        await eventually(async () => (await card())?.state === 'PUBLISHED');
        const final = (await lookup()).data;
        expect(final).toMatchObject({
          state: 'succeeded',
          sessionId: expect.any(String),
          receipt: { outcome: 'published', exitCode: 0, cliInvoked: true },
        });
        expect(
          (await fixture.api('/internal/occurrences', first.task)).data
        ).toEqual(final);
        expect(
          (
            await fixture.api(
              '/publish-task/result',
              {
                workflowId: wf,
                sessionId: final.sessionId,
                receipt: final.receipt,
              },
              true
            )
          ).data
        ).toEqual(final);
        expect(
          (
            await fixture.api(
              '/publish-task/claim',
              { sessionId: final.sessionId, waitSeconds: 0 },
              true
            )
          ).data.task
        ).toBeNull();
        expect(await fixture.calls()).toEqual([
          expect.arrayContaining([
            'tiktok',
            'upload-video',
            '--title=Latest caption',
            versioned('--file=' + media.path),
            '--profile-id=' + fixture.alias,
            '--not-before=' +
              new Date(Math.ceil(Date.parse(date) / 1000) * 1000)
                .toISOString()
                .replace('.000Z', 'Z'),
          ]),
        ]);
        const published = await card();
        expect(published).toMatchObject({
          id,
          releaseURL: null,
          browserStatus: 'published',
        });
        expect(
          (await request('DELETE', '/posts/' + published.group)).status
        ).toBe(200);
        expect(await card()).toBeUndefined();
        expect((await lookup()).data).toEqual(final);
        await db.media.delete({ where: { id: media.id } });
      }),
    90000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'keeps the second selected account eligible after a login failure or cancellation on the first',
    () =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const bind = async (profileId: string, name: string) =>
          (
            await request('PUT', ops + '/bindings', {
              provider: 'bitbrowser',
              profileId,
              name,
              platforms: ['tiktok'],
            })
          ).body.channels[0];
        const first = await bind(fixture.loginRequiredAlias, 'First');
        const second = await bind(fixture.alias, 'Second');
        const media = await db.media.create({
          data: {
            organizationId,
            name: 'campaign.mp4',
            type: 'video',
            path: 'https://media.example.test/campaign.mp4',
          },
        });
        const schedule = async (caption: string) => {
          const date = new Date(Date.now() + 1500).toISOString();
          const secondDate = new Date(Date.parse(date) + 1000).toISOString();
          const result = await request(
            'POST',
            '/posts',
            {
              type: 'schedule',
              date,
              tags: [],
              shortLink: false,
              posts: [first, second].map((channel) => ({
                integration: { id: channel.id },
                ...(channel.id === second.id ? { date: secondDate } : {}),
                settings:
                  channel.id === second.id ? { privacy: 'friends' } : {},
                value: [
                  {
                    content: caption,
                    image: [{ id: media.id, path: media.path }],
                  },
                ],
              })),
            },
            'member'
          );
          expect(result.status, JSON.stringify(result.body)).toBe(201);
          const posts = await Promise.all(
            result.body.map(
              async (row: any) =>
                (
                  await request('GET', '/posts/' + row.postId)
                ).body.posts[0]
            )
          );
          expect(new Set(posts.map((p) => p.id)).size).toBe(2);
          expect(new Set(posts.map((p) => p.browserWorkflowId)).size).toBe(2);
          expect(posts.map((post) => post.publishDate)).toEqual([
            date,
            secondDate,
          ]);
          return posts;
        };
        const [login, healthy] = await schedule('Both selected');
        const [cancel, retained] = await schedule('Only the second remains');
        const lookup = async (p: typeof login) =>
          fixture.api('/internal/occurrences/' + p.browserWorkflowId);
        const card = async (p: typeof login) =>
          (await request('GET', '/posts/' + p.id)).body.posts?.[0];
        // Hiding the picker affects neither the accepted occurrence nor authorization at start.
        vi.stubEnv('BROWSER_PUBLISHING_DISCOVERY', 'false');
        expect(
          (await request('GET', '/integrations/list')).body.integrations.map(
            (i: any) => i.id
          )
        ).not.toContain(second.id);
        for (const post of [login, healthy, cancel, retained]) {
          await eventually(
            async () => (await lookup(post)).data.state === 'pending'
          );
        }
        expect((await request('DELETE', '/posts/' + cancel.group)).status).toBe(
          200
        );
        fixture.startDesktop();
        await eventually(async () =>
          (await fixture.calls()).some((args) => args[1] === 'upload-video')
        );
        const locked = (
          await Promise.all([login, healthy, retained].map(card))
        ).find((p) => p?.browserLocked);
        expect(locked).toBeTruthy();
        const value = {
          content: 'Attempted edit',
          image: [{ id: media.id, path: media.path }],
        };
        const before = await db.post.count({ where: { organizationId } });
        const rejected = await request(
          'POST',
          '/posts',
          {
            type: 'now',
            date: new Date().toISOString(),
            tags: [],
            shortLink: false,
            posts: [
              {
                integration: {
                  id: locked.integrationId === first.id ? second.id : first.id,
                },
                settings: {},
                value: [value],
              },
              {
                integration: { id: locked.integrationId },
                group: locked.group,
                settings: {},
                value: [{ ...value, id: locked.id }],
              },
            ],
          },
          'member'
        );
        expect(rejected.status).toBe(409);
        expect(await db.post.count({ where: { organizationId } })).toBe(before);
        await fixture.release();
        await eventually(async () => (await card(login))?.state === 'ERROR');
        await eventually(
          async () => (await card(healthy))?.state === 'PUBLISHED'
        );
        await eventually(
          async () => (await card(retained))?.state === 'PUBLISHED'
        );
        expect((await lookup(login)).data).toMatchObject({
          task: { channelId: first.id },
          receipt: { outcome: 'failed', exitCode: 10 },
        });
        const success = (await lookup(healthy)).data;
        expect(success).toMatchObject({
          task: { channelId: second.id, settings: { privacy: 'friends' } },
          receipt: { outcome: 'published', exitCode: 0 },
        });
        const uploads = (await fixture.calls()).filter(
          (args) => args[1] === 'upload-video'
        );
        expect(uploads).toHaveLength(3);
        expect(
          uploads.filter((args) => args.includes('--privacy=friends'))
        ).toEqual([
          expect.arrayContaining(['--profile-id=' + fixture.alias]),
          expect.arrayContaining(['--profile-id=' + fixture.alias]),
        ]);
        expect(
          uploads.filter((args) =>
            args.includes('--profile-id=' + fixture.loginRequiredAlias)
          )
        ).toEqual([expect.arrayContaining(['--title=Both selected'])]);
        const callsBeforeDelete = await fixture.calls();
        expect(
          (await request('DELETE', '/posts/' + healthy.group)).status
        ).toBe(200);
        expect((await lookup(healthy)).data).toEqual(success);
        expect(await fixture.calls()).toEqual(callsBeforeDelete);
        expect((await card(retained))?.state).toBe('PUBLISHED');
      }),
    90000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU).each(['scheduled', 'recovered'])(
    'declines a revoked channel before upload and retains the reason on its calendar card (%s workflow)',
    (start) =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            provider: 'bitbrowser',
            profileId: fixture.alias,
            name: 'Before upload',
            platforms: ['tiktok'],
          })
        ).body;
        const media = await db.media.create({
          data: {
            organizationId,
            name: 'clip.mp4',
            type: 'video',
            path: 'https://example.test/clip.mp4',
          },
        });
        const date = new Date().toISOString();
        const body = {
          type: 'schedule',
          inter: 1,
          date,
          tags: [],
          shortLink: false,
          posts: [
            {
              integration: { id: binding.channels[0].id },
              settings: {},
              value: [
                {
                  content: 'Revoked before start',
                  image: [{ id: media.id, path: media.path }],
                },
              ],
            },
          ],
        };
        // Simulate loss after the post commit so the normal scan starts the real
        // recovered workflow, including its additional routing metadata.
        const lostStart =
          start === 'recovered'
            ? vi
                .spyOn(app.get(PostsService), 'startWorkflow')
                .mockRejectedValue(new Error('offline'))
            : undefined;
        const result = await request('POST', '/posts', body, 'member').finally(
          () => lostStart?.mockRestore()
        );
        if (start === 'recovered')
          await app.get(PostActivity).searchForMissingThreeHoursPosts();
        expect(result.status).toBe(201);
        const post = (await request('GET', '/posts/' + result.body[0].postId))
          .body.posts[0];
        const lookup = () =>
          fixture.api('/internal/occurrences/' + post.browserWorkflowId);
        await eventually(async () => (await lookup()).status === 200);
        await request('DELETE', ops + '/bindings/' + binding.id);
        const calendar = async () =>
          expandPosts(
            (
              await request(
                'GET',
                '/posts?startDate=' +
                  date.slice(0, 10) +
                  'T00:00:00Z&endDate=' +
                  date.slice(0, 10) +
                  'T23:59:59Z'
              )
            ).body
          ).posts.find((p: any) => p.id === post.id);
        expect(await calendar()).toMatchObject({
          state: 'ERROR',
          browserStatus: 'failed',
          error: 'Browser channel is no longer authorized',
        });
        const future = new URLSearchParams({
          startDate: new Date(Date.parse(date) + 86400000).toISOString(),
          endDate: new Date(Date.parse(date) + 2 * 86400000).toISOString(),
        });
        expect(
          expandPosts(
            (await request('GET', '/posts?' + future)).body
          ).posts.filter((p: any) => p.id === post.id)
        ).toEqual([]);
        const where = { workflowId: post.browserWorkflowId };
        expect(
          (await db.browserPostOccurrence.findUniqueOrThrow({ where })).reason
        ).toBe('authorization_declined');
        if (start === 'recovered') {
          // Existing deployments persisted the merchant-facing text as the reason.
          await db.browserPostOccurrence.update({
            where,
            data: { reason: 'Browser channel is no longer authorized' },
          });
        }
        await eventually(async () => (await lookup()).data.state === 'failed');
        expect((await lookup()).data.receipt).toMatchObject({
          outcome: 'failed',
          cliInvoked: false,
        });
        expect(await fixture.calls()).toEqual([]);
        expect((await lookup()).data.receipt.reason).toBe(
          'authorization_declined'
        );
        await eventually(
          async () =>
            (
              await temporal!.workflow
                .getHandle(post.browserWorkflowId)
                .describe()
            ).status.name === 'COMPLETED'
        );
        expect((await lookup()).data.receiptHistory).toHaveLength(1);
        fixture.startDesktop();
        await fixture.release();
        expect(await fixture.calls()).toEqual([]);
      }),
    90000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'prepares an immediate explicit ordinary Chrome test target without reporting a publication',
    () =>
      withDelivery(async (fixture) => {
        vi.stubEnv('BROWSER_PUBLISHING_DEV_TEST_TARGETS', 'true');
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            provider: 'local-chrome',
            profileId: fixture.alias,
            name: 'Field account',
            platforms: ['tiktok'],
          })
        ).body;
        const media = await db.media.create({
          data: {
            organizationId,
            name: 'preview.mp4',
            type: 'video',
            path: 'https://example.test/preview.mp4',
          },
        });
        const date = new Date().toISOString();
        const result = await request(
          'POST',
          '/posts',
          {
            type: 'now',
            date,
            tags: [],
            shortLink: false,
            posts: [
              {
                integration: { id: binding.channels[0].id },
                settings: { noPublish: true },
                value: [
                  {
                    content: 'Dev preview',
                    image: [{ id: media.id, path: media.path }],
                  },
                ],
              },
            ],
          },
          'member'
        );
        expect(result.status).toBe(201);
        const post = (await request('GET', '/posts/' + result.body[0].postId))
          .body.posts[0];
        fixture.startDesktop();
        await fixture.release();
        const lookup = () =>
          fixture.api('/internal/occurrences/' + post.browserWorkflowId);
        await eventually(
          async () => (await lookup()).data.state === 'prepared'
        );
        expect((await lookup()).data.task).toMatchObject({
          noPublish: true,
          earliestPublishAt: null,
          profileId: fixture.alias,
          provider: 'local-chrome',
        });
        const [args] = await fixture.calls();
        expect(args).toEqual(
          expect.arrayContaining([
            '--no-publish',
            '--account=' + fixture.alias,
            '--local-browser=chrome',
          ])
        );
        expect(args.some((arg) => arg.startsWith('--not-before'))).toBe(false);
        const calendar = async () =>
          expandPosts(
            (
              await request(
                'GET',
                '/posts?startDate=' +
                  date.slice(0, 10) +
                  'T00:00:00Z&endDate=' +
                  date.slice(0, 10) +
                  'T23:59:59Z'
              )
            ).body
          ).posts.find((p: any) => p.id === post.id);
        await eventually(
          async () => (await calendar())?.browserStatus === 'prepared'
        );
        expect((await calendar()).state).toBe('DRAFT');
      }),
    90000
  );

  it.skipIf(!process.env.BROWSER_TRACER_SAU)(
    'starts the next daily occurrence with a distinct Temporal ID at its actual scheduled instant',
    () =>
      withDelivery(async (fixture) => {
        await request('PUT', ops, { merchantId, enabled: true });
        const binding = (
          await request('PUT', ops + '/bindings', {
            provider: 'bitbrowser',
            profileId: fixture.alias,
            name: 'Daily',
            platforms: ['tiktok'],
          })
        ).body;
        const media = await db.media.create({
          data: {
            organizationId,
            name: 'daily.mp4',
            type: 'video',
            path: 'https://example.test/daily.mp4',
          },
        });
        const anchor = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3123);
        const result = await request(
          'POST',
          '/posts',
          {
            type: 'schedule',
            date: anchor.toISOString(),
            inter: 1,
            tags: [],
            shortLink: false,
            posts: [
              {
                integration: { id: binding.channels[0].id },
                settings: {},
                value: [
                  {
                    content: 'Daily occurrence',
                    image: [{ id: media.id, path: media.path }],
                  },
                ],
              },
            ],
          },
          'member'
        );
        expect(result.status).toBe(201);
        const id = result.body[0].postId;
        const read = async () =>
          (await request('GET', '/posts/' + id)).body.posts[0];
        const settingsUrl = '/public/v1/posts/' + id + '/settings';
        const settings = { settings: { privacy: 'friends' } };
        const superseded = await read();
        expect(await request('PUT', settingsUrl, settings)).toMatchObject({
          status: 200,
          body: { postId: id, publishDate: anchor.toISOString() },
        });
        expect(JSON.parse((await read()).settings)).toMatchObject(
          settings.settings
        );
        expect(await read()).toMatchObject({
          publishDate: anchor.toISOString(),
          browserWorkflowId: superseded.browserWorkflowId,
          intervalInDays: 1,
        });
        const oldReceipt = () =>
          fixture.api('/internal/occurrences/' + superseded.browserWorkflowId);
        await eventually(async () => (await oldReceipt()).status === 200);
        // Save again at the same instant while the original handoff waits for its desktop.
        expect(
          (
            await request('PUT', '/posts/' + id + '/date', {
              date: anchor.toISOString(),
              action: 'schedule',
            })
          ).status
        ).toBe(200);
        const first = await read();
        await eventually(async () => Date.now() >= anchor.getTime());
        expect((await request('PUT', settingsUrl, settings)).status).toBe(200);
        fixture.startDesktop();
        await eventually(async () => (await fixture.calls()).length === 1);
        expect((await fixture.calls())[0]).toContain('--privacy=friends');
        expect((await request('PUT', settingsUrl, settings)).status).toBe(409);
        await fixture.release();
        await eventually(
          async () =>
            (await read()).browserWorkflowId !== first.browserWorkflowId
        );
        const second = await read();
        const next = new Date(anchor.getTime() + 86400000);
        expect(second).toMatchObject({
          id,
          publishDate: anchor.toISOString(),
          browserDueAt: next.toISOString(),
        });
        expect((await request('PUT', settingsUrl, settings)).status).toBe(200);
        expect(await read()).toMatchObject({
          browserWorkflowId: second.browserWorkflowId,
          publishDate: anchor.toISOString(),
          browserDueAt: next.toISOString(),
          intervalInDays: 1,
        });
        const child = temporal!.workflow.getHandle(second.browserWorkflowId);
        await eventually(async () =>
          (
            await child.fetchHistory()
          ).events.some((e) => Boolean(e.timerStartedEventAttributes))
        );
        const history = (await child.fetchHistory()).events;
        const timer = history.find((e) => e.timerStartedEventAttributes)!;
        const firedAt =
          Number(timer.eventTime.seconds) * 1000 +
          Number(timer.eventTime.nanos) / 1e6 +
          Number(
            timer.timerStartedEventAttributes!.startToFireTimeout.seconds
          ) *
            1000 +
          Number(timer.timerStartedEventAttributes!.startToFireTimeout.nanos) /
            1e6;
        expect(Math.abs(firedAt - next.getTime())).toBeLessThan(1500);
        expect(await fixture.calls()).toHaveLength(1);
        expect((await oldReceipt()).data.receipt).toMatchObject({
          outcome: 'failed',
          cliInvoked: false,
        });
        const query = new URLSearchParams({
          startDate: anchor.toISOString(),
          endDate: next.toISOString(),
        });
        const cards = expandPosts(
          (await request('GET', '/posts?' + query)).body
        ).posts.filter((post: any) => post.id === id);
        expect(
          cards.map((post: any) => [post.publishDate, post.browserStatus])
        ).toEqual([
          [anchor.toISOString(), 'published'],
          [next.toISOString(), 'pending'],
        ]);
        const nextPreview = new Date(+next + 86400000).toISOString();
        const previewQuery = new URLSearchParams({
          startDate: nextPreview,
          endDate: nextPreview,
        });
        expect(
          expandPosts((await request('GET', '/posts?' + previewQuery)).body)
            .posts
        ).toContainEqual(
          expect.objectContaining({
            id,
            state: 'QUEUE',
            publishDate: nextPreview,
          })
        );
        const moved = new Date(next.getTime() + 3600000);
        expect(
          (
            await request('PUT', '/posts/' + id + '/date', {
              date: moved.toISOString(),
              action: 'schedule',
            })
          ).status
        ).toBe(200);
        const shifted = new URLSearchParams({
          startDate: anchor.toISOString(),
          endDate: moved.toISOString(),
        });
        const updated = expandPosts(
          (await request('GET', '/posts?' + shifted)).body
        ).posts.filter((post: any) => post.id === id);
        expect(updated.map((card: any) => card.publishDate).sort()).toEqual([
          anchor.toISOString(),
          moved.toISOString(),
        ]);
        expect(
          updated.find((card: any) => card.publishDate === anchor.toISOString())
        ).toMatchObject({
          state: 'PUBLISHED',
          browserStatus: 'published',
          browserWorkflowId: first.browserWorkflowId,
        });
        const historyOnly = new URLSearchParams({
          startDate: anchor.toISOString(),
          endDate: anchor.toISOString(),
        });
        const historical = expandPosts(
          (await request('GET', '/posts?' + historyOnly)).body
        ).posts.filter((post: any) => post.id === id);
        expect(historical.map((card: any) => card.browserWorkflowId)).toEqual([
          first.browserWorkflowId,
        ]);
        await request('DELETE', '/posts/' + second.group);
      }),
    90000
  );

  it
    .skipIf(!process.env.BROWSER_TRACER_SAU)
    .each([
      'before-report',
      'late-on-open',
      'lost-ack',
      'offline-orchestrator',
      'late-while-offline',
      'claim-lost',
      'review-after-three-days',
      'gateway-offline',
    ] as const)(
    'reconciles %s on the original calendar occurrence',
    async (fault) => {
      const missingReport = [
        'before-report',
        'late-on-open',
        'review-after-three-days',
        'gateway-offline',
      ].includes(fault);
      await withDelivery(
        async (fixture, orchestration) => {
          await request('PUT', ops, { merchantId, enabled: true });
          const binding = (
            await request('PUT', ops + '/bindings', {
              provider: 'bitbrowser',
              profileId: fixture.alias,
              name: 'Review test',
              platforms: ['tiktok'],
            })
          ).body;
          const media = await db.media.create({
            data: {
              organizationId,
              name: 'video',
              type: 'video',
              path: 'https://media.example.test/test.mp4',
            },
          });
          const date = new Date().toISOString();
          const created = await request(
            'POST',
            '/posts',
            {
              type: 'now',
              ...(['before-report', 'review-after-three-days'].includes(
                fault
              ) && { inter: 1 }),
              date,
              tags: [],
              shortLink: false,
              posts: [
                {
                  integration: { id: binding.channels[0].id },
                  settings: {},
                  value: [
                    {
                      content: 'Review test',
                      image: [{ id: media.id, path: media.path }],
                    },
                  ],
                },
              ],
            },
            'member'
          );
          expect(created.status, JSON.stringify(created.body)).toBe(201);
          const id = created.body[0].postId;
          const wf = (await request('GET', '/posts/' + id)).body.posts[0]
            .browserWorkflowId;
          const review = '/browser-publishing/review/' + wf;
          const execution = ops + '/occurrences/' + wf;
          const until = new URLSearchParams({
            startDate: new Date(Date.now() - 86400000).toISOString(),
            endDate: new Date(Date.now() + 86400000).toISOString(),
          });
          const card = async () =>
            expandPosts(
              (await request('GET', '/posts?' + until)).body
            ).posts.find((p: any) => p.id === id);
          interruptEmail = fault === 'before-report';
          const stopDesktop = fixture.startDesktop();
          if (fault === 'claim-lost') {
            await eventually(
              async () => fixture.boundary!.counts().claimsLost === 1
            );
            await stopDesktop();
            await eventually(
              async () => (await card()).browserStatus === 'needs_review'
            );
            const record = (await fixture.api('/internal/occurrences/' + wf))
              .data;
            expect(record).toMatchObject({
              state: 'unknown',
              receipt: null,
              publishStartedAt: null,
            });
            await temporal!.workflow.getHandle(wf).result();
            const originalFetch = globalThis.fetch;
            const offlineGateway = vi
              .spyOn(globalThis, 'fetch')
              .mockImplementation((input, init) =>
                String(input).endsWith('/internal/occurrences/revoke')
                  ? Promise.resolve(new Response(null, { status: 503 }))
                  : originalFetch(input, init)
              );
            try {
              expect(
                (await request('DELETE', ops + '/bindings/' + binding.id))
                  .status
              ).toBe(200);
              expect(await card()).toMatchObject({
                browserStatus: 'failed',
                error: 'Browser channel is no longer authorized',
              });
            } finally {
              offlineGateway.mockRestore();
            }
            await app.get(PostActivity).searchForMissingThreeHoursPosts();
            await app.get(PostActivity).searchForMissingThreeHoursPosts();
            const failed = (await fixture.api('/internal/occurrences/' + wf))
              .data;
            expect(failed).toMatchObject({
              state: 'failed',
              publishStartedAt: null,
              receipt: { reason: 'authorization_declined', cliInvoked: false },
            });
            expect(failed.receiptHistory).toHaveLength(1);
            expect(fixture.boundary!.counts().reports).toBe(0);
            expect(await fixture.calls()).toHaveLength(0);
            return;
          }
          await eventually(async () => (await fixture.calls()).length === 1);
          const offline =
            fault === 'offline-orchestrator' || fault === 'late-while-offline';
          if (offline) await orchestration.stop();
          if (fault === 'late-while-offline') {
            const { data } = await fixture.api('/internal/occurrences/' + wf);
            expect(data.overdueAt).toBeNull();
            await new Promise((done) =>
              setTimeout(
                done,
                Math.max(0, Date.parse(data.resultDeadlineAt) - Date.now()) +
                  100
              )
            );
          }
          await fixture.release();
          await eventually(
            async () => fixture.boundary!.counts().reports === 1
          );
          if (!missingReport) {
            await eventually(
              async () =>
                (
                  await fixture.api('/internal/occurrences/' + wf)
                ).data.receipt?.outcome === 'published'
            );
          }
          await stopDesktop();
          if (offline) {
            expect((await card()).browserStatus).toBe('publishing');
            await orchestration.start();
          }
          await eventually(
            async () =>
              (await card()).browserStatus ===
              (missingReport || fault === 'late-while-offline'
                ? 'needs_review'
                : 'published')
          );
          if (fault === 'late-while-offline') {
            const { data } = await fixture.api('/internal/occurrences/' + wf);
            expect(data.overdueAt).toBeTruthy();
            expect(data.receipt.outcome).toBe('published');
            expect((await card()).error).toMatch(/desktop.*deadline/i);
            await temporal!.workflow.getHandle(wf).result();
            expect(
              (await request('GET', review, undefined, 'member')).body.status
            ).toBe('published');
            expect((await card()).state).toBe('PUBLISHED');
            const notices = (await request('GET', '/notifications/list')).body
              .notifications;
            expect(
              notices.filter((n: any) => n.content.includes(wf))
            ).toHaveLength(1);
          }
          if (fault === 'late-on-open') {
            const original = (await fixture.api('/internal/occurrences/' + wf))
              .data;
            await fixture.api(
              '/publish-task/result',
              {
                sessionId: original.sessionId,
                workflowId: wf,
                receipt: {
                  outcome: 'published',
                  cliInvoked: true,
                  exitCode: 0,
                },
              },
              true
            );
            expect((await card()).browserStatus).toBe('needs_review');
            expect(
              (await request('GET', execution + '/review')).body
            ).toMatchObject({ status: 'published', reviewedAt: null });
            expect(
              (await request('PUT', review, { outcome: 'failed' }, 'member'))
                .body
            ).toMatchObject({ status: 'published', reviewerId: null });
            expect((await card()).state).toBe('PUBLISHED');
          }
          if (fault === 'review-after-three-days') {
            const scheduled = Date.parse((await card()).publishDate);
            const fakeNow = vi
              .spyOn(Date, 'now')
              .mockReturnValue(scheduled + 3 * 86400000 + 60000);
            try {
              expect(
                (
                  await request(
                    'PUT',
                    review,
                    { outcome: 'published' },
                    'member'
                  )
                ).body.status
              ).toBe('published');
            } finally {
              fakeNow.mockRestore();
            }
            const query = new URLSearchParams({
              startDate: new Date(scheduled).toISOString(),
              endDate: new Date(scheduled + 5 * 86400000).toISOString(),
            });
            const dates = expandPosts(
              (await request('GET', '/posts?' + query)).body
            )
              .posts.filter((p: any) => p.id === id)
              .map((p: any) => p.publishDate);
            expect(dates).toEqual(
              [0, 4, 5].map((day) =>
                new Date(scheduled + day * 86400000).toISOString()
              )
            );
          }
          if (fault === 'before-report') {
            const future = new URLSearchParams({
              startDate: new Date(Date.parse(date) + 86400000).toISOString(),
              endDate: new Date(Date.parse(date) + 2 * 86400000).toISOString(),
            });
            const futureCards = async () =>
              expandPosts(
                (await request('GET', '/posts?' + future)).body
              ).posts.filter((p: any) => p.id === id);
            expect(await futureCards()).toEqual([]);
            // This occurrence already obtained its upload grant; unbinding
            // must leave the review and the eventual manual decision intact.
            expect(
              (await request('DELETE', ops + '/bindings/' + binding.id)).status
            ).toBe(200);
            expect((await card()).browserStatus).toBe('needs_review');
            expect((await card()).error).toMatch(/desktop.*report/i);
            const handle = temporal!.workflow.getHandle(wf);
            await handle.result(); // regular polling ends at review
            expect(
              (await request('GET', review, undefined, 'foreign')).status
            ).toBe(404);
            postingAllowed = false;
            try {
              expect(
                (
                  await request(
                    'PUT',
                    review,
                    { outcome: 'published' },
                    'member'
                  )
                ).status
              ).toBe(402);
            } finally {
              postingAllowed = true;
            }
            const opened = await request('GET', review, undefined, 'member');
            expect(opened.body.status).toBe('needs_review');
            expect(
              (await request('GET', execution, undefined, 'member')).status
            ).toBe(403);
            const decision = {
              outcome: 'failed',
              note: 'Checked the account',
              releaseId: 'manual',
              url: 'https://example.test/review',
            };
            const resolutions = await Promise.all([
              request('PUT', review, decision, 'member'),
              request('PUT', review, decision, 'member'),
            ]);
            expect(resolutions.some((r) => r.status === 200)).toBe(true);
            const original = (await fixture.api('/internal/occurrences/' + wf))
              .data;
            await fixture.api(
              '/publish-task/result',
              {
                sessionId: original.sessionId,
                workflowId: wf,
                receipt: {
                  outcome: 'published',
                  cliInvoked: true,
                  exitCode: 0,
                },
              },
              true
            );
            expect(
              (await request('DELETE', ops + '/bindings/' + binding.id)).status
            ).toBe(200);
            const evidence = await request('GET', execution);
            expect(evidence.body).toMatchObject({
              status: 'failed',
              reviewerId: actors.member,
              reviewedAt: expect.any(String),
              note: decision.note,
              releaseId: 'manual',
              gateway: { receipt: { outcome: 'published' } },
            });
            expect((await card()).browserStatus).toBe('failed');
            expect(await futureCards()).toEqual([]);
            const incidentList = await request('GET', ops + '/occurrences');
            expect(incidentList.body.map((r: any) => r.workflowId)).toContain(
              wf
            );
            const notices = (await request('GET', '/notifications/list')).body
              .notifications;
            expect(
              notices.filter((item: any) => item.content.includes(wf))
            ).toHaveLength(1);
            const recipients = email.mock.calls
              .filter((call) => String(call[2]).includes(wf))
              .map((call) => call[0]);
            expect(recipients.sort()).toEqual(
              [
                actors.operator + '@example.test',
                merchantId + '@sso.merchant',
              ].sort()
            );
          }
          const before = fixture.boundary!.counts();
          const stopNewDesktop = fixture.startDesktop();
          await eventually(
            async () => fixture.boundary!.counts().polls > before.polls
          );
          await stopNewDesktop();
          expect(fixture.boundary!.counts().reports).toBe(1);
          expect(await fixture.calls()).toHaveLength(1);
        },
        fault === 'late-on-open' || fault === 'review-after-three-days'
          ? 'before-report'
          : fault === 'late-while-offline'
          ? 'offline-orchestrator'
          : fault
      );
    },
    90000
  );

  it('keeps a prepared occurrence editable until the approved 09:50 upload, including cancellation and rescheduling', async () => {
    const fixtureEnv = {
      SAU_GATEWAY_URL: 'https://preparation.fixture.invalid',
      GATEWAY_INTERNAL_TOKEN: 'preparation-fixture',
      BROWSER_PREDOWNLOAD_LEAD_SECONDS: '1800',
      BROWSER_UPLOAD_LEAD_SECONDS: '600',
    };
    const previous = Object.fromEntries(
      Object.keys(fixtureEnv).map((k) => [k, process.env[k]])
    );
    Object.assign(process.env, fixtureEnv);
    const realFetch = globalThis.fetch;
    const offers: any[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (
          String(input) ===
          fixtureEnv.SAU_GATEWAY_URL + '/internal/preparations'
        ) {
          offers.push(JSON.parse(String(init?.body)));
          return new Response('{}', { status: 200 });
        }
        return realFetch(input, init);
      });
    const clock = vi.spyOn(Date, 'now');
    try {
      await request('PUT', ops, { merchantId, enabled: true });
      const binding = (
        await request('PUT', ops + '/bindings', {
          provider: 'bitbrowser',
          profileId: randomUUID(),
          name: 'Lead window',
          platforms: ['tiktok'],
        })
      ).body;
      const media = await Promise.all(
        ['original', 'replacement'].map((name) =>
          db.media.create({
            data: {
              organizationId,
              name,
              type: 'video',
              path: 'https://media.example.test/replaced.mp4',
            },
          })
        )
      );
      const date = '2038-05-11T10:00:00.750Z';
      const item = (
        video: (typeof media)[number],
        caption: string,
        id?: string
      ) => ({
        ...(id ? { id } : {}),
        content: caption,
        image: [{ id: video.id, path: video.path }],
      });
      const source = {
        integration: { id: binding.channels[0].id },
        settings: {},
        value: [item(media[0], 'original')],
      };
      const payload = {
        type: 'schedule',
        shortLink: false,
        tags: [],
        date,
        posts: [source],
      };
      const activity = app.get(PostActivity);
      const save = async () => {
        const created = await request(
          'POST',
          '/public/v1/posts',
          payload,
          'merchant'
        );
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const postId = created.body[0].postId;
        const post = (await request('GET', '/posts/' + postId)).body.posts[0];
        const ref = {
          postId,
          organizationId,
          workflowId: post.browserWorkflowId,
        };
        expect(await activity.browserSchedule(ref)).toBe(date);
        return { ref, group: post.group };
      };
      const authorize = async (ref: any) =>
        fetch(
          (await app.getUrl()) + '/internal/browser-publishing/authorize-start',
          {
            method: 'POST',
            headers: {
              authorization: 'Bearer ' + fixtureEnv.GATEWAY_INTERNAL_TOKEN,
              'content-type': 'application/json',
            },
            body: JSON.stringify(ref),
          }
        );
      const edited = await save(),
        cancelled = await save(),
        moved = await save(),
        unbound = await save();
      clock.mockReturnValue(Date.parse('2038-05-11T09:30:00.750Z'));
      await activity.browserPrepare(edited.ref);
      expect(offers).toHaveLength(1);
      expect(offers[0]).toMatchObject({
        expiresAt: '2038-05-11T09:50:00.750Z',
        task: {
          workflowId: edited.ref.workflowId,
          media: [{ id: media[0].id, role: 'video' }],
        },
      });
      // A replacement can finish at the same storage path and keep its media ID.
      await db.media.update({ where: {id: media[0].id}, data: {updatedAt: new Date('2038-05-11T09:32:00Z')} });
      await activity.browserPrepare(edited.ref);
      expect(offers[1].task.media[0].id).toBe(media[0].id);
      expect(offers[1].task.media[0].url).not.toBe(offers[0].task.media[0].url);
      expect((await authorize(edited.ref)).status).toBe(425);
      clock.mockReturnValue(Date.parse('2038-05-11T09:50:00.749Z'));
      const edit = await request(
        'POST',
        '/posts',
        {
          ...payload,
          type: 'schedule',
          posts: [
            {
              ...source,
              group: edited.group,
              value: [item(media[1], 'latest edit', edited.ref.postId)],
            },
          ],
        },
        'member'
      );
      expect(edit.status, JSON.stringify(edit.body)).toBe(201);
      expect(
        (await request('DELETE', '/posts/' + cancelled.group)).status
      ).toBe(200);
      expect(
        (
          await request('PUT', '/posts/' + moved.ref.postId + '/date', {
            action: 'schedule',
            date: '2038-05-12T10:00:00.750Z',
          })
        ).status
      ).toBe(200);
      clock.mockReturnValue(Date.parse('2038-05-11T09:50:00.750Z'));
      expect((await authorize(cancelled.ref)).status).toBe(409);
      expect((await authorize(moved.ref)).status).toBe(409);
      const stale = await authorize({ ...edited.ref, preparedMedia: offers[0].task.media });
      expect(stale.status).toBe(412);
      const replacement = (await stale.json()).task;
      expect(replacement.media[0].id).toBe(media[1].id);
      const grant = await authorize({ ...edited.ref, preparedMedia: replacement.media });
      expect(grant.status).toBe(201);
      const task = await grant.json();
      expect(task).toMatchObject({
        caption: 'latest edit',
        media: [{ id: media[1].id }],
        earliestPublishAt: '2038-05-11T10:00:01Z',
      });
      expect(task.media[0].url).not.toBe(offers[0].task.media[0].url);
      const current = (await request('GET', '/posts/' + edited.ref.postId)).body
        .posts[0];
      expect((await request('DELETE', '/posts/' + current.group)).status).toBe(
        409
      );
      await request('DELETE', ops + '/bindings/' + binding.id);
      const denied = await authorize(unbound.ref);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({
        message: 'Browser channel is no longer authorized',
      });
      await db.browserPostOccurrence.update({
        where: { workflowId: unbound.ref.workflowId },
        data: { reason: 'Browser channel is no longer authorized' },
      });
      const legacy = await authorize(unbound.ref);
      expect(legacy.status).toBe(403);
      expect(await legacy.json()).toMatchObject({
        message: 'Browser channel is no longer authorized',
      });
    } finally {
      clock.mockRestore();
      fetchSpy.mockRestore();
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('rejects an upload authorization request without the Gateway service bearer', async () => {
    const response = await fetch(
      (await app.getUrl()) + '/internal/browser-publishing/authorize-start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'not-issued',
          postId: 'not-issued',
          organizationId,
        }),
      }
    );
    expect(response.status).toBe(401);
  });

  it('requires an explicit development opt-in to bind an ordinary Chrome account alias', async () => {
    const target = {
      provider: 'local-chrome',
      profileId: 'fixture',
      name: 'Field account',
      platforms: ['tiktok'],
    };
    await request('PUT', ops, { merchantId, enabled: true });
    vi.stubEnv('BROWSER_PUBLISHING_DEV_TEST_TARGETS', 'false');
    expect((await request('PUT', ops + '/bindings', target)).status).toBe(400);
    vi.stubEnv('BROWSER_PUBLISHING_DEV_TEST_TARGETS', 'true');
    expect(await request('PUT', ops + '/bindings', target)).toMatchObject({
      status: 200,
      body: { provider: 'local-chrome', profileId: 'fixture' },
    });
  });

  it('keeps a scheduled channel when discovery closes and checks posting permission before rescheduling', async () => {
    await request('PUT', ops, { merchantId, enabled: true });
    const bound = (
      await request('PUT', ops + '/bindings', {
        provider: 'adspower',
        name: 'Future',
        profileId: 'future',
        platforms: ['tiktok'],
      })
    ).body;
    const channel = bound.channels[0];
    const asset = await db.media.create({
      data: {
        organizationId,
        name: 'clip.mp4',
        type: 'video',
        path: 'https://assets.example.test/clip.mp4',
      },
    });
    const date = new Date(Date.now() + 86400000).toISOString();
    const body = {
      type: 'schedule',
      date,
      tags: [],
      shortLink: false,
      posts: [
        {
          integration: { id: channel.id },
          value: [
            {
              content: 'Clip',
              image: [{ id: asset.id, path: asset.path }],
            },
          ],
          settings: {},
        },
      ],
    };
    vi.stubEnv('BROWSER_PUBLISHING_DISCOVERY', 'true');
    const scheduled = await request('POST', '/posts', body, 'merchant');
    expect(scheduled, JSON.stringify(scheduled)).toMatchObject({
      status: 201,
      body: [{ integration: channel.id }],
    });
    const id = scheduled.body[0].postId;
    const first = (await request('GET', '/posts/' + id)).body.posts[0];
    expect(first.browserWorkflowId).toEqual(expect.any(String));
    vi.stubEnv('BROWSER_PUBLISHING_DISCOVERY', 'false');
    expect((await request('GET', '/posts/' + id)).status).toBe(200);
    expect(
      (
        await request(
          'PUT',
          '/posts/' + id + '/date',
          { date, action: 'schedule' },
          'member'
        )
      ).status
    ).toBe(200);
    const rescheduled = (await request('GET', '/posts/' + id)).body.posts[0];
    expect(rescheduled.browserWorkflowId).toEqual(expect.any(String));
    expect(rescheduled.browserWorkflowId).not.toBe(first.browserWorkflowId);
    const official = await db.integration.create({
      data: {
        organizationId, internalId: randomUUID(), name: 'Official',
        providerIdentifier: 'x', type: 'social', token: '',
      },
    });
    const postData = { organizationId, publishDate: new Date(date), content: 'Calendar edit' };
    const [draft, officialPost] = await Promise.all([
      db.post.create({
        data: { ...postData, group: randomUUID(), integrationId: channel.id, state: 'DRAFT' },
      }),
      db.post.create({
        data: { ...postData, group: randomUUID(), integrationId: official.id, state: 'QUEUE' },
      }),
    ]);
    const past = new Date(Date.now() - 1000);
    await db.post.update({
      where: { id: officialPost.id },
      data: { publishDate: past, intervalInDays: 1 },
    });
    const tomorrow = new Date(+past + 86400000).toISOString();
    const query = new URLSearchParams({
      startDate: tomorrow,
      endDate: tomorrow,
    });
    expect(
      expandPosts((await request('GET', '/posts?' + query)).body).posts
    ).toContainEqual(
      expect.objectContaining({ id: officialPost.id, publishDate: tomorrow })
    );
    const officialSettings = await request(
      'PUT',
      '/public/v1/posts/' + officialPost.id + '/settings',
      { settings: {} }
    );
    expect(officialSettings.status).toBe(400);
    expect(officialSettings.body.message).toMatch(/publish time.*passed/);
    postingAllowed = false;
    try {
      const earlier = new Date(Date.parse(date) - 60000).toISOString();
      for (const post of [draft, officialPost]) {
        expect((await request('PUT', '/posts/' + post.id + '/date', { date: earlier }, 'member')).status).toBe(200);
      }
      for (const change of [{ date: earlier }, { date: earlier, action: 'update' }]) {
        expect((await request('PUT', '/posts/' + id + '/date', change, 'member')).status).toBe(402);
      }
      expect((await request('GET', '/posts/' + id)).body.posts[0]).toMatchObject({
        publishDate: rescheduled.publishDate,
        browserWorkflowId: rescheduled.browserWorkflowId,
      });
      expect(
        (
          await request(
            'PUT',
            '/posts/' + id + '/date',
            { date, action: 'schedule' },
            'member'
          )
        ).status
      ).toBe(402);
      expect(
        (
          await request('PUT', '/public/v1/posts/' + id + '/status', {
            status: 'schedule',
          })
        ).status
      ).toBe(402);
    } finally {
      postingAllowed = true;
    }
    await request('DELETE', ops + '/bindings/' + bound.id);
    expect(
      (
        await request(
          'PUT',
          '/posts/' + id + '/date',
          { date, action: 'schedule' },
          'member'
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request('PUT', '/public/v1/posts/' + id + '/status', {
          status: 'schedule',
        })
      ).status
    ).toBe(400);
  });
});
