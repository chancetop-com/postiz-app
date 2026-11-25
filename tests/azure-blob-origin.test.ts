import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { startAzureMediaStorage } from './azure-media-storage.fixture';

beforeEach(() => {
  vi.stubEnv('STORAGE_PROVIDER', 'azure');
  vi.stubEnv('AZURE_CONTAINER', 'postiz');
  vi.stubEnv('AZURE_BASEPATH', 'dev');
});
afterEach(() => vi.unstubAllEnvs());

it('uses the account Blob endpoint for a shared-key connection string', () => {
  vi.stubEnv(
    'AZURE_CONNECTIONURL',
    'DefaultEndpointsProtocol=https;AccountName=fbrdevstorage;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net'
  );

  expect(UploadFactory.createStorage().publicUrl!('dev/merchant-1/video.mp4')).toBe(
    'https://fbrdevstorage.blob.core.windows.net/postiz/dev/merchant-1/video.mp4'
  );
});

it('returns a permanent encoded Blob URL from a SAS-authenticated account endpoint', () => {
  vi.stubEnv(
    'AZURE_CONNECTIONURL',
    'BlobEndpoint=https://blob.example.test:8443/account;SharedAccessSignature=sv=2023-11-03&sig=test%2Bsignature'
  );
  const storage = UploadFactory.createStorage();

  expect(storage.publicUrl!('dev/merchant-1/photo #1%+?雪.png')).toBe(
    'https://blob.example.test:8443/account/postiz/dev/merchant-1/photo%20%231%25%2B%3F%E9%9B%AA.png'
  );
  expect(storage.publicUrl!('')).toBe(
    'https://blob.example.test:8443/account/postiz/'
  );
});

it('requires HTTPS before returning a public media URL', () => {
  vi.stubEnv(
    'AZURE_CONNECTIONURL',
    'BlobEndpoint=http://blob.example.test;SharedAccessSignature=sv=2023-11-03&sig=test'
  );
  expect(() => UploadFactory.createStorage()).toThrow(/HTTPS/);
});

it('reads back uploads under the merchant ID with or without a prefix', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const blob = await startAzureMediaStorage();
  try {
    for (const [prefix, directory] of [
      [undefined, '/postiz/merchant-1/'],
      ['', '/postiz/merchant-1/'],
      ['dev', '/postiz/dev/merchant-1/'],
      ['/qa/east/', '/postiz/qa/east/merchant-1/'],
    ] as const) {
      vi.stubEnv('AZURE_BASEPATH', prefix);
      const storage = UploadFactory.createStorage();
      expect(storage.publicUrl!('')).toBe(blob.origin + '/postiz/');
      const path = await storage.uploadSimple(
        'data:image/png;base64,' + png,
        'merchant-1'
      );
      const url = new URL(path);
      const name = url.pathname.split('/').pop();
      expect(name).toMatch(/^[\da-f-]{36}\.png$/);
      expect(path).toBe(blob.origin + directory + name);
      const read = await fetch(path);
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await read.arrayBuffer())).toEqual(
        Buffer.from(png, 'base64')
      );
    }
  } finally {
    await blob.close();
  }
});
