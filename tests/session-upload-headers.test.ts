// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ticket 05: upload requests keep their own header rules.
 *
 * Local XHR uploads build headers by hand from sessionStorage and leave out
 * `impersonate`. Cloudflare/multipart uploads go through the shared custom
 * fetch, which carries all three values. That asymmetry is the historical
 * "bypass request headers are not uniform" baseline gap and is only recorded.
 */

import { getUppyUploadPlugin } from '@gitroom/react/helpers/uppy.upload';
import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';

const reply = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

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
  it('recorded gap: sends auth/showorg but not impersonate', () => {
    const plugin = getUppyUploadPlugin('local', vi.fn(), 'http://api');

    const headers = plugin.options.headers();

    expect(headers).toEqual({ auth: 'jwt-a', showorg: 'org-a' });
    expect(headers.impersonate).toBeUndefined();
  });

  it('sends no identity headers when the tab has no session', () => {
    window.sessionStorage.clear();
    const plugin = getUppyUploadPlugin('local', vi.fn(), 'http://api');

    expect(plugin.options.headers()).toEqual({});
  });
});

describe('multipart upload through the shared fetch', () => {
  it('carries auth/showorg/impersonate on the create-multipart-upload call', async () => {
    const fetchMock = vi.fn(async () => reply());
    vi.stubGlobal('fetch', fetchMock);
    const plugin = getUppyUploadPlugin(
      'cloudflare',
      customFetch({ baseUrl: 'http://api' }),
      'http://api'
    );

    await plugin.options.createMultipartUpload({
      type: 'image/png',
      size: 200 * 1024 * 1024,
      data: null,
    });

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
      plugin.options.createMultipartUpload({
        type: 'image/png',
        size: 200 * 1024 * 1024,
        data: null,
      })
    ).rejects.toThrow('upload rejected');
  });
});
