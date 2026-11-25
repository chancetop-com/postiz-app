import 'reflect-metadata';
import { createLoopbackCertificate } from './azure-blob-tls.fixture';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { buffer } from 'node:stream/consumers';
import type { Integration } from '@prisma/client';
import sharp from 'sharp';
import { Agent } from 'undici';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { DiscordProvider } from '@gitroom/nestjs-libraries/integrations/social/discord.provider';
import { VkProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.provider';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { DribbbleProvider } from '@gitroom/nestjs-libraries/integrations/social/dribbble.provider';

vi.mock('@gitroom/helpers/utils/timer', () => ({ timer: async () => {} }));

const blobPrefix = 'https://fixture.blob.core.windows.net/postiz/dev/org';
const image = {
  type: 'image' as const,
  path: blobPrefix + '/ink.png',
  alt: 'Blue ink',
};
const video = { type: 'video' as const, path: blobPrefix + '/clip.mp4' };
const post = {
  id: 'scheduled-1',
  message: 'Ink study',
  settings: { channel: 'room', title: 'Study', team: '' },
  media: [image, video],
};
const integration = {} as Integration;
const assets = new Map<string, Buffer>();
const allowedHosts = new Set([
  'fixture.blob.core.windows.net',
  'discord.com',
  'instance.example',
  'api.vk.ru',
  'upload.example',
  'api.dribbble.com',
]);
const requests: Request[] = [];
let platform: (request: Request) => Response | null;
let server: https.Server;
let agent: Agent;
let httpsAgent: https.Agent;
let origin: string;
let interceptor: number;
const axiosClient = getSsrfSafeAxios();
const realFetch = globalThis.fetch;

function loopback(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.host))
    throw new Error('Unexpected destination: ' + url);
  return origin + '/' + parsed.host + parsed.pathname + parsed.search;
}

