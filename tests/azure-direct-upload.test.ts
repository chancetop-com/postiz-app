import { endDirectoryTiff } from './azure-tiff.fixture';
import { BlockBlobClient } from '@azure/storage-blob';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  bundleDirectPicker,
  openDirectPicker,
} from './azure-direct-picker.fixture';
import { startDirectUploadApp } from './azure-direct-app.fixture';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const databaseUrl = process.env.AZURE_CONFIRM_TEST_DATABASE_URL;
let server: Awaited<ReturnType<typeof startDirectUploadApp>>;
let merchantId: string;
let otherMerchantId: string;
let originUrl: string;
let db: typeof server.db;
let origin: typeof server.origin;
let library: typeof server.library;
let post: typeof server.post;

beforeAll(async () => {
  server = await startDirectUploadApp();
  ({ merchantId, otherMerchantId, db, origin, library, post } = server);
  originUrl = origin.url;
}, 60000);
afterAll(() => server?.close());

const request = {
  name: 'holiday.png',
  size: png.length,
  contentType: 'image/png',
  purpose: 'media',
};
it('issues two-hour, create-only access to a single blob under the authenticated organization for local and SSO sessions', async () => {
  for (const authenticatedId of [merchantId, otherMerchantId]) {
    const requestedAt = Date.now();
    const res = await post(
      '',
      { ...request, merchantId: 'forged-merchant', key: 'outside.png' },
      authenticatedId
    );
    expect(res.status).toBe(201);
    const grant = await res.json();
    expect(grant.uploadId).toEqual(expect.any(String));
    const url = new URL(grant.uploadUrl);
    const publicUrl = url.origin + url.pathname;
    expect((await fetch(publicUrl)).status).toBe(404);
    expect(url.pathname.split('/').pop()).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(url.searchParams.get('sv')! >= '2026-04-06').toBe(true);
    expect(url.pathname).toMatch(
      new RegExp('^/postiz/dev/' + authenticatedId + '/')
    );
    expect(url.pathname).not.toContain('holiday');
    expect(url.searchParams.get('sr')).toBe('b');
    expect(url.searchParams.get('sp')).toBe('c');
    expect(url.searchParams.get('spr')).toBe('https');
    const expiresAt = Date.parse(url.searchParams.get('se')!);
    const twoHours = 2 * 60 * 60 * 1000;
    // Azure encodes SAS timestamps to the second.
    expect(expiresAt).toBeGreaterThanOrEqual(
      Math.floor(requestedAt / 1000) * 1000 + twoHours
    );
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + twoHours);
  }
});

it.runIf(databaseUrl)(
  'serves the final public link before confirmation while rejected bytes stay out of the media library',
  async () => {
    const before = await library();
    const { uploadUrl, uploadId } = await (await post('', request)).json();
    const blob = new BlockBlobClient(uploadUrl);
    const anonymous = new URL(uploadUrl);
    anonymous.search = '';
    const bytes = Buffer.alloc(png.length, 0x42);
    await blob.uploadData(bytes);
    expect(Buffer.from(await (await fetch(anonymous)).arrayBuffer())).toEqual(
      bytes
    );
    expect((await post('/' + uploadId + '/confirm', request)).status).toBe(400);
    expect(Buffer.from(await (await fetch(anonymous)).arrayBuffer())).toEqual(
      bytes
    );
    expect(await library()).toEqual(before);
  }
);

it('refuses cross-merchant, missing, uncommitted and invalid blobs', async () => {
  const { uploadId, uploadUrl } = await (await post('', request)).json();
  const confirm = '/' + uploadId + '/confirm';
  const blob = new BlockBlobClient(uploadUrl);
  expect((await post(confirm, request)).status).toBe(404);
  await blob.stageBlock(Buffer.from('one').toString('base64'), png, png.length);
  expect((await post(confirm, request)).status).toBe(404);
  await blob.uploadData(png);
  expect((await post(confirm, request, otherMerchantId)).status).toBe(404);

  const gif = Buffer.alloc(png.length);
  gif.write('GIF89a');
  for (const bytes of [Buffer.from('invalid'), gif, Buffer.alloc(png.length)]) {
    const grant = await (await post('', request)).json();
    await new BlockBlobClient(grant.uploadUrl).uploadData(bytes);
    expect(
      (await post('/' + grant.uploadId + '/confirm', request)).status
    ).toBe(400);
  }
  if (db) expect((await library()).results).toHaveLength(0);
});

