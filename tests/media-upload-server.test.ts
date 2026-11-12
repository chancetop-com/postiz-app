import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';

/**
 * Ticket 10: new uploads write to the same local layout as the old files.
 *
 * The storage provider, the streaming upload validation and the multer engine
 * are the shipped ones writing real bytes to a temp directory; only the
 * database and the HTTP transport are replaced. The repository assertions are
 * on its public methods with the Prisma model as the boundary, so the media
 * row keeps the organization scope, the stored path and the soft-delete rule.
 */

import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';
import {
  getMaxSize,
  uploadStreamToStorage,
} from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { MulterStreamEngine } from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2avc1mp41'),
  Buffer.from('legacy-video-body'),
]);

let root: string;
const originalEnv = { ...process.env };

const bytes = (buffer: Buffer) => new Blob([new Uint8Array(buffer)]).stream();

// a rejected stream may leave the date folder behind, but never a file
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'postiz-media-write-'));
  process.env.UPLOAD_DIRECTORY = root;
  process.env.FRONTEND_URL = 'http://localhost:4200';
});

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(root, { recursive: true, force: true });
});

describe('local upload writes', () => {
  it('stores a new image under the existing /uploads/YYYY/MM/DD layout', async () => {
    const storage = new LocalStorage(root);
    const uploaded = await uploadStreamToStorage(storage, bytes(ONE_PIXEL_PNG));

    const now = new Date();
    const dir = `/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(
      2,
      '0'
    )}/${String(now.getDate()).padStart(2, '0')}`;

    expect(uploaded.ext).toBe('png');
    expect(uploaded.mimetype).toBe('image/png');
    expect(uploaded.filename).toMatch(/^[0-9a-f]{32,}\.png$/);
    expect(uploaded.path).toBe(
      `http://localhost:4200/uploads${dir}/${uploaded.filename}`
    );

    const onDisk = path.join(root, dir, uploaded.filename);
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk)).toEqual(ONE_PIXEL_PNG);
  });

  it('accepts a video at the unchanged 1 GB limit', async () => {
    expect(getMaxSize('video/mp4')).toBe(1024 * 1024 * 1024);
    expect(getMaxSize('image/png')).toBe(10 * 1024 * 1024);

    const storage = new LocalStorage(root);
    const uploaded = await uploadStreamToStorage(storage, bytes(MP4));
    expect(uploaded.ext).toBe('mp4');
    expect(uploaded.path).toMatch(/^http:\/\/localhost:4200\/uploads\/.*\.mp4$/);
  });

  it('rejects an image over the 10 MB limit and leaves no file behind', async () => {
    const storage = new LocalStorage(root);
    const oversized = Buffer.concat([
      ONE_PIXEL_PNG,
      Buffer.alloc(10 * 1024 * 1024),
    ]);

    await expect(
      uploadStreamToStorage(storage, bytes(oversized))
    ).rejects.toThrow(BadRequestException);
    await expect(
      uploadStreamToStorage(storage, bytes(oversized))
    ).rejects.toThrow('File is too large.');

    expect(filesUnder(root)).toEqual([]);
  });

  it('rejects content whose real type is not an allowed media type', async () => {
    const storage = new LocalStorage(root);
    const html = Buffer.from('<html><script>alert(1)</script></html>');

    await expect(uploadStreamToStorage(storage, bytes(html))).rejects.toThrow(
      'Unsupported file type.'
    );
    expect(filesUnder(root)).toEqual([]);
  });
});

describe('multer engine used by the upload route', () => {
  it('hands the route a stored name, public path and the sender name', async () => {
    const storage = new LocalStorage(root);
    const engine = new MulterStreamEngine(storage);

    const info = await new Promise<any>((resolve, reject) => {
      engine._handleFile(
        {} as any,
        {
          stream: Readable.from(ONE_PIXEL_PNG),
          originalname: 'My Legacy Photo.PNG',
        } as any,
        (error: any, uploaded: any) => (error ? reject(error) : resolve(uploaded))
      );
    });

    expect(info.filename).toMatch(/^[0-9a-f]{32,}\.png$/);
    expect(info.path).toContain('/uploads/');
    expect(info.mimetype).toBe('image/png');
    // the sender's base name survives, the extension comes from the bytes
    expect(info.originalname).toBe('My Legacy Photo.png');
    const onDisk = info.path.replace('http://localhost:4200/uploads', root);
    expect(readFileSync(onDisk)).toEqual(ONE_PIXEL_PNG);
  });
});

const fakeModel = () => {
  const calls: { method: string; args: any }[] = [];
  const record = (method: string, result: any) => (args: any) => {
    calls.push({ method, args });
    return Promise.resolve(result);
  };
  const model = {
    media: {
      create: record('create', { id: 'new-1', path: 'p' }),
      update: record('update', { id: 'old-1' }),
      findFirst: record('findFirst', { id: 'old-1' }),
      findMany: record('findMany', []),
      count: record('count', 0),
      findUnique: record('findUnique', null),
    },
  };
  return { model, calls };
};

describe('media records stay organization scoped', () => {
  it('saves a new file for the requesting organization', async () => {
    const { model, calls } = fakeModel();
    const repository = new MediaRepository({ model } as any);

    await repository.saveFile(
      'org-a',
      '2026/11/11/fresh.png',
      'http://localhost:4200/uploads/2026/11/11/fresh.png',
      'fresh.png'
    );

    const create = calls.find((call) => call.method === 'create')!;
    expect(create.args.data).toMatchObject({
      organization: { connect: { id: 'org-a' } },
      name: '2026/11/11/fresh.png',
      path: 'http://localhost:4200/uploads/2026/11/11/fresh.png',
      originalName: 'fresh.png',
    });
  });

  it('lists and deletes only the organization own non-deleted media', async () => {
    const { model, calls } = fakeModel();
    const repository = new MediaRepository({ model } as any);

    await repository.getMedia('org-a', 1, 'legacy');
    // reading the library never rewrites a media row or its path
    expect(calls.some((call) => call.method === 'update' || call.method === 'create')).toBe(
      false
    );
    const findMany = calls.find((call) => call.method === 'findMany')!;
    expect(findMany.args.where).toMatchObject({
      organizationId: 'org-a',
      deletedAt: null,
      status: { not: 'processing' },
      originalName: { contains: 'legacy', mode: 'insensitive' },
    });

    await repository.deleteMedia('org-a', 'media-old-1');
    const update = calls.find((call) => call.method === 'update')!;
    expect(update.args.where).toEqual({
      id: 'media-old-1',
      organizationId: 'org-a',
    });
    expect(update.args.data.deletedAt).toBeInstanceOf(Date);

    await repository.getMediaStatus('org-a', 'media-old-1');
    const findFirst = calls.find((call) => call.method === 'findFirst')!;
    expect(findFirst.args.where).toEqual({
      id: 'media-old-1',
      organizationId: 'org-a',
      deletedAt: null,
    });
  });

  it('records the upload under the caller organization through the service', async () => {
    const { model, calls } = fakeModel();
    const repository = new MediaRepository({ model } as any);
    const service = new MediaService(
      repository,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.saveFile(
      'org-b',
      '2026/11/11/fresh.png',
      'http://localhost:4200/uploads/2026/11/11/fresh.png',
      'fresh.png'
    );

    const create = calls.find((call) => call.method === 'create')!;
    expect(create.args.data.organization.connect.id).toBe('org-b');
  });
});