beforeAll(async () => {
  // Trust a new certificate only in the two test clients. All HTTP and multipart
  // serialization runs normally, with the platform and Blob endpoint on one loopback port.
  const { key, cert } = createLoopbackCertificate();
  agent = new Agent({ connect: { ca: cert } });
  httpsAgent = new https.Agent({ ca: cert });
  server = https.createServer({ cert, key }, async (req, res) => {
    const bytes = await buffer(req);
    const url = 'https:/' + req.url;
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, String(v)]]
      ),
      body: bytes.length ? bytes : undefined,
    });
    requests.push(request);
    const asset = assets.get(url);
    const result = asset
      ? new Response(req.method === 'HEAD' ? null : asset, {
          headers: { 'content-length': String(asset.length) },
        })
      : platform(request);
    if (result === null) {
      res.destroy();
      return;
    }
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'https://127.0.0.1:' + (server.address() as AddressInfo).port;
  interceptor = axiosClient.interceptors.request.use((config) => {
    config.url = loopback(config.url!);
    config.httpsAgent = httpsAgent;
    config.proxy = false;
    return config;
  });
  assets.set(
    image.path,
    await sharp({
      create: { width: 400, height: 300, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
  );
  assets.set(
    video.path,
    readFileSync(new URL('./fixtures/blue-frame.mp4', import.meta.url))
  );
});

beforeEach(() => {
  requests.length = 0;
  platform = () =>
    Response.json({ message: 'Unexpected request' }, { status: 400 });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    realFetch(loopback(String(url)), {
      ...init,
      dispatcher: agent,
    } as RequestInit)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  axiosClient.interceptors.request.eject(interceptor);
  httpsAgent?.destroy();
  await agent?.close();
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
});

async function expectFile(form: FormData, field: string, source: string) {
  const file = form.get(field) as File;
  expect(file?.name).toBe(new URL(source).pathname.split('/').at(-1));
  expect(Buffer.from(await file.arrayBuffer())).toEqual(assets.get(source));
}

it('streams both Discord attachments into the message, first reply and subsequent thread reply', async () => {
  const provider = new DiscordProvider();
  platform = (req) =>
    Response.json({ id: req.url.endsWith('/threads') ? 'root' : 'sent' });
  const main = await provider.post('guild', 'token', [post]);
  const first = await provider.comment(
    'guild',
    'root',
    undefined,
    'token',
    [post],
    integration
  );
  const later = await provider.comment(
    'guild',
    'root',
    'previous',
    'token',
    [post],
    integration
  );
  const urls = [main, first, later].map(([entry]) => entry.releaseURL);
  expect(urls).toEqual([
    'https://discord.com/channels/guild/room/sent',
    'https://discord.com/channels/guild/root/sent',
    'https://discord.com/channels/guild/root/sent',
  ]);
  const messages = requests.filter((r) => r.url.endsWith('/messages'));
  expect(messages.map((r) => new URL(r.url).pathname)).toEqual([
    '/api/channels/room/messages',
    '/api/channels/root/messages',
    '/api/channels/root/messages',
  ]);
  for (const request of messages) {
    expect(Number(request.headers.get('content-length'))).toBe(
      (await request.clone().arrayBuffer()).byteLength
    );
    const form = await request.formData();
    expect(
      JSON.parse(String(form.get('payload_json'))).attachments.map(
        (a: { filename: string }) => a.filename
      )
    ).toEqual(['ink.png', 'clip.mp4']);
    await expectFile(form, 'files[0]', image.path);
    await expectFile(form, 'files[1]', video.path);
  }
  for (const asset of [image, video]) {
    expect(
      requests.filter((r) => r.url === asset.path).map((r) => r.method)
    ).toEqual(['HEAD', 'GET', 'HEAD', 'GET', 'HEAD', 'GET']);
  }
});

it('reports a Discord attachment rejection to the scheduler', async () => {
  platform = () => Response.json({ code: 40005 }, { status: 413 });
  await expect(
    new DiscordProvider().post('guild', 'token', [post])
  ).rejects.toThrow("Attachment exceeds Discord's size limit");
});

it.each(['post', 'comment'] as const)(
  'VK attaches the saved photo and video to the %s using their respective owners',
  async (kind) => {
    const provider = new VkProvider();
    platform = (req) => {
      switch (new URL(req.url).pathname) {
        case '/method/photos.getWallUploadServer':
          return Response.json({
            response: { upload_url: 'https://upload.example/photo' },
          });
        case '/method/video.save':
          return Response.json({
            response: {
              upload_url: 'https://upload.example/video',
              owner_id: -61,
              video_id: 91,
            },
          });
        case '/photo':
          return Response.json({
            photo: 'uploaded-photo',
            server: 47,
            hash: 'hash',
          });
        case '/video':
          return Response.json({ video_id: 91, owner_id: -61 });
        case '/method/photos.saveWallPhoto':
          return Response.json({ response: [{ id: 90, owner_id: 51 }] });
        case '/method/wall.post':
          return Response.json({ response: { post_id: 40 } });
        case '/method/wall.createComment':
          return Response.json({ response: { comment_id: 41 } });
        default:
          return Response.json({ error: 'route' }, { status: 400 });
      }
    };
    const result =
      kind === 'post'
        ? await provider.post('1', 'token', [post])
        : await provider.comment(
            '1',
            '40',
            undefined,
            'token',
            [post],
            integration
          );
    const get = (path: string) =>
      requests.find((r) => new URL(r.url).pathname === path)!;
    await expectFile(await get('/photo').formData(), 'photo', image.path);
    await expectFile(await get('/video').formData(), 'video_file', video.path);
    expect(
      Object.fromEntries(await get('/method/photos.saveWallPhoto').formData())
    ).toMatchObject({ photo: 'uploaded-photo', server: '47', hash: 'hash' });
    const wall = await get(
      kind === 'post' ? '/method/wall.post' : '/method/wall.createComment'
    ).formData();
    expect(wall.get('attachments')).toBe('photo51_90,video-61_91');
    if (kind === 'comment') expect(wall.get('post_id')).toBe('40');
    expect(result[0]).toMatchObject({
      status: 'completed',
      postId: kind === 'post' ? '40' : '41',
    });
  }
);

it('stops before creating a VK comment when its video upload is rejected', async () => {
  platform = (req) =>
    req.url.includes('/method/video.save?')
      ? Response.json({
          response: {
            upload_url: 'https://upload.example/video',
            owner_id: 51,
            video_id: 91,
          },
        })
      : Response.json({
          error: { error_code: 100, error_msg: 'Unsupported video' },
        });
  await expect(
    new VkProvider().comment(
      '1',
      '40',
      undefined,
      'token',
      [{ ...post, media: [video] }],
      integration
    )
  ).rejects.toThrow('Unsupported video');
  expect(requests.some((r) => r.url.includes('wall.createComment'))).toBe(
    false
  );
});

it('polls the Mastodon instance media ID until ready and attaches it to one status', async () => {
  vi.stubEnv('MASTODON_URL', 'https://instance.example');
  const provider = new MastodonProvider();
  let ready = false;
  platform = (req) => {
    switch (req.url) {
      case 'https://instance.example/api/v2/media':
        return Response.json({ id: 'instance-id', url: null }, { status: 202 });
      case 'https://instance.example/api/v1/media/instance-id':
        return Response.json(
          { id: 'instance-id' },
          { status: ready ? 200 : 206 }
        );
      case 'https://instance.example/api/v1/statuses':
        return Response.json({ id: 'status-id' });
      default:
        return Response.json({ error: 'Unknown route' }, { status: 400 });
    }
  };
  const [submitted] = await provider.postPending(
    'me',
    'token',
    [{ ...post, media: [image] }],
    integration
  );
  expect(submitted.status).toBe('pending');
  const form = await requests
    .find((r) => r.url.endsWith('/v2/media'))!
    .formData();
  await expectFile(form, 'file', image.path);
  expect(form.get('description')).toBe('Blue ink');
  expect(
    (
      await provider.checkPostStatus(
        'token',
        submitted.pendingData,
        integration
      )
    ).status
  ).toBe('pending');
  expect(requests.some((r) => r.url.endsWith('/statuses'))).toBe(false);
  ready = true;
  expect(
    (
      await provider.checkPostStatus(
        'token',
        submitted.pendingData,
        integration
      )
    ).status
  ).toBe('ready');
  expect(
    await provider.finalizePost('token', submitted.pendingData, integration)
  ).toMatchObject({ status: 'completed', postId: 'status-id' });
  const status = await requests
    .find((r) => r.url.endsWith('/statuses'))!
    .formData();
  expect(status.getAll('media_ids[]')).toEqual(['instance-id']);
  expect(requests.filter((r) => r.url.endsWith('/v2/media'))).toHaveLength(1);
});

it('waits for an accepted Mastodon reply attachment before replying to the previous status', async () => {
  vi.stubEnv('MASTODON_URL', 'https://instance.example');
  let checks = 0;
  platform = (req) => {
    if (req.url.endsWith('/media'))
      return Response.json({ id: 'reply-media' }, { status: 202 });
    if (req.url.endsWith('/media/reply-media'))
      return Response.json(
        { id: 'reply-media' },
        { status: ++checks === 1 ? 206 : 200 }
      );
    if (req.url.endsWith('/statuses') && checks === 2)
      return Response.json({ id: 'reply-id' });
    return Response.json({ error: 'not finished processing' }, { status: 422 });
  };
  const [reply] = await new MastodonProvider().comment(
    'me',
    'root',
    'prior',
    'token',
    [{ ...post, media: [video] }],
    integration
  );
  expect(reply).toMatchObject({ status: 'completed', postId: 'reply-id' });
  const uploads = requests.filter((r) => r.url.endsWith('/media'));
  expect(uploads).toHaveLength(1);
  await expectFile(await uploads[0].formData(), 'file', video.path);
  const statuses = requests.filter((r) => r.url.endsWith('/statuses'));
  expect(statuses).toHaveLength(1);
  const form = await statuses[0].formData();
  expect(form.get('in_reply_to_id')).toBe('prior');
  expect(form.getAll('media_ids[]')).toEqual(['reply-media']);
});

it('retains the Mastodon processing-rejection reason and never posts or reuploads the reply', async () => {
  vi.stubEnv('MASTODON_URL', 'https://instance.example');
  platform = (req) =>
    req.url.endsWith('/media')
      ? Response.json({ id: 'bad-media' }, { status: 202 })
      : Response.json({ error: 'Unsupported video codec' }, { status: 422 });
  await expect(
    new MastodonProvider().comment(
      'me',
      'root',
      undefined,
      'token',
      [{ ...post, media: [video] }],
      integration
    )
  ).rejects.toThrow('Unsupported video codec');
  expect(
    requests
      .filter((r) => r.method === 'POST')
      .map((r) => new URL(r.url).pathname)
  ).toEqual(['/api/v2/media']);
});

it('keeps legacy Mastodon instances usable when the asynchronous upload endpoint is unavailable', async () => {
  vi.stubEnv('MASTODON_URL', 'https://instance.example');
  platform = (req) =>
    req.url.endsWith('/v1/media')
      ? Response.json({ id: 'legacy-media' })
      : Response.json({ error: 'Route not found' }, { status: 404 });
  const [created] = await new MastodonProvider().postPending(
    'me',
    'token',
    [{ ...post, media: [image] }],
    integration
  );
  expect(created.pendingData.mediaIds).toEqual(['legacy-media']);
  const upload = requests.find((r) => r.url.endsWith('/v1/media'))!;
  await expectFile(await upload.formData(), 'file', image.path);
});

it('uploads a valid original Dribbble image once and polls the accepted shot through 404 and 503', async () => {
  const provider = new DribbbleProvider();
  const shot = { ...post, media: [image] };
  let code = 404;
  platform = (req) =>
    req.method === 'POST'
      ? new Response(null, {
          status: 202,
          headers: { location: 'https://api.dribbble.com/v2/shots/87' },
        })
      : Response.json(
          code === 200
            ? { id: 87, html_url: 'https://dribbble.com/shots/87-ink' }
            : { message: 'pending' },
          { status: code }
        );
  expect(await provider.checkValidity([shot.media])).toBe(true);
  const [accepted] = await provider.postPending('designer', 'token', [shot]);
  expect(accepted).toMatchObject({ status: 'pending', postId: '87' });
  for (const responseCode of [404, 503]) {
    code = responseCode;
    expect(
      (await provider.checkPostStatus('token', accepted.pendingData)).status
    ).toBe('pending');
  }
  code = 200;
  expect(
    await provider.checkPostStatus('token', accepted.pendingData)
  ).toMatchObject({
    status: 'completed',
    postId: '87',
    releaseURL: 'https://dribbble.com/shots/87-ink',
  });
  const shots = requests.filter(
    (r) => new URL(r.url).host === 'api.dribbble.com'
  );
  expect(shots.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
    ['POST', '/v2/shots'],
    ['GET', '/v2/shots/87'],
    ['GET', '/v2/shots/87'],
    ['GET', '/v2/shots/87'],
  ]);
  const form = await shots[0].formData();
  expect(form.get('title')).toBe('Study');
  expect(form.get('description')).toBe('Ink study');
  await expectFile(form, 'image', image.path);
});

