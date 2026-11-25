import { readFileSync } from 'node:fs';
import { BlockBlobClient } from '@azure/storage-blob';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startDirectUploadApp } from './azure-direct-app.fixture';
import {
  bundleDirectUploadPage,
  openDirectUploadPage,
} from './azure-direct-picker.fixture';

describe.runIf(
  process.env.AZURE_UPLOAD_TEST_CHROMIUM &&
    process.env.AZURE_CONFIRM_TEST_DATABASE_URL
)('Azure uploads from the video and design editors', () => {
  let app: Awaited<ReturnType<typeof startDirectUploadApp>>;
  let browser: Browser;
  let page: Page;
  let bundle: string;
  let video: { id: string; path: string };

  async function seedMedia(bytes: Buffer, name: string, contentType: string) {
    const grant = await (
      await app.post('', {
        name,
        contentType,
        size: bytes.length,
        purpose: 'media',
      })
    ).json();
    await new BlockBlobClient(grant.uploadUrl).uploadData(bytes);
    const confirm = await app.post('/' + grant.uploadId + '/confirm', {
      name,
      size: bytes.length,
      contentType,
      purpose: 'media',
    });
    expect(confirm.status).toBe(201);
    return confirm.json();
  }

  beforeAll(async () => {
    app = await startDirectUploadApp();
    video = await seedMedia(
      readFileSync('tests/fixtures/azure-message-media/clip.mp4'),
      'video.mp4',
      'video/mp4'
    );
    bundle = await bundleDirectUploadPage(
      'tests/azure-editor-browser.fixture.tsx'
    );
    browser = await chromium.launch({
      executablePath: process.env.AZURE_UPLOAD_TEST_CHROMIUM,
    });
  }, 60000);

  beforeEach(async () => {
    page = await browser.newPage({ ignoreHTTPSErrors: true });
    page.setDefaultTimeout(5000);
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      // The designer vendor's online asset catalog is outside this local test.
      return [app.baseUrl, app.origin.url].includes(url.origin)
        ? route.continue()
        : route.abort();
    });
  });

  afterEach(async () => {
    await page?.close();
  });
  afterAll(async () => {
    await browser?.close();
    await app?.close();
  });

  async function openEditor(kind: 'video' | 'design') {
    const query =
      kind === 'video'
        ? 'video=' + encodeURIComponent(JSON.stringify(video))
        : '';
    await openDirectUploadPage(page, app, bundle, query);
  }

  it('applies a selected local cover to the video and keeps the cover out of the library', async () => {
    const before = (await app.library()).results;
    const bytes = readFileSync('apps/frontend/public/no-picture.jpg');
    await openEditor('video');
    await page.getByLabel('Upload cover').setInputFiles({
      name: 'cover.jpg',
      mimeType: 'image/jpeg',
      buffer: bytes,
    });
    const confirmed = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/confirm')
    );
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('thumbnail')
    );
    const saved = JSON.parse(await page.locator('output').innerText());
    expect(await (await confirmed).json()).toEqual({ path: saved.thumbnail });
    expect(saved.id).toBe(video.id);
    expect(saved.thumbnail).toMatch(
      app.origin.url + '/postiz/dev/' + app.merchantId + '/'
    );
    expect(new URL(saved.thumbnail).search).toBe('');
    const read = await fetch(saved.thumbnail);
    expect(read.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
    const after = (await app.library()).results;
    expect(after.map((m: { id: string }) => m.id)).toEqual(
      before.map((m: { id: string }) => m.id)
    );
    expect(after.find((m: { id: string }) => m.id === video.id).thumbnail).toBe(
      saved.thumbnail
    );
  }, 30000);

  it('applies an existing gallery cover by its confirmed address', async () => {
    const image = await seedMedia(
      readFileSync('apps/frontend/public/no-picture.jpg'),
      'gallery.jpg',
      'image/jpeg'
    );
    const before = (await app.library()).results;
    await openEditor('video');
    await page.getByRole('button', { name: 'From Gallery' }).click();
    await page.locator(`img[src="${image.path}"]`).click();
    await page.getByRole('button', { name: 'Add selected media' }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('thumbnail')
    );
    expect(JSON.parse(await page.locator('output').innerText())).toMatchObject({
      id: video.id,
      thumbnail: image.path,
      thumbnailTimestamp: null,
    });
    expect((await app.library()).results).toHaveLength(before.length);
  }, 30000);

  it('reuses the confirmed cover when saving the video settings is retried', async () => {
    let grants = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/media/azure/uploads') grants++;
    });
    const paths: string[] = [];
    await page.route('**/media/information', async (route) => {
      paths.push(route.request().postDataJSON().thumbnail);
      if (paths.length === 1) await route.fulfill({ status: 503 });
      else await route.continue();
    });
    await openEditor('video');
    await page
      .getByLabel('Upload cover')
      .setInputFiles('apps/frontend/public/no-picture.jpg');
    const save = page.getByRole('button', { name: 'Save Changes' });
    await save.click();
    await page.getByRole('alert').waitFor();
    expect(await page.locator('output').innerText()).toBe('null');
    await save.click();
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('thumbnail')
    );
    const saved = JSON.parse(await page.locator('output').innerText());
    expect(paths).toEqual([saved.thumbnail, saved.thumbnail]);
    expect(grants).toBe(1);
  }, 30000);

  it('captures the selected video frame from the Blob origin and saves its timestamp', async () => {
    const before = (await app.library()).results;
    await openEditor('video');
    await page.getByRole('button', { name: 'Select Frame' }).click();
    expect(await page.locator('video').getAttribute('src')).toBe(video.path);
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
      if (video.readyState < video.HAVE_CURRENT_DATA)
        await new Promise((resolve) =>
          video.addEventListener('loadeddata', resolve, { once: true })
        );
    });
    await page.getByRole('slider').focus();
    const seeked = page.locator('video').evaluate(
      (video) =>
        new Promise((resolve) =>
          video.addEventListener('seeked', () => resolve(true), {
            once: true,
          })
        )
    );
    await page.getByRole('slider').press('ArrowRight');
    await seeked;
    await page.getByRole('button', { name: 'Select This Frame' }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('thumbnail')
    );
    const saved = JSON.parse(await page.locator('output').innerText());
    expect(saved).toMatchObject({ id: video.id, thumbnailTimestamp: 100 });
    const read = await fetch(saved.thumbnail);
    expect(read.headers.get('content-type')).toBe('image/jpeg');
    const frame = sharp(Buffer.from(await read.arrayBuffer()));
    expect(await frame.metadata()).toMatchObject({
      format: 'jpeg',
      width: 16,
      height: 16,
    });
    const [r, g, b] = await frame.raw().toBuffer();
    expect(Math.max(r, g)).toBeLessThan(10);
    expect(b).toBeGreaterThan(245);
    expect((await app.library()).results).toHaveLength(before.length);
  }, 30000);

  it('inserts the confirmed PNG from the designer into the post field after a lost response', async () => {
    const before = (await app.library()).results;
    const confirmations: string[] = [];
    const results: Array<{ id: string; path: string; status: string }> = [];
    await page.route('**/media/azure/uploads/*/confirm', async (route) => {
      confirmations.push(route.request().url());
      const response = await route.fetch();
      results.push(await response.json());
      if (confirmations.length === 1) {
        await route.abort('connectionreset');
      } else await route.fulfill({ response });
    });
    await openEditor('design');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Use this media' }).click();
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('"path"')
    );
    const saved = JSON.parse(await page.locator('output').innerText());
    expect(confirmations).toHaveLength(2);
    expect(confirmations[0]).toBe(confirmations[1]);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toMatchObject({ ...saved, status: 'ready' });
    expect(saved.path).toContain(
      app.origin.url + '/postiz/dev/' + app.merchantId + '/'
    );
    expect(new URL(saved.path).search).toBe('');
    const preview = page.locator('img').filter({ visible: true });
    expect(await preview.getAttribute('src')).toBe(saved.path);
    const read = await fetch(saved.path);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(
      await sharp(Buffer.from(await read.arrayBuffer())).metadata()
    ).toMatchObject({
      format: 'png',
      width: 80,
      height: 60,
    });
    const after = (await app.library()).results;
    expect(after).toHaveLength(before.length + 1);
    expect(after).toContainEqual(
      expect.objectContaining({ id: saved.id, path: saved.path })
    );
  }, 30000);

  it.each([
    ['video', 'write'],
    ['video', 'confirm'],
    ['design', 'write'],
    ['design', 'confirm'],
  ] as const)(
    'leaves %s open without applying an attachment when %s fails',
    async (kind, failure) => {
      const before = await app.library();
      const confirmations: number[] = [];
      page.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/confirm'))
          confirmations.push(response.status());
      });
      await page.route(
        (url) => url.origin === app.origin.url && url.searchParams.has('sig'),
        (route) => {
          if (route.request().method() !== 'PUT') return route.continue();
          if (failure === 'write')
            return route.fulfill({
              status: 403,
              headers: { 'access-control-allow-origin': '*' },
            });
          // Azure accepts the PUT but the server rejects its contents on confirmation.
          return route.continue({ postData: Buffer.from('invalid image') });
        }
      );
      await openEditor(kind);
      if (kind === 'video') {
        await page
          .getByLabel('Upload cover')
          .setInputFiles('apps/frontend/public/no-picture.jpg');
      } else {
        await page.getByRole('button', { name: 'Editor', exact: true }).click();
      }
      const save = page.getByRole('button', {
        name: kind === 'video' ? 'Save Changes' : 'Use this media',
      });
      await save.click();
      await page
        .getByRole('alert')
        .filter({ hasText: /could not save/i })
        .waitFor();
      expect(await save.isEnabled()).toBe(true);
      expect(await page.locator('output').innerText()).toBe('null');
      expect(confirmations).toEqual(failure === 'write' ? [404] : [400]);
      expect(await app.library()).toEqual(before);
    },
    30000
  );
});
