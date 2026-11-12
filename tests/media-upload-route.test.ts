import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/**
 * Ticket 10: the direct Next upload route keeps serving old files.
 *
 * This is the route nginx proxies to for `/uploads/**`. Old posts and provider
 * fetchers address stored files through it, video publishing included, so it
 * must answer full and ranged reads with the stored bytes. The route is
 * publicly readable by design (same as the pre-merge baseline) — that contract
 * is asserted, not changed.
 */

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypmp42'),
  Buffer.from('old-video-bytes'),
]);

let root: string;

const request = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:4200${url}`, { headers });

const callRoute = async (url: string, headers: Record<string, string> = {}) => {
  const { GET } = await import(
    '@gitroom/frontend/app/(app)/api/uploads/[[...path]]/route'
  );
  return GET(request(url, headers), {
    params: Promise.resolve({
      path: url
        .replace(/^\/api\/uploads\/?/, '')
        .split('/')
        .filter(Boolean)
        .map(decodeURIComponent),
    }),
  });
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'postiz-media-route-'));
  mkdirSync(path.join(root, '2024/12/31'), { recursive: true });
  mkdirSync(path.join(root, '2025/01/01'), { recursive: true });
  writeFileSync(path.join(root, '2024/12/31/legacy.png'), PNG);
  writeFileSync(path.join(root, '2025/01/01/legacy.mp4'), MP4);
  process.env.UPLOAD_DIRECTORY = root;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('direct Next upload route', () => {
  it('serves an old image file to an anonymous reader', async () => {
    const response = await callRoute('/api/uploads/2024/12/31/legacy.png');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG.length));
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it('serves an old video file in byte ranges for provider uploads', async () => {
    const head = await callRoute('/api/uploads/2025/01/01/legacy.mp4', {
      range: 'bytes=0-3',
    });
    expect(head.status).toBe(206);
    expect(head.headers.get('content-type')).toBe('video/mp4');
    expect(head.headers.get('content-range')).toBe(`bytes 0-3/${MP4.length}`);
    expect(head.headers.get('content-length')).toBe('4');
    expect(Buffer.from(await head.arrayBuffer())).toEqual(MP4.subarray(0, 4));

    const tail = await callRoute('/api/uploads/2025/01/01/legacy.mp4', {
      range: 'bytes=4-',
    });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(MP4.subarray(4));
  });

  it('clamps a range that ends past the file instead of failing it', async () => {
    const response = await callRoute('/api/uploads/2025/01/01/legacy.mp4', {
      range: 'bytes=4-999999',
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(
      `bytes 4-${MP4.length - 1}/${MP4.length}`
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MP4.subarray(4));
  });

  it('rejects a range that starts past the file with 416', async () => {
    const response = await callRoute('/api/uploads/2025/01/01/legacy.mp4', {
      range: `bytes=${MP4.length}-`,
    });

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe(`bytes */${MP4.length}`);
  });

  it('confines reads to the upload directory', async () => {
    writeFileSync(path.join(root, '..', 'outside-secret.txt'), 'secret');
    try {
      const response = await callRoute(
        '/api/uploads/..%2Foutside-secret.txt'
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found');
    } finally {
      rmSync(path.join(root, '..', 'outside-secret.txt'), { force: true });
    }
  });
});
