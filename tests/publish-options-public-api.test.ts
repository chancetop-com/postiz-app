import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { publicPostSchemas } from '@gitroom/backend/public-api/public.post.schemas';
import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

const tiktokSettings = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  duet: false,
  stitch: false,
  comment: true,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  content_posting_method: 'DIRECT_POST',
};

const persistPost = vi.fn<PostsService['createPost']>(async (_org, body) =>
  body.posts.map(({ integration }) => ({
    postId: 'post-1',
    integration: integration.id,
  }))
);
const getPost = vi.fn();

let app: INestApplication;
let url: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [PublicIntegrationsController],
    providers: [
      PostsService,
      IntegrationManager,
      { provide: PostsRepository, useValue: { getPost } },
      {
        provide: IntegrationService,
        useValue: {
          getIntegrationById: async (_org: string, id: string) => ({
            id,
            name: id,
            providerIdentifier: id,
          }),
        },
      },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  const posts = module.get(PostsService);
  vi.spyOn(posts, 'createPost').mockImplementation(persistPost);
  app = module.createNestApplication({ logger: false });
  app.use((req, _res, next) => {
    req.org = { id: 'org' };
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  loadSwagger(app, publicPostSchemas());
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});

beforeEach(() => {
  persistPost.mockClear();
  getPost.mockReset();
});

afterAll(async () => {
  await app?.close();
});

const create = (
  provider: string,
  fields: Record<string, unknown>,
  date = '2026-12-01T12:00:00Z'
) =>
  fetch(url + '/public/v1/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'schedule',
      date,
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: provider },
          value: [
            {
              content: 'Caption',
              image: [{ id: 'video', path: 'https://media.test/video.mp4' }],
            },
          ],
          settings: {
            ...(provider.startsWith('tiktok')
              ? tiktokSettings
              : { post_type: 'post' }),
            ...fields,
          },
        },
      ],
    }),
  });

describe.each([
  'instagram',
  'instagram-standalone',
  'tiktok',
  'tiktok-business',
])('%s create-post settings', (provider) => {
  it.each([true, false])('preserves the JSON boolean %s', async (flag) => {
    const response = await create(provider, { is_ai_generated: flag });
    expect(response.status).toBe(201);
    expect(persistPost.mock.calls[0][1].posts[0].settings).toHaveProperty(
      'is_ai_generated', flag
    );
  });
  it.each(['false', 'true', 1, null])(
    'rejects the non-boolean %j',
    async (flag) => {
      const response = await create(provider, { is_ai_generated: flag });
      expect(response.status).toBe(400);
      expect(persistPost).not.toHaveBeenCalled();
      expect((await response.json()).message).toContainEqual(
        expect.stringContaining('is_ai_generated')
      );
    }
  );
  it('accepts an omitted flag and the old field', async () => {
    const response = await create(provider, { video_made_with_ai: true });
    expect(response.status).toBe(201);
    expect(persistPost.mock.calls[0][1].posts[0].settings).not.toHaveProperty(
      'is_ai_generated'
    );
  });
});

describe.each(['instagram', 'instagram-standalone'])('%s location ID', (provider) => {
  it('rejects a JSON number before creating the post', async () => {
    const response = await create(provider, {
      location: { id: 12345, name: 'Coffee Corner' },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContainEqual(
      expect.stringContaining('location.id must be a string')
    );
    expect(persistPost).not.toHaveBeenCalled();
  });

  it('preserves every digit of a string ID beyond the safe integer range', async () => {
    const id = '9007199254740993';
    const response = await create(provider, {
      location: { id, name: 'Coffee Corner' },
    });

    expect(response.status).toBe(201);
    expect(persistPost.mock.calls[0][1].posts[0].settings).toHaveProperty(
      'location.id', id
    );
  });
});

describe('updating Instagram draft settings', () => {
  const updateDraft = (
    provider: string,
    settings: Record<string, unknown>,
    storedSettings: Record<string, unknown> = {}
  ) => {
    getPost.mockResolvedValueOnce({
      id: 'draft-1',
      state: 'DRAFT',
      integration: { id: provider, providerIdentifier: provider },
      publishDate: new Date('2026-12-01T12:00:00Z'),
      content: 'Unfinished caption',
      image: '[]',
      settings: JSON.stringify(storedSettings),
    });
    return fetch(url + '/public/v1/posts/draft-1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
  };

  it.each(['instagram', 'instagram-standalone'])(
    'rejects a numeric location ID before saving the %s draft',
    async (provider) => {
      const response = await updateDraft(provider, {
        location: { id: 12345, name: 'Coffee Corner' },
      });
      expect(response.status).toBe(400);
      expect((await response.json()).message).toContain(
        'location.id must be a string'
      );
      expect(persistPost).not.toHaveBeenCalled();
    }
  );

  it.each(['instagram', 'instagram-standalone'])(
    'keeps every digit of a string location ID on an incomplete %s draft',
    async (provider) => {
      const location = { id: '9007199254740993' };
      const response = await updateDraft(provider, { location });
      expect(response.status).toBe(200);
      expect(persistPost.mock.calls[0][1].posts[0].settings).toHaveProperty(
        'location', location
      );
    }
  );

  it('saves an incomplete draft without a location', async () => {
    const response = await updateDraft('instagram', { is_ai_generated: true });
    expect(response.status).toBe(200);
    const settings = persistPost.mock.calls[0][1].posts[0].settings;
    expect(settings).toHaveProperty('is_ai_generated', true);
    expect(settings).not.toHaveProperty('location');
  });

  it('allows an unrelated edit to a draft with a legacy numeric ID', async () => {
    const location = { id: 12345, name: 'Coffee Corner' };
    const response = await updateDraft(
      'instagram', { is_ai_generated: true }, { location }
    );
    expect(response.status).toBe(200);
    expect(persistPost.mock.calls[0][1].posts[0].settings).toMatchObject({
      location,
      is_ai_generated: true,
    });
  });
});

it('publishes the provider settings and their media rules in the create-post OpenAPI document', async () => {
  const response = await fetch(url + '/docs-json');
  expect(response.status).toBe(200);
  const doc = await response.json();
  const body =
    doc.paths['/public/v1/posts'].post.requestBody.content['application/json']
      .schema;
  const schemas = doc.components.schemas;
  const request = schemas[body.$ref.split('/').pop()];
  // The API accepts both UTC timestamps and local ISO 8601 dates from the composer.
  expect(request.properties.date).toEqual({
    type: 'string',
    description: expect.stringContaining('ISO 8601'),
  });
  expect((await create('instagram', {}, '2026-12-01T12:00:00')).status).toBe(
    201
  );
  const settings = request.properties.posts.items.properties.settings;
  for (const [model, rule] of [
    ['InstagramDto', 'Story'],
    ['TikTokDto', 'video UPLOAD'],
  ]) {
    expect(settings.anyOf).toContainEqual({
      $ref: '#/components/schemas/' + model,
    });
    const schema = schemas[model];
    expect(schema.properties.is_ai_generated).toMatchObject({
      type: 'boolean',
      description: expect.stringContaining(rule),
    });
    expect(schema.required).not.toContain('is_ai_generated');
    expect(schema.properties).not.toHaveProperty('video_made_with_ai');
    expect(schema.properties.location.properties.id).toMatchObject({
      type: 'string',
    });
  }
});
