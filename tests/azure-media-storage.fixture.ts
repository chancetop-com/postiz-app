import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { buffer } from 'node:stream/consumers';
import { createBlobTestTls } from './azure-blob-tls.fixture';
import { vi } from 'vitest';

export async function startAzureMediaStorage() {
  const committed = new Map<string, { parts: Buffer[]; type: string }>();
  const blocks = new Map<string, Buffer>();
  // Identical blocks can share storage, including in the optional 1 GiB test.
  const contents = new Map<string, Buffer>();
  const tls = createBlobTestTls();
  const blob = createServer(tls, async (req, res) => {
    const url = new URL(req.url!, 'https://blob');
    if (req.method === 'GET' && !url.search && !req.headers.authorization) {
      const media = committed.get(url.pathname);
      if (!media) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': media.type });
      for (const part of media.parts) res.write(part);
      res.end();
      return;
    }
    if (
      req.method !== 'PUT' ||
      !url.pathname.startsWith('/postiz/') ||
      !req.headers.authorization
    ) {
      res.writeHead(400).end();
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await buffer(req);
    } catch (error) {
      if (req.aborted) return;
      throw error;
    }
    if (url.searchParams.get('comp') === 'block') {
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (!contents.has(hash)) contents.set(hash, bytes);
      blocks.set(
        url.pathname + '/' + url.searchParams.get('blockid'),
        contents.get(hash)!
      );
    } else if (url.searchParams.get('comp') === 'blocklist') {
      const parts = Array.from(
        bytes.toString().matchAll(/<Latest>([^<]+)<\/Latest>/g),
        ([, id]) => blocks.get(url.pathname + '/' + id)!
      );
      committed.set(url.pathname, {
        parts,
        type: String(req.headers['x-ms-blob-content-type']),
      });
    } else {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(201).end();
  });
  blob.listen(0, '127.0.0.1');
  await once(blob, 'listening');
  const port = (blob.address() as AddressInfo).port;
  const origin = 'https://127.0.0.1:' + port;
  const accountKey = Buffer.alloc(32, 3).toString('base64');
  vi.stubEnv('STORAGE_PROVIDER', 'azure');
  vi.stubEnv(
    'AZURE_CONNECTIONURL',
    `DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=${accountKey};BlobEndpoint=${origin}`
  );
  vi.stubEnv('AZURE_BASEPATH', 'dev');
  vi.stubEnv('AZURE_CONTAINER', 'postiz');
  vi.stubEnv('UPLOAD_DIRECTORY', undefined);

  return {
    committed,
    origin,
    async close() {
      tls.restoreTrust();
      if (blob.listening) {
        blob.closeAllConnections();
        await new Promise<void>((resolve) => blob.close(() => resolve()));
      }
    },
  };
}