it.runIf(databaseUrl)(
  'returns one durable media row on concurrent and repeated confirmations',
  async () => {
    const { uploadId, uploadUrl } = await (await post('', request)).json();
    const blob = new BlockBlobClient(uploadUrl);
    await blob.uploadData(png, {
      blobHTTPHeaders: { blobContentType: 'text/html' },
    });
    const confirm = () => post('/' + uploadId + '/confirm', request);
    const responses = await Promise.all(Array.from({ length: 8 }, confirm));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    const records = await Promise.all(responses.map((r) => r.json()));
    const saved = records[0];
    for (const record of records) expect(record).toEqual(saved);
    expect(saved).toEqual({
      id: expect.any(String),
      name: expect.stringMatching(/^[\w-]+\.png$/),
      originalName: request.name,
      path: originUrl + '/postiz/dev/' + merchantId + '/' + saved.name,
      thumbnail: null,
      alt: null,
      status: 'ready',
    });
    expect((await library()).results.map((row: any) => row.id)).toEqual([
      saved.id,
    ]);
    expect(saved.path).toBe(
      new URL(uploadUrl).origin + new URL(uploadUrl).pathname
    );
    expect(await (await confirm()).json()).toEqual(saved);
    const read = await fetch(saved.path);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
  }
);

it.runIf(databaseUrl)(
  'confirms an uncompressed TIFF with its image directory near the end of the file',
  async () => {
    const bytes = await endDirectoryTiff();
    const grant = await (
      await post('', {
        ...request,
        name: 'image.tif',
        size: bytes.length,
        contentType: 'image/tiff',
      })
    ).json();
    await new BlockBlobClient(grant.uploadUrl).uploadData(bytes);
    const response = await post('/' + grant.uploadId + '/confirm', {
      ...request,
      name: 'image.tif',
      size: bytes.length,
      contentType: 'image/tiff',
    });
    expect(response.status).toBe(201);
    const read = await fetch((await response.json()).path);
    expect(read.headers.get('content-type')).toBe('image/tiff');
    expect(Buffer.compare(Buffer.from(await read.arrayBuffer()), bytes)).toBe(
      0
    );
  }
);

it.runIf(databaseUrl)(
  'confirms a thumbnail with a stable anonymous read URL and no media library entry',
  async () => {
    const before = await library();
    const { uploadId, uploadUrl } = await (
      await post('', { ...request, purpose: 'thumbnail' })
    ).json();
    await new BlockBlobClient(uploadUrl).uploadData(png);
    const result = await (
      await post('/' + uploadId + '/confirm', {
        ...request,
        purpose: 'thumbnail',
      })
    ).json();
    expect(result).toEqual({
      path: expect.stringContaining(
        originUrl + '/postiz/dev/' + merchantId + '/'
      ),
    });
    expect(Buffer.from(await (await fetch(result.path)).arrayBuffer())).toEqual(
      png
    );
    expect(await library()).toEqual(before);
  }
);

