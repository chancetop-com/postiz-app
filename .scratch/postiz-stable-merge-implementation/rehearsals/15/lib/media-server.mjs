/**
 * Local media origin.
 *
 * The deployment serves `/uploads` through nginx/Next. The rehearsal serves the
 * same directory over loopback HTTP, so a provider stub reads a newly uploaded
 * file through the URL the candidate worker built — not through a test hook.
 * The same server exposes a synthetic RSS feed for autopost.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const types = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.xml': 'application/rss+xml',
};

export function startMediaServer({ uploadDirectory, feedXml }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/feed.xml') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      res.end(feedXml);
      return;
    }

    if (!url.pathname.startsWith('/uploads/')) {
      res.writeHead(404).end('not found');
      return;
    }

    const relative = normalize(url.pathname.slice('/uploads/'.length));
    const candidates = [join(uploadDirectory, relative), join(uploadDirectory, 'uploads', relative)];
    const file = candidates.find((candidate) => existsSync(candidate));
    if (!file || !file.startsWith(uploadDirectory)) {
      res.writeHead(404).end('not found');
      return;
    }

    const stat = statSync(file);
    res.writeHead(200, {
      'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
    });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export const syntheticFeed = (link) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Synthetic rehearsal feed</title>
  <link>${link}</link>
  <description>Synthetic only</description>
  <item>
    <title>Synthetic item</title>
    <link>${link}/item-1</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <description>Synthetic autopost source text</description>
  </item>
</channel></rss>`;
