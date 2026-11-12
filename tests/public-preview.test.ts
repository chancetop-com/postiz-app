import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPublicPreview } from '@gitroom/helpers/utils/public.preview';

// The public preview route is the only anonymous surface of the app: it must
// never throw on a bad backend reply, it must fall back to "Post not found".
const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);

describe('loadPublicPreview', () => {
  it('returns the posts of a successful reply', async () => {
    const request = vi.fn(async () =>
      jsonResponse([
        { id: 'post-1', content: '<p>hello</p>' },
        { id: 'post-2', content: '<p>world</p>' },
      ])
    );

    await expect(loadPublicPreview(request)).resolves.toEqual([
      { id: 'post-1', content: '<p>hello</p>' },
      { id: 'post-2', content: '<p>world</p>' },
    ]);
  });

  it('returns no posts when the backend rejects the request', async () => {
    const request = vi.fn(async () =>
      jsonResponse({ message: 'This preview does not exist' }, false, 404)
    );

    await expect(loadPublicPreview(request)).resolves.toEqual([]);
  });

  it('returns no posts when a rejected request still carries an array', async () => {
    // an error page that happens to be a JSON array is not a preview
    const request = vi.fn(async () =>
      jsonResponse([{ id: 'not-a-preview' }], false, 500)
    );

    await expect(loadPublicPreview(request)).resolves.toEqual([]);
  });

  it('returns no posts when the network fails', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(loadPublicPreview(request)).resolves.toEqual([]);
  });

  it('returns no posts when the reply is not JSON', async () => {
    const request = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response)
    );

    await expect(loadPublicPreview(request)).resolves.toEqual([]);
  });

  it.each([
    ['an object', { id: 'post-1' }],
    ['null', null],
    ['a string', 'post-1'],
  ])('returns no posts when the reply holds %s', async (_label, body) => {
    const request = vi.fn(async () => jsonResponse(body));

    await expect(loadPublicPreview(request)).resolves.toEqual([]);
  });
});

// Same loader, but the reply comes over a real socket from a controlled local
// server: only the backend is a stub, the HTTP request itself is real.
describe('loadPublicPreview over HTTP', () => {
  let server: Server | undefined;

  const serve = (status: number, contentType: string, body: string) =>
    new Promise<string>((resolve) => {
      server = createServer((_req, res) => {
        res.writeHead(status, { 'content-type': contentType });
        res.end(body);
      });
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
      });
    });

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('reads a real 200 JSON array', async () => {
    const url = await serve(
      200,
      'application/json',
      JSON.stringify([{ id: 'post-1', content: '<p>hello</p>' }])
    );

    await expect(loadPublicPreview(() => fetch(url))).resolves.toEqual([
      { id: 'post-1', content: '<p>hello</p>' },
    ]);
  });

  it('falls back on a real 404', async () => {
    const url = await serve(
      404,
      'application/json',
      JSON.stringify({ message: 'Not found' })
    );

    await expect(loadPublicPreview(() => fetch(url))).resolves.toEqual([]);
  });

  it('falls back when the body is not JSON', async () => {
    const url = await serve(200, 'text/html', '<html>gateway</html>');

    await expect(loadPublicPreview(() => fetch(url))).resolves.toEqual([]);
  });

  it('falls back when the body is not an array', async () => {
    const url = await serve(
      200,
      'application/json',
      JSON.stringify({ data: [] })
    );

    await expect(loadPublicPreview(() => fetch(url))).resolves.toEqual([]);
  });

  it('falls back when nothing is listening', async () => {
    // a port that was just released refuses connections
    const url = await serve(200, 'application/json', '[]');
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    await expect(loadPublicPreview(() => fetch(url))).resolves.toEqual([]);
  });
});
