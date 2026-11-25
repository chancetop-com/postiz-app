import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { startDirectBlobOrigin } from './azure-direct-blob.fixture';
import { startDirectUploadApp } from './azure-direct-app.fixture';
import {
  bundleDirectPicker,
  openDirectPicker,
} from './azure-direct-picker.fixture';

const MiB = 1024 ** 2;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function videoOfSize(size: number) {
  // An ISO BMFF free-space box pads the valid encoded video to the boundary.
  const video = readFileSync('tests/fixtures/blue-frame.mp4');
  const free = Buffer.alloc(size - video.length, 0x43);
  free.writeUInt32BE(free.length);
  free.write('free', 4);
  return Buffer.concat([video, free]);
}

type PickerFile = { name: string; mimeType: string; buffer: Buffer };
function select(page: Page, ...files: PickerFile[]) {
  return page.locator('input[type=file]').first().setInputFiles(files);
}

async function result(page: Page) {
  await page.waitForFunction(() =>
    document.querySelector('output')?.textContent?.startsWith('[')
  );
  return JSON.parse(await page.locator('output').innerText()) as {
    id: string;
    path: string;
    originalName: string;
  }[];
}

describe.runIf(
  process.env.AZURE_UPLOAD_TEST_CHROMIUM &&
    process.env.AZURE_CONFIRM_TEST_DATABASE_URL
)('media library picker', () => {
  let server: Awaited<ReturnType<typeof startDirectUploadApp>>;
  let browser: Browser;
  let bundle: string;
  let receive: NonNullable<
    Parameters<typeof startDirectBlobOrigin>[0]
  >['receive'];
  beforeAll(async () => {
    server = await startDirectUploadApp({
      receive: (url, bytes) => receive?.(url, bytes),
    });
    bundle = await bundleDirectPicker();
    browser = await chromium.launch({
      executablePath: process.env.AZURE_UPLOAD_TEST_CHROMIUM,
    });
  }, 60000);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  }, 60000);
  async function newPicker(settings = '') {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    page.setDefaultTimeout(45000);
    await openDirectPicker(page, server, bundle, settings);
    return page;
  }

  it('accepts every library image format from the file input', async () => {
    const bmp = Buffer.from(
      '424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000ffffff00',
      'hex'
    );
    const page = await newPicker();
    try {
      for (const format of [
        'avif',
        'bmp',
        'tiff',
        'jpeg',
        'png',
        'gif',
        'webp',
      ] as const) {
        const bytes =
          format === 'bmp'
            ? bmp
            : await sharp({
                create: {
                  width: format === 'tiff' ? 8000 : 4,
                  height: format === 'tiff' ? 6000 : 4,
                  channels: 3,
                  background: 'blue',
                },
              })
                .toFormat(format)
                .toBuffer();
        await openDirectPicker(page, server, bundle);
        await select(page, {
          name: 'pic.' + format,
          mimeType: 'image/' + format,
          buffer: bytes,
        });
        await page.waitForFunction(() => {
          return (
            document.querySelector('output')?.textContent?.startsWith('[') ||
            document.body.textContent?.includes('is not allowed')
          );
        });
        expect(await page.locator('body').innerText()).not.toContain(
          'is not allowed'
        );
        const [saved] = await result(page);
        if (format === 'tiff') {
          const preview = page.locator('img[data-library-preview]');
          await expect
            .poll(() =>
              preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)
            )
            .toBe(1280);
          const other = server.otherMerchantId;
          const forbidden = await fetch(
            server.baseUrl + '/media/' + saved.id + '/tiff-preview',
            {
              headers: { auth: server.sessions[other], showorg: other },
            }
          );
          expect(forbidden.status).toBe(404);
        }
        const read = await fetch(saved.path);
        expect(read.headers.get('content-type')).toBe('image/' + format);
        expect(sha(Buffer.from(await read.arrayBuffer()))).toBe(sha(bytes));
      }
    } finally {
      await page.close();
    }
  }, 90000);

  it('uploads files whose browser MIME is empty and rejects misleading extensions during confirmation', async () => {
    const jpeg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer();
    for (const [name, bytes, valid] of [
      ['camera.jpg', jpeg, true],
      ['movie.mp4', readFileSync('tests/fixtures/blue-frame.mp4'), true],
      ['wrong.mp4', jpeg, false],
    ] as const) {
      const page = await newPicker();
      try {
        const completed = page.waitForResponse(
          (r) =>
            r.url().endsWith('/confirm') ||
            (r.url().endsWith('/media/azure/uploads') && !r.ok())
        );
        await page
          .locator('input[type=file]')
          .first()
          .evaluate(
            (input: HTMLInputElement, file) => {
              const transfer = new DataTransfer();
              transfer.items.add(
                new File([Uint8Array.from(file.bytes)], file.name)
              );
              input.files = transfer.files;
              input.dispatchEvent(new Event('change', { bubbles: true }));
            },
            { name, bytes: [...bytes] }
          );
        const confirmation = await completed;
        expect(confirmation.url()).toMatch(/\/confirm$/);
        expect(confirmation.status()).toBe(valid ? 201 : 400);
        if (valid) {
          const [record] = await result(page);
          const read = await fetch(record.path);
          expect(sha(Buffer.from(await read.arrayBuffer()))).toBe(sha(bytes));
        } else {
          expect(
            (await server.library()).results.some(
              (r: any) => r.originalName === name
            )
          ).toBe(false);
        }
      } finally {
        await page.close();
      }
    }
  }, 90000);

  it('retries only the 503 block and shows byte-weighted progress across both videos', async () => {
    const first = videoOfSize(5 * MiB);
    const larger = videoOfSize(6 * MiB);
    const attempts: {
      kind: string | null;
      id: string | null;
      size: number;
      path: string;
    }[] = [];
    let release!: () => void;
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let allowCommit!: () => void;
    const commit = new Promise<void>((resolve) => {
      allowCommit = resolve;
    });
    receive = async (url, bytes) => {
      const kind = url.searchParams.get('comp');
      const id = url.searchParams.get('blockid');
      attempts.push({ kind, id, size: bytes.length, path: url.pathname });
      if (kind === 'blocklist') await commit;
      if (kind === 'block' && bytes.length === MiB) {
        if (attempts.filter((part) => part.id === id).length === 1) return 503;
        await resume;
      }
    };
    const page = await newPicker();
    try {
      await select(
        page,
        { name: 'exact.mp4', mimeType: 'video/mp4', buffer: first },
        { name: 'larger.mp4', mimeType: 'video/mp4', buffer: larger }
      );
      // One 5 MiB Put Blob plus the successful 5 MiB block out of 11 MiB.
      await page
        .locator('[role="progressbar"][aria-valuenow="91"]')
        .waitFor({ state: 'attached' });
      expect(attempts.filter((part) => part.kind === 'blocklist')).toHaveLength(
        0
      );
      release();
      await page
        .locator('[role="progressbar"][aria-valuenow="100"]')
        .waitFor({ state: 'attached' });
      allowCommit();
      const saved = await result(page);
      expect(saved.map((file) => file.originalName)).toEqual([
        'exact.mp4',
        'larger.mp4',
      ]);
      const full = attempts.filter(
        (part) => part.kind === 'block' && part.size === 5 * MiB
      );
      const retried = attempts.filter(
        (part) => part.kind === 'block' && part.size === MiB
      );
      expect(full).toHaveLength(1);
      expect(retried).toHaveLength(2);
      expect(retried[0].id).toBeTruthy();
      expect(retried[0].id).not.toBe(full[0].id);
      expect(retried[1]).toEqual(retried[0]);
      expect(attempts.filter((part) => part.kind === 'blocklist')).toHaveLength(
        1
      );
      expect(
        attempts.filter((part) => part.kind === null).map((part) => part.size)
      ).toEqual([5 * MiB]);
      for (const [index, row] of saved.entries()) {
        expect(row.path).toContain(
          server.origin.url + '/postiz/dev/' + server.merchantId + '/'
        );
        const read = await fetch(row.path);
        expect(read.headers.get('content-type')).toBe('video/mp4');
        expect(sha(Buffer.from(await read.arrayBuffer()))).toBe(
          sha([first, larger][index])
        );
      }
    } finally {
      release();
      allowCommit();
      receive = undefined;
      await page.close();
    }
  }, 65000);

  it('reports exhausted block retries, keeps the library unchanged and permits a fresh selection after reload', async () => {
    const attempts: string[] = [];
    const full: string[] = [];
    let commits = 0;
    receive = (url, bytes) => {
      if (url.searchParams.get('comp') === 'blocklist') commits++;
      if (url.searchParams.get('comp') !== 'block') return;
      if (bytes.length === 1) {
        attempts.push(url.searchParams.get('blockid')!);
        return 503;
      }
      full.push(url.searchParams.get('blockid')!);
    };
    const before = await server.library();
    const page = await newPicker();
    const file = {
      name: 'select-again.mp4',
      mimeType: 'video/mp4',
      buffer: videoOfSize(5 * MiB + 1),
    };
    try {
      await select(page, file);
      await page
        .getByText('Some files failed to upload, please try again', {
          exact: true,
        })
        .waitFor({ timeout: 90000 });
      expect(await result(page)).toEqual([]);
      expect(attempts).toHaveLength(4);
      expect(new Set(attempts).size).toBe(1);
      expect(full).toHaveLength(1);
      expect(commits).toBe(0);
      expect(await server.library()).toEqual(before);
      receive = undefined;
      await openDirectPicker(page, server, bundle);
      await select(page, file);
      const [saved] = await result(page);
      expect(
        sha(Buffer.from(await (await fetch(saved.path)).arrayBuffer()))
      ).toBe(sha(file.buffer));
      expect(
        (await server.library()).results.filter(
          (row: { id: string }) => row.id === saved.id
        )
      ).toHaveLength(1);
    } finally {
      receive = undefined;
      await page.close();
    }
  }, 110000);

  it('confirms a 10 MiB image and shows the limit when the selected image is one byte larger', async () => {
    const page = await newPicker();
    const bytes = Buffer.alloc(10 * MiB);
    const jpeg = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer();
    jpeg.copy(bytes);
    try {
      await select(page, {
        name: 'exact.jpg',
        mimeType: 'image/jpeg',
        buffer: bytes,
      });
      const [saved] = await result(page);
      expect(
        sha(Buffer.from(await (await fetch(saved.path)).arrayBuffer()))
      ).toBe(sha(bytes));
      const before = await server.library();
      await openDirectPicker(page, server, bundle);
      await select(page, {
        name: 'oversize.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.concat([bytes, Buffer.alloc(1)]),
      });
      await page.getByText(/Image file is too large.*10 MiB/).waitFor();
      expect(await server.library()).toEqual(before);
    } finally {
      await page.close();
    }
  }, 60000);

  it('allows a 1 GiB selection to request a grant and rejects the next byte in the picker', async () => {
    const page = await newPicker();
    const grants: { status: number; size: number }[] = [];
    try {
      // The server authorizes the real request. Stop before the transfer; the
      // public API suite streams the full 1 GiB and one-byte-over bodies.
      await page.route('**/media/azure/uploads', async (route) => {
        const response = await route.fetch();
        grants.push({
          status: response.status(),
          size: route.request().postDataJSON().size,
        });
        return route.fulfill({ status: 400, body: '{}' });
      });
      async function pick(extra: number) {
        await page
          .locator('input[type=file]')
          .first()
          .evaluate((element, extra) => {
            const unit = new Blob([new Uint8Array(1024 ** 2)]);
            const data = new DataTransfer();
            data.items.add(
              new File(
                [...Array(1024).fill(unit), new Uint8Array(extra)],
                'boundary.mp4',
                { type: 'video/mp4' }
              )
            );
            (element as HTMLInputElement).files = data.files;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }, extra);
      }
      await pick(0);
      await result(page);
      expect(grants).toEqual([{ status: 201, size: 1024 ** 3 }]);
      await openDirectPicker(page, server, bundle);
      await pick(1);
      await page
        .getByText(/exceeds maximum allowed size/i)
        .first()
        .waitFor();
      expect(grants).toEqual([{ status: 201, size: 1024 ** 3 }]);
    } finally {
      await page.close();
    }
  }, 60000);
});
