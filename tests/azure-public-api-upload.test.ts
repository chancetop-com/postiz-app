import { endDirectoryTiff } from './azure-tiff.fixture';
import { startAzureMediaStorage } from './azure-media-storage.fixture';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
let storage: Awaited<ReturnType<typeof startAzureMediaStorage>>;
let app: INestApplication;
let baseUrl: string;
const savedOrganizations: string[] = [];

beforeAll(async () => {
  storage = await startAzureMediaStorage();
  vi.stubEnv('RUNPOD_API_KEY', 'configured');
  vi.stubEnv('RUNPOD_ENDPOINT_ID', 'configured');

  const { Test } = await import('@nestjs/testing');
  const { PublicIntegrationsController } = await import(
    '@gitroom/backend/public-api/routes/v1/public.integrations.controller'
  );
  const { PublicAuthMiddleware } = await import(
    '@gitroom/backend/services/auth/public.auth.middleware'
  );
  const { MediaService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.service'
  );
  const { MediaRepository } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.repository'
  );
  const repository = new MediaRepository({
    model: {
      media: {
        create: async ({ data }: any) => {
          savedOrganizations.push(data.organization.connect.id);
          return {
            id: 'media-' + savedOrganizations.length,
            name: data.name,
            path: data.path,
            originalName: data.originalName,
            thumbnail: null,
            alt: null,
            status: 'ready',
          };
        },
      },
    },
  } as any);
  const media = new MediaService(
    repository,
    {} as any,
    {} as any,
    {} as any,
    {
      client: {
        getRawClient: () => ({
          workflow: {
            start: () => {
              throw Error('unexpected normalization');
            },
          },
        }),
      },
    } as any
  );
  const module = await Test.createTestingModule({
    controllers: [PublicIntegrationsController],
    providers: [{ provide: MediaService, useValue: media }],
  })
    .useMocker(() => ({}))
    .compile();
  app = module.createNestApplication({ logger: false });
  const auth = new PublicAuthMiddleware(
    {
      getOrgByApiKey: async (key: string) =>
        key === 'upload-key' ? { id: 'org-api', subscription: {} } : null,
    } as any,
    {} as any
  );
  app.use(auth.use.bind(auth));
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await storage?.close();
  vi.unstubAllEnvs();
});

function upload(bytes: Buffer, key = 'upload-key') {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
    'client-name.bin'
  );
  form.append('merchantId', 'other-merchant');
  form.append('adjust', 'true');
  return fetch(baseUrl + '/public/v1/upload', {
    method: 'POST',
    headers: { authorization: key },
    body: form,
  });
}

it('returns a ready media record and anonymously serves the original bytes under the API key organization', async () => {
  const response = await upload(png);
  expect(response.status).toBe(201);
  const record = await response.json();
  expect(savedOrganizations.at(-1)).toBe('org-api');
  expect(record).toEqual({
    id: expect.any(String),
    name: expect.stringMatching(/^[\w-]+\.png$/),
    path: storage.origin + '/postiz/dev/org-api/' + record.name,
    originalName: null,
    thumbnail: null,
    alt: null,
    status: 'ready',
  });
  const read = await fetch(record.path);
  expect(read.status).toBe(200);
  expect(read.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
});

it('rejects an image past the streaming limit without committing a partial Blob or media record', async () => {
  const before = {
    blobs: storage.committed.size,
    records: savedOrganizations.length,
  };
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  png.copy(bytes);
  const response = await upload(bytes);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    message: 'File is too large.',
  });
  expect({
    blobs: storage.committed.size,
    records: savedOrganizations.length,
  }).toEqual(before);
});

it('rejects an invalid API key and unsupported content before storing a record', async () => {
  const before = {
    blobs: storage.committed.size,
    records: savedOrganizations.length,
  };
  expect((await upload(png, 'unknown-key')).status).toBe(401);
  const response = await upload(Buffer.from('not media'));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    message: 'Unsupported file type.',
  });
  expect({
    blobs: storage.committed.size,
    records: savedOrganizations.length,
  }).toEqual(before);
});

it.each([
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['tiff', 'image/tiff'],
  ['mp4', 'video/mp4'],
  ['png', 'image/png'],
] as const)(
  'serves the uploaded %s bytes with the detected Content-Type',
  async (format, mime) => {
    let bytes: Buffer;
    if (format === 'mp4' || format === 'png') {
      // Exercise a multi-block commit and the inclusive 10 MiB image limit.
      bytes = Buffer.alloc(10 * 1024 * 1024 + (format === 'mp4' ? 1 : 0));
      (format === 'mp4'
        ? Buffer.from(
            '000000186674797069736f6d0000020069736f6d69736f32617663316d703431',
            'hex'
          )
        : png
      ).copy(bytes);
      bytes.fill(0x42, 6 * 1024 * 1024);
    } else if (format === 'tiff') {
      bytes = await endDirectoryTiff();
    } else if (format === 'bmp') {
      bytes = Buffer.from(
        '424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000ffffff00',
        'hex'
      );
    } else {
      const { default: sharp } = await import('sharp');
      bytes = await sharp({
        create: { width: 1, height: 1, channels: 3, background: 'red' },
      })
        .toFormat(format)
        .toBuffer();
    }
    const uploaded = await upload(bytes);
    expect(uploaded.status).toBe(201);
    const record = await uploaded.json();
    const read = await fetch(record.path);
    expect(read.headers.get('content-type')).toBe(mime);
    expect(Buffer.compare(Buffer.from(await read.arrayBuffer()), bytes)).toBe(
      0
    );
  }
);

// Streams two 1 GiB bodies across the HTTP boundaries. Enable explicitly for
// release validation so the routine test suite stays lightweight.
it.runIf(process.env.AZURE_UPLOAD_LARGE_VIDEO_TEST === '1')(
  'accepts exactly 1 GiB of MP4 and rejects the next byte',
  async () => {
    const boundary = 'video-size-limit';
    const size = 1024 ** 3;
    async function postVideo(extraByte: boolean) {
      const chunk = Buffer.alloc(1024 * 1024);
      const first = Buffer.from(chunk);
      Buffer.from(
        '000000186674797069736f6d0000020069736f6d69736f32617663316d703431',
        'hex'
      ).copy(first);
      async function* multipart() {
        yield Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
        );
        yield first;
        for (let sent = first.length; sent < size; sent += chunk.length)
          yield chunk;
        if (extraByte) yield Buffer.alloc(1);
        yield Buffer.from(`\r\n--${boundary}--\r\n`);
      }
      return fetch(baseUrl + '/public/v1/upload', {
        method: 'POST',
        headers: {
          authorization: 'upload-key',
          'content-type': 'multipart/form-data; boundary=' + boundary,
        },
        body: Readable.from(multipart()),
        duplex: 'half',
      } as unknown as RequestInit);
    }
    const exact = await postVideo(false);
    expect(exact.status).toBe(201);
    const record = await exact.json();
    const parts =
      storage.committed.get(new URL(record.path).pathname)?.parts || [];
    expect(parts.reduce((total, part) => total + part.length, 0)).toBe(size);
    const before = {
      blobs: storage.committed.size,
      records: savedOrganizations.length,
    };
    const over = await postVideo(true);
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ message: 'File is too large.' });
    expect({
      blobs: storage.committed.size,
      records: savedOrganizations.length,
    }).toEqual(before);
  },
  180_000
);
