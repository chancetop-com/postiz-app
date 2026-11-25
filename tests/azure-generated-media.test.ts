import { endDirectoryTiff } from './azure-tiff.fixture';
import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startAzureMediaStorage } from './azure-media-storage.fixture';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const source = 'https://203.0.113.30';
const remote = new Map<string, () => Response>();
const owners = new Map<string, string>();
let storage: Awaited<ReturnType<typeof startAzureMediaStorage>>;
let video: import('../apps/orchestrator/src/activities/video.activity').VideoActivity;
let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  storage = await startAzureMediaStorage();
  const fetchHttp = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      if (url.origin === source || url.origin === 'https://api.elevenlabs.io') {
        return (
          remote.get(url.pathname)?.() ?? new Response(null, { status: 404 })
        );
      }
      return fetchHttp(input, options);
    }
  );
  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PublicIntegrationsController } = await import(
    '@gitroom/backend/public-api/routes/v1/public.integrations.controller'
  );
  const { MediaService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.service'
  );
  const { MediaController } = await import(
    '@gitroom/backend/api/routes/media.controller'
  );
  const { ThirdPartyController } = await import(
    '@gitroom/backend/api/routes/third-party.controller'
  );
  const { ThirdPartyManager } = await import(
    '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager'
  );
  const { AuthService } = await import('@gitroom/helpers/auth/auth.service');
  vi.stubEnv('JWT_SECRET', 'fixture-key');
  const thirdParty = {
    getIntegrationById: async () => ({
      identifier: 'test',
      apiKey: AuthService.fixedEncryption('test'),
    }),
    getThirdPartyByName: () => ({
      instance: {
        importMedia: async () => [
          { name: 'Original artwork', url: source + '/art.png' },
        ],
      },
    }),
  };
  const { SubscriptionService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service'
  );
  const { MediaRepository } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.repository'
  );
  const { PublicAuthMiddleware } = await import(
    '@gitroom/backend/services/auth/public.auth.middleware'
  );

  const repository = new MediaRepository({
    model: {
      media: {
        create: async ({ data }: any) => {
          const id = 'media-' + owners.size;
          owners.set(id, data.organization.connect.id);
          return {
            id,
            name: data.name,
            path: data.path,
            originalName: data.originalName,
            status: 'ready',
            thumbnail: null,
            alt: null,
          };
        },
      },
    },
  } as any);
  const credits = {
    checkCredits: async () => ({ credits: 5 }),
    useCredit: async (
      _org: unknown,
      _product: string,
      generate: () => Promise<any>
    ) => generate(),
  };
  const { ImagesSlides } = await import(
    '@gitroom/nestjs-libraries/videos/images-slides/images.slides'
  );
  const slides = new ImagesSlides(
    {
      generateSlidesFromText: async () => [
        { imagePrompt: 'sailboat', voiceText: 'A sailboat' },
      ],
    } as any,
    { generateImageFromText: async () => source + '/slide.jpg' } as any
  );
  const media = new MediaService(
    repository,
    {
      generatePromptForPicture: async (s: string) => s,
      generateImage: async () => png.toString('base64'),
    } as any,
    credits as any,
    { getVideoByName: () => ({ instance: slides, trial: true }) } as any,
    { client: { getRawClient: () => undefined } } as any
  );
  const { VideoActivity } = await import(
    '../apps/orchestrator/src/activities/video.activity'
  );
  video = new VideoActivity(media, {
    getOrgByIdWithSubscription: async (id: string) => ({ id }),
  } as any);
  const module = await Test.createTestingModule({
    controllers: [
      PublicIntegrationsController,
      MediaController,
      ThirdPartyController,
    ],
    providers: [
      { provide: MediaService, useValue: media },
      { provide: SubscriptionService, useValue: credits },
      { provide: ThirdPartyManager, useValue: thirdParty },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  app = module.createNestApplication({ logger: false });
  const auth = new PublicAuthMiddleware(
    {
      getOrgByApiKey: async (key: string) =>
        key === 'valid-key' ? { id: 'org-api', subscription: {} } : null,
    } as any,
    {} as any
  );
  app.use(auth.use.bind(auth));
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await storage?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function post(endpoint: string, body: object) {
  return fetch(baseUrl + endpoint, {
    method: 'POST',
    headers: { authorization: 'valid-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function checkMedia(
  record: any,
  organization: string,
  bytes: Buffer,
  type: string
) {
  expect(record).toEqual({
    id: expect.any(String),
    name: expect.any(String),
    path: storage.origin + '/postiz/dev/' + organization + '/' + record.name,
    originalName: null,
    status: 'ready',
    thumbnail: null,
    alt: null,
  });
  await checkBlob(record, organization, bytes, type);
}

async function checkBlob(
  record: { id?: string; path?: string },
  organization: string,
  bytes: Buffer,
  type: string
) {
  expect(owners.get(record.id!)).toBe(organization);
  const url = new URL(record.path!);
  expect(url.origin).toBe(storage.origin);
  expect(url.pathname.split('/').slice(0, -1)).toEqual([
    '',
    'postiz',
    'dev',
    organization,
  ]);
  expect(url.pathname.split('/').pop()).toMatch(/^[\w-]+\.[a-z0-9]+$/);
  expect(url.search).toBe('');
  const read = await fetch(url);
  expect(read.status).toBe(200);
  expect(read.headers.get('content-type')).toBe(type);
  expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
}

it('imports an image under the API-key organization and returns its anonymously readable ready record', async () => {
  remote.set(
    '/image.jpg',
    () =>
      new Response(new Uint8Array(png), {
        headers: { 'content-type': 'image/jpeg' },
      })
  );
  const response = await post('/public/v1/upload-from-url', {
    url: source + '/image.jpg',
    adjust: true,
    merchantId: 'another-merchant',
  });
  expect(response.status).toBe(201);
  const record = await response.json();
  expect(record.name).toMatch(/\.png$/);
  await checkMedia(record, 'org-api', png, 'image/png');
});

it('imports an uncompressed TIFF and serves its complete original bytes', async () => {
  const bytes = await endDirectoryTiff();
  remote.set('/image.tif', () => new Response(new Uint8Array(bytes)));
  const response = await post('/public/v1/upload-from-url', {
    url: source + '/image.tif',
  });
  expect(response.status).toBe(201);
  await checkMedia(await response.json(), 'org-api', bytes, 'image/tiff');
});

it('preserves the import error response without committing a blob or registering failed media', async () => {
  const before = [storage.committed.size, owners.size];
  remote.set('/text.jpg', () => new Response('not an image'));
  remote.set('/oversize.png', () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    png.copy(oversized);
    return new Response(new Uint8Array(oversized), {
      headers: { 'content-length': '1' },
    });
  });
  for (const [file, msg] of [
    ['/missing.png', 'Failed to fetch URL'],
    ['/text.jpg', 'Unsupported file type.'],
    ['/oversize.png', 'File is too large.'],
  ]) {
    const result = await post('/public/v1/upload-from-url', {
      url: source + file,
    });
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ msg });
  }
  const invalid = await post('/public/v1/upload-from-url', {
    url: 'http://203.0.113.30/image.jpg',
  });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).message).toContain(
    'URL must be a public HTTPS URL and cannot point to internal network addresses'
  );
  expect([storage.committed.size, owners.size]).toEqual(before);
});

it('saves the generated image under the requesting organization', async () => {
  const response = await post('/media/generate-image-with-prompt', {
    prompt: 'A sailboat',
    merchantId: 'another-merchant',
  });
  expect(response.status).toBe(201);
  await checkMedia(await response.json(), 'org-api', png, 'image/png');
});

it('renders narrated slides with a readable MP3 and registers the finished MP4 for the workflow organization', async () => {
  const mp3 = readFileSync(
    new URL('./fixtures/short-silence.mp3', import.meta.url)
  );
  const mp4 = readFileSync(
    new URL('./fixtures/one-frame.mp4', import.meta.url)
  );
  remote.set(
    '/v1/text-to-speech/voice-1',
    () => new Response(new Uint8Array(mp3))
  );
  remote.set('/render.mp4', () => new Response(new Uint8Array(mp4)));
  const { default: Transloadit } = await import('transloadit');
  const render = vi
    .spyOn(Transloadit.prototype, 'createAssembly')
    .mockImplementation(async (options: any) => {
      const url = new URL(options.params.steps.audio0.url);
      expect(url.origin).toBe(storage.origin);
      expect(url.pathname).toMatch(/^\/postiz\/dev\/org-video\/[\w-]+\.mp3$/);
      expect(url.search).toBe('');
      const audio = await fetch(url);
      expect(audio.headers.get('content-type')).toBe('audio/mpeg');
      expect(Buffer.from(await audio.arrayBuffer())).toEqual(mp3);
      return {
        results: { subtitled: [{ url: source + '/render.mp4' }] },
      } as any;
    });
  try {
    const record = await video.generateVideo('org-video', {
      type: 'image-text-slides',
      output: 'vertical',
      customParams: {
        voice: 'voice-1',
        prompt: 'sailboat',
        merchantId: 'another-merchant',
      },
    });
    expect(render).toHaveBeenCalledOnce();
    await checkMedia(record, 'org-video', mp4, 'video/mp4');
  } finally {
    render.mockRestore();
  }
});

it('keeps copied channel avatars under the connected organization during login and page selection', async () => {
  const { IntegrationService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service'
  );
  const { IntegrationRepository } = await import(
    '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository'
  );
  const { EncryptionService } = await import(
    '@gitroom/nestjs-libraries/services/encryption.service'
  );
  const data = {
    id: 'channel',
    organizationId: 'org-channel',
    internalId: 'user',
    inBetweenSteps: true,
    providerIdentifier: 'youtube',
  };
  let current: any;
  const repository = new IntegrationRepository(
    {
      model: {
        integration: {
          findFirst: async () => current,
          findUnique: async () => null,
          upsert: async ({ create }: any) => (current = { ...data, ...create }),
          update: async ({ data }: any) => (current = { ...current, ...data }),
          updateMany: async () => ({ count: 0 }),
        },
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new EncryptionService()
  );
  const service = new IntegrationService(
    repository,
    {} as any,
    {
      getSocialIntegration: () => ({
        fetchPageInformation: async () => ({
          id: 'page-123',
          name: 'My page',
          picture: source + '/avatar.png',
        }),
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  remote.set('/avatar.png', () => new Response(new Uint8Array(png)));
  const login = await service.createOrUpdateIntegration(
    undefined,
    false,
    'org-channel',
    'My channel',
    source + '/avatar.png',
    'social',
    'user',
    'youtube',
    'token',
    undefined,
    undefined,
    undefined,
    true
  );
  async function expectAvatar(path: string) {
    expect(path).toMatch(
      /^https:\/\/127\.0\.0\.1:\d+\/postiz\/dev\/org-channel\/[\w-]+\.png$/
    );
    const read = await fetch(path);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
  }
  await expectAvatar(login.picture!);
  await service.saveProviderPage('org-channel', login.id, {
    id: 'page-123',
    merchantId: 'another-merchant',
  });
  await expectAvatar(current.picture);
  expect(current.picture).not.toBe(login.picture);
});

it('preserves the third-party item name while storing its bytes under a server-generated key', async () => {
  remote.set('/art.png', () => new Response(new Uint8Array(png)));
  const response = await post('/third-party/app/import', {
    items: [{ name: 'selected', url: source + '/art.png' }],
    merchantId: 'another-merchant',
  });
  expect(response.status).toBe(201);
  const [record] = await response.json();
  expect(record.name).toBe('Original artwork');
  await checkBlob(record, 'org-api', png, 'image/png');
});

it('rejects a third-party import exceeding the image limit even with a short declared length', async () => {
  const before = [storage.committed.size, owners.size];
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
  png.copy(oversized);
  remote.set(
    '/art.png',
    () => new Response(oversized, { headers: { 'content-length': '1' } })
  );
  const response = await post('/third-party/app/import', {
    items: [{ name: 'selected', url: source + '/art.png' }],
  });
  expect(response.status).toBe(400);
  expect((await response.json()).message).toBe('File is too large.');
  expect([storage.committed.size, owners.size]).toEqual(before);
});

it('uses the MCP authentication context for generated and imported media', async () => {
  const { GenerateImageTool } = await import(
    '@gitroom/nestjs-libraries/chat/tools/generate.image.tool'
  );
  const { UploadFromUrlTool } = await import(
    '@gitroom/nestjs-libraries/chat/tools/upload.from.url.tool'
  );
  const { MediaService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.service'
  );
  const { SubscriptionService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service'
  );
  const media = app.get(MediaService);
  const context = {
    mcp: { extra: { authInfo: { id: 'org-mcp' } } },
    requestContext: new Map(),
  } as any;
  const generate = new GenerateImageTool(
    media,
    app.get(SubscriptionService)
  ).run();
  const generated = await generate.execute!({ prompt: 'Sailboat' }, context);
  expect(generated).toEqual({
    id: expect.any(String),
    path: expect.any(String),
  });
  await checkBlob(generated, 'org-mcp', png, 'image/png');
  remote.set('/tool.png', () => new Response(new Uint8Array(png)));
  const importer = new UploadFromUrlTool(media).run();
  const imported = await importer.execute!(
    { url: source + '/tool.png' },
    context
  );
  expect(imported).toEqual({
    id: expect.any(String),
    path: expect.any(String),
    status: 'ready',
  });
  await checkBlob(imported, 'org-mcp', png, 'image/png');
});
