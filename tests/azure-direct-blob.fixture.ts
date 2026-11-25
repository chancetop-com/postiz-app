import { createServer } from 'node:https';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { buffer } from 'node:stream/consumers';
import { randomUUID } from 'node:crypto';
import { createBlobTestTls } from './azure-blob-tls.fixture';

// Loopback Blob REST service for the real SDK, including create-only SAS semantics.
export async function startDirectBlobOrigin(
  options: {
    // Inspect the requests that actually reached the origin. Returning a status
    // rejects that attempt before changing any staged or committed bytes.
    receive?: (
      url: URL,
      bytes: Buffer
    ) => number | void | Promise<number | void>;
  } = {}
) {
  const tls = createBlobTestTls();
  const blobs = new Map<
    string,
    {
      bytes: Buffer;
      type: string;
      etag: string;
      metadata: Record<string, string>;
    }
  >();
  let loseCommitResponse = false;
  const blocks = new Map<string, Buffer>();
  const origin = createServer(tls, async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'etag,x-ms-request-id');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-private-network', 'true');
      res.setHeader('access-control-allow-methods', 'PUT,GET,HEAD');
      res.setHeader(
        'access-control-allow-headers',
        req.headers['access-control-request-headers'] || '*'
      );
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url!, 'https://blob.test');
    const path = url.pathname;
    const existing = blobs.get(path);
    const headers = req.headers;
    const error = (status: number) => res.writeHead(status).end();
    const metadata = Object.fromEntries(
      Object.entries(headers)
        .filter(([name]) => name.startsWith('x-ms-meta-'))
        .map(([name, value]) => [name.slice(10), String(value)])
    );
    if (req.method === 'PUT') {
      if (headers.authorization) {
        if (!existing || url.searchParams.get('comp') !== 'properties')
          return void error(405);
        if (headers['if-match'] !== existing.etag) return void error(412);
        existing.type = String(headers['x-ms-blob-content-type']);
        existing.etag = '"' + randomUUID() + '"';
        res.writeHead(200).end();
        return;
      }
      if (
        !url.searchParams.get('sig') ||
        url.searchParams.get('sp') !== 'c' ||
        Date.parse(url.searchParams.get('se')!) <= Date.now() ||
        headers.auth ||
        headers.showorg ||
        headers.cookie
      )
        return void error(403);
      let bytes = await buffer(req);
      if (
        url.searchParams.has('comp') &&
        (headers['x-ms-version'] ?? '') < '2026-04-06'
      )
        return void error(403);
      const failure = await options.receive?.(url, bytes);
      if (failure) {
        res.setHeader('x-ms-error-code', 'ServerBusy');
        res.setHeader('retry-after', '1');
        return void error(failure);
      }
      if (blobs.has(path)) return void error(403);
      if (url.searchParams.get('comp') === 'block') {
        blocks.set(path + '/' + url.searchParams.get('blockid'), bytes);
        res.writeHead(201).end();
        return;
      }
      if (url.searchParams.get('comp') === 'blocklist') {
        const ordered = Array.from(
          bytes.toString().matchAll(/<Latest>([^<]+)<\/Latest>/g),
          ([, id]) => blocks.get(path + '/' + id)!
        );
        bytes = Buffer.concat(ordered);
      }
      blobs.set(path, {
        bytes,
        metadata,
        type: String(
          headers['x-ms-blob-content-type'] || 'application/octet-stream'
        ),
        etag: '"' + randomUUID() + '"',
      });
      if (loseCommitResponse) {
        loseCommitResponse = false;
        req.socket.destroy();
        return;
      }
      res.writeHead(201).end();
      return;
    }
    if (!existing) return void error(404);
    if (req.method === 'DELETE' && headers.authorization) {
      if (headers['if-match'] && headers['if-match'] !== existing.etag)
        return void error(412);
      blobs.delete(path);
      res.writeHead(202).end();
      return;
    }
    if (req.method !== 'HEAD' && req.method !== 'GET') return void error(405);
    if (headers['if-match'] && headers['if-match'] !== existing.etag)
      return void error(412);
    const range = headers['x-ms-range'] || headers.range;
    const bounds = range && /^bytes=(\d+)-(\d*)$/.exec(String(range));
    if (range && !bounds) return void error(416);
    const start = bounds ? Number(bounds[1]) : 0;
    const end =
      bounds && bounds[2] ? Number(bounds[2]) : existing.bytes.length - 1;
    if (range && (start > end || start >= existing.bytes.length))
      return void error(416);
    const bytes = existing.bytes.subarray(start, end + 1);
    res
      .writeHead(range ? 206 : 200, {
        'content-length': bytes.length,
        'content-type': existing.type,
        'x-ms-blob-type': 'BlockBlob',
        ...Object.fromEntries(
          Object.entries(existing.metadata).map(([k, v]) => [
            'x-ms-meta-' + k,
            v,
          ])
        ),
        ...(range
          ? {
              'content-range':
                'bytes ' +
                start +
                '-' +
                (start + bytes.length - 1) +
                '/' +
                existing.bytes.length,
            }
          : {}),
        etag: existing.etag,
      })
      .end(req.method === 'GET' ? bytes : undefined);
  });
  origin.listen(0, '127.0.0.1');
  await once(origin, 'listening');
  return {
    url: 'https://127.0.0.1:' + (origin.address() as AddressInfo).port,
    loseNextCommitResponse() {
      loseCommitResponse = true;
    },
    async close() {
      origin.closeAllConnections();
      await new Promise<void>((resolve) => origin.close(() => resolve()));
      tls.restoreTrust();
    },
  };
}
