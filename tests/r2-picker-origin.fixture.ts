import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { buffer } from 'node:stream/consumers';
import { createHash, randomUUID } from 'node:crypto';
import { createBlobTestTls } from './azure-blob-tls.fixture';

// S3 multipart and the public R2 CDN share the backing objects. The real
// Uppy transport, Postiz routes and AWS SDK handle signing and serialization.
export async function startR2PickerOrigin() {
  const tls = createBlobTestTls();
  const completionRequests = new Map<string, number>();
  let onRead: (() => Promise<void>) | undefined;
  const files = new Map<
    string,
    { type: string; id: string; parts: Map<number, Buffer>; bytes?: Buffer }
  >();
  const server = createServer(tls, async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'ETag');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-private-network', 'true');
      res.setHeader('access-control-allow-methods', 'PUT,GET');
      res.setHeader(
        'access-control-allow-headers',
        req.headers['access-control-request-headers'] || '*'
      );
      return void res.writeHead(204).end();
    }
    const url = new URL(req.url!, 'https://127.0.0.1');
    const key = url.pathname.split('/').at(-1)!;
    const xml = (tag: string, fields: string) =>
      res
        .writeHead(200, { 'content-type': 'application/xml' })
        .end('<' + tag + '>' + fields + '</' + tag + '>');
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      const id = randomUUID();
      files.set(key, {
        type: String(req.headers['content-type']),
        id,
        parts: new Map(),
      });
      return void xml(
        'InitiateMultipartUploadResult',
        '<Key>' + key + '</Key><UploadId>' + id + '</UploadId>'
      );
    }
    const file = files.get(key);
    if (!file) return void res.writeHead(404).end();
    if (
      url.searchParams.get('uploadId') === file.id &&
      !file.bytes &&
      req.headers.authorization
    ) {
      if (req.method === 'GET') return void xml('ListPartsResult', '');
      if (req.method === 'DELETE') {
        files.delete(key);
        return void res.writeHead(204).end();
      }
    }
    if (req.method === 'POST' && url.searchParams.has('uploadId'))
      completionRequests.set(key, (completionRequests.get(key) || 0) + 1);
    if (req.method === 'GET' && file.bytes) {
      const isCdn = url.pathname.startsWith('/cdn/');
      if (!isCdn && !req.headers.authorization)
        return void res.writeHead(403).end();
      if (!isCdn && onRead) {
        const pause = onRead;
        onRead = undefined;
        await pause();
      }
      const bytes =
        req.headers.range === 'bytes=0-4100'
          ? file.bytes.subarray(0, 4101)
          : file.bytes;
      return void res
        .writeHead(req.headers.range ? 206 : 200, {
          'content-type': file.type,
          'content-length': bytes.length,
        })
        .end(bytes);
    }
    if (url.searchParams.get('uploadId') !== file.id)
      return void res.writeHead(404).end();
    if (file.bytes) return void res.writeHead(404).end();
    if (req.method === 'PUT' && url.searchParams.has('X-Amz-Signature')) {
      const bytes = await buffer(req);
      file.parts.set(Number(url.searchParams.get('partNumber')), bytes);
      return void res
        .writeHead(200, {
          etag: '"' + createHash('md5').update(bytes).digest('hex') + '"',
        })
        .end();
    }
    if (req.method === 'POST' && req.headers.authorization) {
      const manifest = (await buffer(req)).toString();
      const chunks = Array.from(
        manifest.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g),
        ([, part]) => file.parts.get(Number(part))!
      );
      if (!chunks.length || chunks.some((part) => !part))
        return void res.writeHead(400).end();
      file.bytes = Buffer.concat(chunks);
      return void xml(
        'CompleteMultipartUploadResult',
        '<Key>' +
          key +
          '</Key><Location>https://storage.example/' +
          key +
          '</Location>'
      );
    }
    res.writeHead(400).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: 'https://127.0.0.1:' + (server.address() as AddressInfo).port,
    completionRequests,
    holdNextValidation() {
      let started!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        started = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      onRead = async () => {
        started();
        await wait;
      };
      return { reached, release };
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      tls.restoreTrust();
    },
  };
}
