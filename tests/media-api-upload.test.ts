import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';

/**
 * Ticket 10: the media upload endpoint keeps its identity, response and limits.
 *
 * A real Nest HTTP app runs the shipped controller, multer stream engine and
 * local storage; only the database (MediaService) and the org resolution that a
 * guard would normally do are replaced. The client-side upload path is covered
 * in `media-library.test.tsx`.
 */

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let root: string;
let app: INestApplication;
let baseUrl: string;
const savedCalls: { org: string; fileName: string; filePath: string; originalName?: string }[] = [];
const originalEnv = { ...process.env };

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'postiz-media-api-'));
  process.env.UPLOAD_DIRECTORY = root;
  process.env.FRONTEND_URL = 'http://localhost:4200';
  process.env.STORAGE_PROVIDER = 'local';

  const { Test } = await import('@nestjs/testing');
  const { MediaController } = await import(
    '@gitroom/backend/api/routes/media.controller'
  );
  const { MediaService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.service'
  );
  const { SubscriptionService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service'
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [
      {
        provide: MediaService,
        useValue: {
          saveFile: (
            org: string,
            fileName: string,
            filePath: string,
            originalName?: string
          ) => {
            savedCalls.push({ org, fileName, filePath, originalName });
            return {
              id: 'saved-1',
              name: fileName,
              path: filePath,
              originalName: originalName || null,
              status: 'ready',
            };
          },
        },
      },
      { provide: SubscriptionService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication({ logger: false });
  // the shipped app resolves `request.org` before the controller; the test
  // provides the same shape from the organization header
  app.use((req: any, _res: any, next: () => void) => {
    req.org = { id: req.headers.showorg };
    next();
  });
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  process.env = { ...originalEnv };
  rmSync(root, { recursive: true, force: true });
});

const filesUnder = () =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

const upload = (file: Blob | null, org = 'org-a') => {
  const form = new FormData();
  if (file) {
    form.append('file', file, 'legacy.png');
  }
  return fetch(`${baseUrl}/media/upload-server`, {
    method: 'POST',
    body: form,
    headers: { showorg: org, auth: 'jwt-a' },
  });
};

describe('POST /media/upload-server', () => {
  it('stores a new upload for the session organization', async () => {
    savedCalls.length = 0;
    const response = await upload(
      new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: 'image/png' }),
      'org-a'
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.path).toMatch(
      /^http:\/\/localhost:4200\/uploads\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{32,}\.png$/
    );

    expect(savedCalls).toHaveLength(1);
    expect(savedCalls[0].org).toBe('org-a');
    expect(savedCalls[0].fileName).toMatch(/^[0-9a-f]{32,}\.png$/);
    expect(savedCalls[0].filePath).toBe(body.path);
    expect(savedCalls[0].originalName).toBe('legacy.png');

    const onDisk = savedCalls[0].filePath.replace(
      'http://localhost:4200/uploads',
      root
    );
    expect(readFileSync(onDisk)).toEqual(ONE_PIXEL_PNG);
  });

  it('serves the new upload back through the public uploads route', async () => {
    const uploaded = await upload(
      new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: 'image/png' })
    );
    const body = await uploaded.json();
    const relative = body.path.replace('http://localhost:4200/uploads/', '');

    const { NextRequest } = await import('next/server');
    const { GET } = await import(
      '@gitroom/frontend/app/(app)/api/uploads/[[...path]]/route'
    );
    const response = await GET(
      new NextRequest(`http://localhost:4200/api/uploads/${relative}`),
      { params: Promise.resolve({ path: relative.split('/') }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(ONE_PIXEL_PNG);
  });

  it('rejects a request without a file', async () => {
    const response = await upload(null);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'No file provided' });
  });

  it('rejects a file whose real type is not allowed', async () => {
    savedCalls.length = 0;
    const before = filesUnder();
    const response = await upload(
      new Blob([new Uint8Array(Buffer.from('<html>not media</html>'))], {
        type: 'image/png',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: 'Unsupported file type.',
    });
    expect(savedCalls).toHaveLength(0);
    expect(filesUnder()).toEqual(before);
  });

  it('rejects an image over the 10 MB cap before saving it', async () => {
    savedCalls.length = 0;
    const oversized = Buffer.concat([
      ONE_PIXEL_PNG,
      Buffer.alloc(10 * 1024 * 1024),
    ]);

    const response = await upload(new Blob([new Uint8Array(oversized)]));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'File is too large.' });
    expect(savedCalls).toHaveLength(0);
  });
});