it.runIf(databaseUrl && process.env.AZURE_UPLOAD_TEST_CHROMIUM)(
  'uploads from the main Uppy picker in Chromium and previews the confirmed image without an upload credential',
  async () => {
    const { chromium } = await import('playwright');
    const bundle = await bundleDirectPicker();
    const browser = await chromium.launch({
      executablePath: process.env.AZURE_UPLOAD_TEST_CHROMIUM,
      headless: true,
    });
    try {
      const page = await browser.newPage({ ignoreHTTPSErrors: true });
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on('response', (response) =>
        errors.push(response.status() + ' ' + new URL(response.url()).pathname)
      );
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning')
          errors.push(
            msg
              .text()
              .replace(/\?[^'"]*/g, '?<redacted>')
              .slice(0, 750)
          );
      });
      page.on('requestfailed', (request) =>
        errors.push(
          request.failure()?.errorText + ' ' + new URL(request.url()).pathname
        )
      );
      page.on('pageerror', (error) => errors.push(error.message));
      const confirmations: string[] = [];
      await page.route('**/media/azure/uploads/*/confirm', async (route) => {
        confirmations.push(route.request().url());
        if (confirmations.length === 1) {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          await route.abort('connectionreset');
        } else await route.continue();
      });
      origin.loseNextCommitResponse();
      await openDirectPicker(page, server, bundle);
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles({
          name: 'from-picker.png',
          mimeType: 'image/png',
          buffer: png,
        })
        .catch((error) => {
          throw Error(errors.join(', ') || error.message);
        });
      await page
        .waitForFunction(() =>
          document
            .querySelector('output')
            ?.textContent?.includes('from-picker.png')
        )
        .catch((error) => {
          throw Error(errors.join(', ') || error.message);
        });
      const [saved] = JSON.parse(await page.locator('output').innerText());
      expect(confirmations).toHaveLength(2);
      expect(confirmations[0]).toBe(confirmations[1]);
      const read = await fetch(saved.path);
      expect(read.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
      expect(
        (await library()).results.some((row: any) => row.id === saved.id)
      ).toBe(true);
    } finally {
      await browser.close();
    }
  },
  60000
);

it.runIf(databaseUrl)(
  'recovers the already sealed bytes when media registration failed',
  async () => {
    const grant = await (
      await post('', { ...request, name: 'retry.png' })
    ).json();
    const confirm = () =>
      post('/' + grant.uploadId + '/confirm', {
        ...request,
        name: 'retry.png',
      });
    const blob = new BlockBlobClient(grant.uploadUrl);
    await blob.uploadData(png);
    // Induce a real primary-key conflict after storage has published. The
    // temporary conflicting row belongs to the other isolated test organization.
    await db!.media.create({
      data: {
        id: grant.uploadId,
        organizationId: otherMerchantId,
        name: 'existing',
        path: 'legacy',
      },
    });
    const before = await library();
    expect((await confirm()).status).toBe(409);
    expect(await library()).toEqual(before);
    await db!.media.delete({
      where: {
        id: grant.uploadId,
        organizationId: otherMerchantId,
      },
    });
    const response = await confirm();
    expect(response.status).toBe(201);
    const recovered = await response.json();
    expect(
      Buffer.from(await (await fetch(recovered.path)).arrayBuffer())
    ).toEqual(png);
    expect(await (await confirm()).json()).toEqual(recovered);
  }
);

it('rejects invalid type, purpose and size before granting authority', async () => {
  for (const fields of [
    { contentType: 'application/pdf' },
    { size: 0 },
    { purpose: 'unknown' },
    { size: 10 * 1024 * 1024 + 1 },
    { contentType: 'video/mp4', size: 1024 ** 3 + 1 },
    { purpose: 'thumbnail', contentType: 'video/mp4' },
  ])
    expect((await post('', { ...request, ...fields })).status).toBe(400);
});

it('binds the original grant fields to the final key and ignores browser-supplied Blob metadata', async () => {
  const thumbnail = { ...request, purpose: 'thumbnail' };
  const { uploadUrl, uploadId } = await (await post('', thumbnail)).json();
  const blob = new BlockBlobClient(uploadUrl);
  await blob.uploadData(png, {
    metadata: { purpose: 'media', postiz: 'confirmed' },
  });
  const confirm = '/' + uploadId + '/confirm';
  for (const changed of [
    { name: 'different.png' },
    { purpose: 'media' },
    { size: png.length + 1 },
    { contentType: 'image/jpeg' },
  ]) {
    expect((await post(confirm, { ...thumbnail, ...changed })).status).toBe(
      404
    );
  }
  const response = await post(confirm, thumbnail);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    path: new URL(uploadUrl).origin + new URL(uploadUrl).pathname,
  });
});

it('can confirm already committed bytes after SAS expiration while an unused grant leaves no file', async () => {
  const thumbnail = { ...request, purpose: 'thumbnail' };
  const grant = await (await post('', thumbnail)).json();
  const unused = await (await post('', request)).json();
  await new BlockBlobClient(grant.uploadUrl).uploadData(png);
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(
      Date.parse(new URL(unused.uploadUrl).searchParams.get('se')!) + 60000
    );
    expect(
      (await post('/' + unused.uploadId + '/confirm', request)).status
    ).toBe(404);
    const completed = await post('/' + grant.uploadId + '/confirm', thumbnail);
    expect(completed.status).toBe(201);
    const { path } = await completed.json();
    expect(Buffer.from(await (await fetch(path)).arrayBuffer())).toEqual(png);
  } finally {
    vi.useRealTimers();
  }
});
