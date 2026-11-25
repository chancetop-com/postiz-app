import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { multipartMediaId } from '@gitroom/helpers/utils/multipart.media.id';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import { startDirectUploadApp } from './azure-direct-app.fixture';
import {
  bundleDirectPicker,
  openDirectPicker,
} from './azure-direct-picker.fixture';
import { startR2PickerOrigin } from './r2-picker-origin.fixture';

// Point the AWS SDK at our S3-compatible service. The R2 route otherwise
// hardcodes Cloudflare's DNS name. Signing, networking and checksums are real.
vi.mock('@aws-sdk/client-s3', async (load) => {
  const sdk = await load<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class extends sdk.S3Client {
      constructor(options: S3ClientConfig) {
        if (!process.env.PICKER_TEST_R2_ORIGIN)
          throw Error('Local S3 fixture required');
        super({
          ...options,
          endpoint: process.env.PICKER_TEST_R2_ORIGIN,
          forcePathStyle: true,
        });
      }
    },
  };
});

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const gif = Buffer.from(
  'R0lGODlhCAAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAACAAIAAACB4SPqcvtXQAAIfkEAAoAAAAsAAAAAAgACACAAAD/AAAAAgeEj6nL7V0AADs=',
  'base64'
);

describe.runIf(
  process.env.AZURE_CONFIRM_TEST_DATABASE_URL &&
    process.env.AZURE_UPLOAD_TEST_CHROMIUM
)(
  'Azure and R2 media library uploads with external processing disabled',
  () => {
    let r2: Awaited<ReturnType<typeof startR2PickerOrigin>>;
    let azureApp: Awaited<ReturnType<typeof startDirectUploadApp>>;
    let r2App: typeof azureApp;
    const processingApps: (typeof azureApp)[] = [];
    let browser: Browser;
    let bundle: string;
    let png: Buffer;
    const video = readFileSync('tests/fixtures/blue-frame.mp4');

    beforeAll(async () => {
      png = await sharp({
        create: {
          width: 1600,
          height: 1200,
          channels: 3,
          background: 'indigo',
        },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(png.length).toBeGreaterThan(5 * 1024 ** 2);
      r2 = await startR2PickerOrigin();
      vi.stubEnv('PICKER_TEST_R2_ORIGIN', r2.url);
      vi.stubEnv('CLOUDFLARE_BUCKET_URL', r2.url + '/cdn');
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'test-account');
      vi.stubEnv('CLOUDFLARE_ACCESS_KEY', 'test-key');
      vi.stubEnv('CLOUDFLARE_SECRET_ACCESS_KEY', 'test-secret');
      vi.stubEnv('CLOUDFLARE_BUCKETNAME', 'postiz');
      vi.stubEnv('RUNPOD_API_KEY', '');
      vi.stubEnv('RUNPOD_ENDPOINT_ID', '');
      azureApp = await startDirectUploadApp();
      r2App = await startDirectUploadApp(undefined, 'cloudflare');
      bundle = await bundleDirectPicker();
      browser = await chromium.launch({
        executablePath: process.env.AZURE_UPLOAD_TEST_CHROMIUM,
      });
    }, 60000);
    afterAll(async () => {
      await browser?.close();
      for (const app of processingApps.reverse()) await app.close();
      await r2App?.close();
      await azureApp?.close();
      await r2?.close();
      vi.unstubAllEnvs();
    });

    it.each([
      ['azure', 'truncated'],
      ['azure', 'timeout'],
      ['cloudflare', 'truncated'],
      ['cloudflare', 'timeout'],
      ['cloudflare', 'lost'],
      ['cloudflare', 'undelivered'],
      ['cloudflare', 'overlapping'],
    ] as const)(
      'returns one saved %s upload when completion is %s',
      async (provider, failure) => {
        const app = provider === 'azure' ? azureApp : r2App;
        vi.stubEnv('STORAGE_PROVIDER', provider);
        const page = await browser.newPage({ ignoreHTTPSErrors: true });
        const name = `completion-${provider}-${failure}.gif`;
        const endpoint =
          provider === 'azure'
            ? '**/media/azure/uploads/*/confirm'
            : '**/media/complete-multipart-upload';
        let completions = 0;
        let saved: { id: string; path: string };
        let requestBody: { key: string; uploadId: string };
        try {
          await openDirectPicker(
            page,
            app,
            bundle,
            'provider=' + provider + '&no-template'
          );
          await page.route(endpoint, async (route) => {
            completions++;
            const current = route.request().postDataJSON();
            if (completions === 1) requestBody = current;
            if (provider === 'cloudflare' && completions === 2)
              expect(current).toEqual({ ...requestBody!, retry: true });
            if (completions === 1 && failure === 'undelivered')
              return route.abort('connectionreset');
            if (completions === 1 && failure === 'timeout')
              return route.fulfill({ status: 408, body: 'Request Timeout' });
            if (completions === 1 && failure === 'overlapping') {
              const hold = r2.holdNextValidation();
              const first = route.fetch();
              try {
                await hold.reached;
                const concurrent = await route.fetch({
                  postData: { ...current, retry: true },
                });
                expect(concurrent.ok()).toBe(true);
                saved = (await concurrent.json()).saved;
              } finally {
                hold.release();
              }
              expect((await (await first).json()).saved.id).toBe(saved!.id);
              return route.abort('connectionreset');
            }
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            const body = await response.json();
            saved = provider === 'azure' ? body : body.saved;
            if (completions > 1 && (failure !== 'lost' || completions > 2))
              return route.fulfill({ response });
            if (failure === 'lost') return route.abort('connectionreset');
            await route.fulfill({ response, body: '{"id":' });
          });
          await page
            .locator('input[type=file]')
            .first()
            .setInputFiles({ name, mimeType: 'image/gif', buffer: gif });
          await page.waitForFunction(() =>
            document.querySelector('output')?.textContent?.startsWith('[')
          );
          const [result] = JSON.parse(await page.locator('output').innerText());
          expect(result).toMatchObject({
            id: saved!.id,
            path: saved!.path,
            status: 'ready',
          });
          expect(
            await app.db!.media.count({
              where: { organizationId: app.merchantId, originalName: name },
            })
          ).toBe(1);
          expect(completions).toBe(failure === 'lost' ? 3 : 2);
          if (provider === 'cloudflare') {
            const { key, uploadId } = requestBody!;
            const status = (id: string, org = app.merchantId) =>
              fetch(app.baseUrl + '/media/' + id + '/status', {
                headers: { auth: app.sessions[org], showorg: org },
              });
            expect(
              (
                await status(
                  multipartMediaId(key, uploadId),
                  app.otherMerchantId
                )
              ).status
            ).toBe(404);
            expect(
              (await status(multipartMediaId(key, uploadId + 'x'))).status
            ).toBe(404);
            expect(
              (await status(multipartMediaId('other.gif', uploadId))).status
            ).toBe(404);
            // A direct replay can only succeed by retrieving the existing Media:
            // the consumed multipart upload no longer exists at the origin.
            const replay = await fetch(
              app.baseUrl + '/media/complete-multipart-upload',
              {
                method: 'POST',
                headers: {
                  auth: app.sessions[app.merchantId],
                  showorg: app.merchantId,
                  'content-type': 'application/json',
                },
                body: JSON.stringify(requestBody!),
              }
            );
            expect(replay.status).toBe(200);
            expect(await replay.json()).toMatchObject({
              Location: result.path,
              saved: { id: result.id },
            });
            expect(r2.completionRequests.get(key)).toBe(1);
          }
        } finally {
          await page.close();
        }
      }
    );

    it('refuses a first R2 completion after switching organizations or removing the grant signature', async () => {
      vi.stubEnv('STORAGE_PROVIDER', 'cloudflare');
      const page = await browser.newPage({ ignoreHTTPSErrors: true });
      try {
        await openDirectPicker(
          page,
          r2App,
          bundle,
          'provider=cloudflare&no-template'
        );
        await page.route('**/media/sign-part', async (route) => {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          await page.evaluate(
            ({ org, auth }) => {
              sessionStorage.setItem('showorg', org);
              sessionStorage.setItem('auth', auth);
            },
            {
              org: r2App.otherMerchantId,
              auth: r2App.sessions[r2App.otherMerchantId],
            }
          );
          await route.fulfill({ response });
        });
        const completion = page.waitForResponse((response) =>
          response.url().endsWith('/media/complete-multipart-upload')
        );
        await page.locator('input[type=file]').first().setInputFiles({
          name: 'organization-switch.gif',
          mimeType: 'image/gif',
          buffer: gif,
        });
        const denied = await completion;
        expect(denied.request().headers().showorg).toBe(r2App.otherMerchantId);
        expect(denied.status()).toBe(404);
        const body = denied.request().postDataJSON();
        const complete = (data: unknown) =>
          fetch(denied.url(), {
            method: 'POST',
            headers: {
              auth: r2App.sessions[r2App.merchantId],
              showorg: r2App.merchantId,
              'content-type': 'application/json',
            },
            body: JSON.stringify(data),
          });
        const rawId = body.uploadId.slice(body.uploadId.indexOf('.') + 1);
        expect((await complete({ ...body, uploadId: rawId })).status).toBe(404);
        expect(
          (
            await complete({
              ...body,
              key: 'ABCDEFGHIJKLMNOPQRST.gif',
              uploadId: rawId,
            })
          ).status
        ).toBe(404);
        expect(
          (
            await complete({
              ...body,
              key: body.key.replace('.gif', '.png'),
              retry: true,
            })
          ).status
        ).toBe(404);
        expect(r2.completionRequests.get(body.key)).toBeUndefined();
        expect(
          await r2App.db!.media.count({
            where: {
              originalName: 'organization-switch.gif',
              organizationId: { in: [r2App.merchantId, r2App.otherMerchantId] },
            },
          })
        ).toBe(0);
        const owner = await complete(body);
        expect(owner.ok).toBe(true);
        const { saved } = await owner.json();
        expect(
          await r2App.db!.media.findUnique({
            where: { id: saved.id },
            select: { organizationId: true },
          })
        ).toEqual({ organizationId: r2App.merchantId });
      } finally {
        await page.close();
      }
    });

    it('resumes a processing upload after a missing dispatch and joins the same workflow during concurrent or closed-run replays', async () => {
      vi.stubEnv('RUNPOD_API_KEY', 'fixture');
      vi.stubEnv('RUNPOD_ENDPOINT_ID', 'fixture');
      let dispatch: 'unavailable' | 'ack-lost' | 'available' | 'finished' =
        'unavailable';
      let jobs = 0;
      let finish: () => Promise<unknown>;
      const start = vi.fn(
        async (
          name: string,
          options: {
            workflowId: string;
            workflowIdConflictPolicy: string;
            workflowIdReusePolicy: string;
          }
        ) => {
          if (dispatch === 'unavailable')
            throw Error('API stopped before dispatch');
          if (dispatch === 'finished') {
            // The worker completes between the API reading the row and Temporal
            // deciding whether this workflow ID can be started again.
            await finish();
            if (options.workflowIdReusePolicy === 'REJECT_DUPLICATE')
              throw new WorkflowExecutionAlreadyStartedError(
                'closed',
                options.workflowId,
                name
              );
          }
          if (jobs === 0 || options.workflowIdConflictPolicy !== 'USE_EXISTING')
            jobs++;
          if (dispatch === 'ack-lost')
            throw Error('Lost the start acknowledgement');
        }
      );
      const app = await startDirectUploadApp(undefined, 'cloudflare', () => ({
        workflow: { start },
      }));
      processingApps.push(app);
      const post = (endpoint: string, body: unknown, org = app.merchantId) =>
        fetch(app.baseUrl + '/media/' + endpoint, {
          method: 'POST',
          headers: {
            auth: app.sessions[org],
            showorg: org,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      try {
        const file = { name: 'workflow-recovery.mp4' };
        const open = async () =>
          (
            await post('create-multipart-upload', { file, fileHash: '' })
          ).json();
        const abandoned = await open();
        expect((await post('list-parts', abandoned)).status).toBe(200);
        expect(
          (await post('abort-multipart-upload', abandoned, app.otherMerchantId))
            .status
        ).toBe(404);
        expect((await post('abort-multipart-upload', abandoned)).status).toBe(
          200
        );
        const grant = await open();
        const partData = { ...grant, parts: [{ number: 1 }] };
        expect(
          (
            await post(
              'prepare-upload-parts',
              { partData },
              app.otherMerchantId
            )
          ).status
        ).toBe(404);
        expect(
          (await post('list-parts', grant, app.otherMerchantId)).status
        ).toBe(404);
        const { presignedUrls } = await (
          await post('prepare-upload-parts', { partData })
        ).json();
        const put = await fetch(presignedUrls[1], {
          method: 'PUT',
          body: new Uint8Array(video),
        });
        expect(put.ok).toBe(true);
        const body = {
          ...grant,
          file,
          parts: [{ PartNumber: 1, ETag: put.headers.get('etag') }],
        };
        const id = multipartMediaId(grant.key, grant.uploadId);
        const complete = () => post('complete-multipart-upload', body);
        const read = () => app.db!.media.findUniqueOrThrow({ where: { id } });
        // Actual first registration: the DB write succeeds while Temporal is unavailable.
        expect((await complete()).status).toBe(503);
        expect((await read()).status).toBe('processing');
        expect(jobs).toBe(0);
        dispatch = 'ack-lost';
        expect((await complete()).status).toBe(503);
        expect((await read()).status).toBe('processing');
        dispatch = 'available';
        const concurrent = await Promise.all(
          Array.from({ length: 5 }, complete)
        );
        for (const response of concurrent) {
          expect(response.status).toBe(200);
          expect((await response.json()).saved).toMatchObject({
            id,
            status: 'processing',
          });
        }
        const finalPath = r2.url + '/cdn/normalized.mp4';
        finish = () =>
          app.db!.media.update({
            where: { id },
            data: { status: 'ready', path: finalPath },
          });
        dispatch = 'finished';
        const finished = {
          Location: finalPath,
          saved: { id, status: 'ready', path: finalPath },
        };
        expect(await (await complete()).json()).toMatchObject(finished);
        const calls = start.mock.calls.length;
        expect(await (await complete()).json()).toMatchObject(finished);
        expect(start).toHaveBeenCalledTimes(calls);
        for (const [name, options] of start.mock.calls) {
          expect(name).toBe('processMediaWorkflow');
          expect(options).toMatchObject({
            workflowId: 'media_' + id,
            workflowIdConflictPolicy: 'USE_EXISTING',
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            args: [{ mediaId: id }],
          });
        }
        expect(jobs).toBe(1);
        expect(r2.completionRequests.get(grant.key)).toBe(1);
      } finally {
        vi.stubEnv('RUNPOD_API_KEY', '');
        vi.stubEnv('RUNPOD_ENDPOINT_ID', '');
      }
    });

    it('retries R2 completion in the picker when dispatch fails twice before Temporal accepts the job', async () => {
      vi.stubEnv('RUNPOD_API_KEY', 'fixture');
      vi.stubEnv('RUNPOD_ENDPOINT_ID', 'fixture');
      const start = vi.fn(
        async (_name: string, options: { args: [{ mediaId: string }] }) => {
          if (start.mock.calls.length < 3) throw Error('Temporal unavailable');
          await app.db!.media.update({
            where: { id: options.args[0].mediaId },
            data: { status: 'ready' },
          });
        }
      );
      const app = await startDirectUploadApp(undefined, 'cloudflare', () => ({
        workflow: { start },
      }));
      processingApps.push(app);
      const page = await browser.newPage({ ignoreHTTPSErrors: true });
      try {
        const statuses: number[] = [];
        const tokens: string[] = [];
        page.on('response', (response) => {
          if (response.url().endsWith('/media/complete-multipart-upload')) {
            statuses.push(response.status());
            tokens.push(response.request().postDataJSON().uploadId);
          }
        });
        await openDirectPicker(
          page,
          app,
          bundle,
          'provider=cloudflare&processing&no-template'
        );
        await page
          .locator('input[type=file]')
          .first()
          .setInputFiles({
            name: 'dispatch-retry.mp4',
            mimeType: 'video/mp4',
            buffer: video,
          });
        await page.waitForFunction(() =>
          document.querySelector('output')?.textContent?.startsWith('[')
        );
        const [result] = JSON.parse(await page.locator('output').innerText());
        expect(statuses).toEqual([503, 503, 200]);
        expect(new Set(tokens).size).toBe(1);
        expect(start).toHaveBeenCalledTimes(3);
        expect(result.status).toBe('ready');
        expect(r2.completionRequests.get(result.name)).toBe(1);
      } finally {
        await page.close();
        vi.stubEnv('RUNPOD_API_KEY', '');
        vi.stubEnv('RUNPOD_ENDPOINT_ID', '');
      }
    });

    it.each([true, false])(
      'serves the exact bytes the picker submitted with compression set to %s',
      async (compress) => {
        const files = [
          { name: 'large.png', mimeType: 'image/png', buffer: png },
          { name: 'animation.gif', mimeType: 'image/gif', buffer: gif },
          { name: 'blue.mp4', mimeType: 'video/mp4', buffer: video },
        ];
        const outcomes: string[][] = [];
        for (const provider of ['azure', 'cloudflare'] as const) {
          const app = provider === 'azure' ? azureApp : r2App;
          vi.stubEnv('STORAGE_PROVIDER', provider);
          const page = await browser.newPage({ ignoreHTTPSErrors: true });
          const diagnostics: string[] = [];
          page.on('response', (r) => {
            if (r.status() >= 400)
              diagnostics.push(r.status() + ' ' + new URL(r.url()).pathname);
          });
          page.on('pageerror', (error) => diagnostics.push(error.message));
          try {
            await openDirectPicker(
              page,
              app,
              bundle,
              'provider=' +
                provider +
                '&capture&no-template' +
                (compress ? '&compress' : '')
            );
            await page.locator('input[type=file]').first().setInputFiles(files);
            await page.waitForFunction(
              () =>
                document.querySelector('output')?.textContent?.startsWith('['),
              undefined,
              { timeout: 20000 }
            );
            const saved = JSON.parse(
              await page.locator('output').innerText()
            ) as { id: string; path: string; status: string }[];
            expect(saved, diagnostics.join(', ')).toHaveLength(3);
            await page.waitForFunction(
              () =>
                Object.keys(
                  JSON.parse(
                    document.querySelector('[data-submitted]')!.textContent!
                  )
                ).length === 3
            );
            const submitted = JSON.parse(
              await page.locator('[data-submitted]').innerText()
            ) as Record<string, string>;
            const hashes: string[] = [];
            const library = await app.library();
            for (const [index, record] of saved.entries()) {
              expect(record.status).toBe('ready');
              expect(library.results).toContainEqual(
                expect.objectContaining({ id: record.id, path: record.path })
              );
              expect(
                record.path.startsWith(
                  provider === 'azure'
                    ? app.origin.url + '/postiz/dev/' + app.merchantId + '/'
                    : r2.url + '/cdn/'
                )
              ).toBe(true);
              expect(new URL(record.path).search).toBe('');
              const read = await fetch(record.path);
              expect(read.status).toBe(200);
              const bytes = Buffer.from(await read.arrayBuffer());
              hashes.push(sha(bytes));
              expect(sha(bytes)).toBe(submitted[record.path]);
              if (index === 0) {
                expect(read.headers.get('content-type')).toBe(
                  compress ? 'image/jpeg' : 'image/png'
                );
                expect(await sharp(bytes).metadata()).toMatchObject(
                  compress
                    ? { format: 'jpeg', width: 1000, height: 750 }
                    : { format: 'png', width: 1600, height: 1200 }
                );
                expect(sha(bytes) === sha(png)).toBe(!compress);
              } else {
                expect(read.headers.get('content-type')).toBe(
                  files[index].mimeType
                );
                expect(sha(bytes)).toBe(sha(files[index].buffer));
                if (index === 1)
                  expect(
                    await sharp(bytes, { animated: true }).metadata()
                  ).toMatchObject({
                    format: 'gif',
                    pages: 2,
                    delay: [100, 100],
                  });
              }
            }
            outcomes.push(hashes);
          } finally {
            await page.close();
          }
        }
        expect(outcomes[0]).toEqual(outcomes[1]);
      },
      90000
    );
  }
);
