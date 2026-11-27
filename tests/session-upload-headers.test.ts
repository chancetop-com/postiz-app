// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob } from 'node:buffer';
import { readFileSync } from 'node:fs';

import { getUppyUploadPlugin } from '@gitroom/react/helpers/uppy.upload';
import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';
const data = new Blob([readFileSync('apps/frontend/public/no-picture.jpg')], {
  type: 'image/jpeg',
});
const photo = { name: 'photo.jpg', type: data.type, size: data.size, data };

beforeEach(() => {
  window.sessionStorage.setItem('auth', 'jwt-a');
  window.sessionStorage.setItem('showorg', 'org-a');
  window.sessionStorage.setItem('impersonate', 'imp-a');
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local XHR upload', () => {
  it('sends no identity headers when the tab has no session', () => {
    window.sessionStorage.clear();
    const plugin = getUppyUploadPlugin('local', vi.fn(), 'http://api');

    expect(plugin.options.headers()).toEqual({});
  });
});

describe('multipart upload through the shared fetch', () => {
  it('carries auth/showorg/impersonate on the create-multipart-upload call', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ key: 'r2-test.jpg', uploadId: 'signature.upload-1' })
    );
    vi.stubGlobal('fetch', fetchMock);
    const plugin = getUppyUploadPlugin(
      'cloudflare',
      customFetch({ baseUrl: 'http://api' }),
      'http://api'
    );

    await plugin.options.createMultipartUpload(photo);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/media/create-multipart-upload');
    const headers = init!.headers as Record<string, string>;
    expect(headers.auth).toBe('jwt-a');
    expect(headers.showorg).toBe('org-a');
    expect(headers.impersonate).toBe('imp-a');
  });

  it('turns a non-2xx upload step into an error instead of a silent success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('upload rejected', { status: 402 })
      )
    );
    const plugin = getUppyUploadPlugin(
      'cloudflare',
      customFetch({ baseUrl: 'http://api' }),
      'http://api'
    );

    await expect(
      plugin.options.createMultipartUpload(photo)
    ).rejects.toThrow('upload rejected');
  });
});