it('rejects a Dribbble gallery or oversized image and reports a platform image rejection', async () => {
  const provider = new DribbbleProvider();
  const tooWide = { ...image, path: blobPrefix + '/wide.png' };
  assets.set(
    tooWide.path,
    await sharp({
      create: { width: 801, height: 600, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
  );
  expect(await provider.checkValidity([[image, tooWide]])).toBe(
    'Requires one item'
  );
  await expect(
    provider.checkValidity([[{ ...image, path: image.path + '#mp4' }]])
  ).resolves.toBe(true);
  await expect(
    provider.checkValidity([[{ path: blobPrefix + '/clip.MP4' }]])
  ).resolves.toMatch(/mp4 files/);
  expect(await provider.checkValidity([[tooWide]])).toContain(
    '400x300 or 800x600'
  );
  platform = () =>
    Response.json({ message: 'Invalid image file' }, { status: 422 });
  await expect(
    provider.postPending('designer', 'token', [{ ...post, media: [image] }])
  ).rejects.toThrow('Invalid image file');
  expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
});

it('marks an accepted Dribbble shot with no tracking ID as unconfirmed', async () => {
  platform = () => new Response(null, { status: 202 });
  await expect(
    new DribbbleProvider().postPending('designer', 'token', [
      { ...post, media: [image] },
    ])
  ).rejects.toMatchObject({
    type: 'bad_body',
    nonRetryable: true,
    details: [expect.objectContaining({ outcome: 'unconfirmed' })],
  });
  expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
});

it('stops after Dribbble receives the upload but the connection closes before a response', async () => {
  platform = () => null;
  await expect(
    new DribbbleProvider().postPending('designer', 'token', [
      { ...post, media: [image] },
    ])
  ).rejects.toMatchObject({
    type: 'bad_body',
    nonRetryable: true,
    details: [expect.objectContaining({ outcome: 'unconfirmed' })],
  });
  const uploads = requests.filter((r) => r.method === 'POST');
  expect(uploads).toHaveLength(1);
  await expectFile(await uploads[0].formData(), 'image', image.path);
});

it('returns the shot reference directly to legacy Dribbble workflows', async () => {
  platform = () =>
    new Response(null, {
      status: 202,
      headers: { location: 'https://api.dribbble.com/v2/shots/87' },
    });
  expect(
    await new DribbbleProvider().post('designer', 'token', [
      { ...post, media: [image] },
    ])
  ).toEqual([
    {
      id: post.id,
      status: 'completed',
      postId: '87',
      releaseURL: 'https://dribbble.com/shots/87',
    },
  ]);
});

it('stops a Mastodon reply if the instance omits the accepted media ID', async () => {
  vi.stubEnv('MASTODON_URL', 'https://instance.example');
  platform = (req) =>
    req.url.endsWith('/media')
      ? Response.json({ url: null }, { status: 202 })
      : Response.json({ id: 'unwanted-status' });
  await expect(
    new MastodonProvider().comment(
      'me',
      'root',
      undefined,
      'token',
      [{ ...post, media: [video] }],
      integration
    )
  ).rejects.toThrow('media ID');
  expect(requests.some((r) => r.url.endsWith('/statuses'))).toBe(false);
});
