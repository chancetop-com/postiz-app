import 'reflect-metadata';
import { createServer } from 'node:http';
import { createServer as createHttpsServer, get as httpsGet } from 'node:https';
import { createLoopbackCertificate } from './azure-blob-tls.fixture';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  getPublicKey,
  Relay,
  verifyEvent,
  type Event as NostrEvent,
} from 'nostr-tools';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { NostrProvider } from '@gitroom/nestjs-libraries/integrations/social/nostr.provider';
import { LemmyProvider } from '@gitroom/nestjs-libraries/integrations/social/lemmy.provider';
import { SlackProvider } from '@gitroom/nestjs-libraries/integrations/social/slack.provider';
import type { Integration } from '@prisma/client';
import type { PostDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const prefix = '/postiz/dev/org-1';
const imageBytes = readFileSync('apps/frontend/public/no-picture.jpg');
const videoBytes = readFileSync('tests/fixtures/azure-message-media/clip.mp4');
const pdfBytes = readFileSync(
  'tests/fixtures/azure-message-media/schedule.pdf'
);
const photo = { type: 'image' as const, path: '' };
const video = { type: 'video' as const, path: '' };
const document = { type: 'image' as const, path: '' };
const post: PostDetails = {
  id: 'scheduled',
  message: 'From the meetup',
  media: [photo, video],
  settings: {},
};
const integration = { name: 'Meetups' } as Integration;
const signingKey = '01'.repeat(32);

let blobServer: ReturnType<typeof createHttpsServer>;
let certificate: string;
beforeAll(async () => {
  const { key, cert } = createLoopbackCertificate();
  certificate = cert;
  blobServer = createHttpsServer({ key, cert }, (req, res) => {
    if (req.url === prefix + '/photo.jpeg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' }).end(imageBytes);
    } else if (req.url === prefix + '/clip.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' }).end(videoBytes);
    } else if (req.url === prefix + '/schedule.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' }).end(pdfBytes);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) =>
    blobServer.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const base =
    'https://127.0.0.1:' + (blobServer.address() as AddressInfo).port + prefix;
  photo.path = base + '/photo.jpeg';
  video.path = base + '/clip.mp4';
  document.path = base + '/schedule.pdf';
});
afterAll(async () => {
  blobServer?.closeAllConnections();
  if (blobServer?.listening)
    await new Promise<void>((resolve) => blobServer.close(() => resolve()));
});

function anonymousRead(url: string) {
  return new Promise<Buffer>((resolve, reject) => {
    httpsGet(url, { ca: certificate }, (res) => {
      if (res.statusCode !== 200)
        return reject(new Error('Media HTTP ' + res.statusCode));
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function lemmyAccount() {
  vi.stubEnv('JWT_SECRET', 'local-message-test-secret');
  return {
    customInstanceDetails: AuthService.fixedEncryption(
      JSON.stringify({
        service: 'https://lemmy.example.test',
        identifier: 'user',
        password: 'local',
      })
    ),
  } as Integration;
}

function platformFetch(handle: (path: string, body: any) => Response) {
  const request = vi.fn((input: string, init: RequestInit) => {
    const url = new URL(input);
    return handle(
      url.pathname,
      init.body ? JSON.parse(String(init.body)) : undefined
    );
  });
  vi.stubGlobal('fetch', request);
  return request;
}

function nostrToken() {
  vi.stubEnv('JWT_SECRET', 'local-message-test-secret');
  return AuthService.signJWT({ password: signingKey });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('surfaces the relay rejection when no relay accepts the signed Nostr note', async () => {
  const rejected = new Error('blocked: media URL rejected');
  vi.spyOn(Relay, 'connect').mockResolvedValue({
    publish: vi.fn().mockRejectedValue(rejected),
    close: vi.fn(),
  } as unknown as Relay);

  await expect(
    new NostrProvider().post('user', nostrToken(), [post])
  ).rejects.toBe(rejected);
});

it('returns the signed note ID and preserves both Blob URLs in notes and replies', async () => {
  const events: NostrEvent[] = [];
  const relay = {
    publish: async (event: NostrEvent) => {
      events.push(JSON.parse(JSON.stringify(event)));
      return '';
    },
    close: vi.fn(),
  };
  vi.spyOn(Relay, 'connect')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(relay as unknown as Relay);
  const provider = new NostrProvider();
  const pubkey = getPublicKey(Buffer.from(signingKey, 'hex'));
  const token = nostrToken();
  const [note] = await provider.post(pubkey, token, [post]);
  const [reply] = await provider.comment(
    pubkey,
    note.postId,
    undefined,
    token,
    [post],
    integration
  );

  for (const published of [note, reply]) {
    const event = events.find(({ id }) => id === published.postId);
    expect(event).toBeDefined();
    expect(verifyEvent(event!)).toBe(true);
    const [text, imageURL, videoURL] = event!.content.split('\n\n');
    expect([text, imageURL, videoURL]).toEqual([
      post.message,
      photo.path,
      video.path,
    ]);
    await expect(anonymousRead(imageURL)).resolves.toEqual(imageBytes);
    await expect(anonymousRead(videoURL)).resolves.toEqual(videoBytes);
    expect(published.releaseURL).toBe('https://primal.net/e/' + event!.id);
  }
  expect(events.find(({ id }) => id === reply.postId)?.tags).toContainEqual([
    'e',
    note.postId,
    '',
    'reply',
  ]);
});

it('accepts a JPEG and publishes only its first thumbnail on Lemmy, with a text comment', async () => {
  const provider = new LemmyProvider();
  const account = lemmyAccount();
  const message = {
    ...post,
    settings: {
      subreddit: [
        { value: { subreddit: 'general', id: '7', title: 'News', url: '' } },
      ],
    },
  };
  const payloads: Record<string, unknown>[] = [];
  platformFetch((path, body) => {
    if (path === '/api/v3/user/login')
      return Response.json({ jwt: 'local-jwt' });
    payloads.push(body);
    if (path === '/api/v3/post')
      return Response.json({ post_view: { post: { id: 41 } } });
    if (path === '/api/v3/comment')
      return Response.json({ comment_view: { comment: { id: 42 } } });
    throw new Error('Unexpected request ' + path);
  });
  expect(await provider.checkValidity([message.media!])).toBe(true);
  const [published] = await provider.post('user', 'token', [message], account);
  const [reply] = await provider.comment(
    'user',
    published.postId,
    undefined,
    'token',
    [message],
    account
  );
  expect(payloads).toEqual([
    {
      community_id: 7,
      name: 'News',
      body: post.message,
      custom_thumbnail: photo.path,
      nsfw: false,
    },
    { post_id: 41, content: post.message },
  ]);
  expect([published.postId, reply.postId]).toEqual(['41', '42']);
});

it('returns the Lemmy blocked URL error without a file upload', async () => {
  const account = lemmyAccount();
  const request = platformFetch((path) => {
    if (path === '/api/v3/user/login')
      return Response.json({ jwt: 'local-jwt' });
    if (path === '/api/v3/post')
      return Response.json({ error: 'blocked_url' }, { status: 400 });
    throw new Error('Unexpected request ' + path);
  });
  const message = {
    ...post,
    settings: {
      subreddit: [
        { value: { subreddit: 'general', id: '7', title: 'News', url: '' } },
      ],
    },
  };
  await expect(
    new LemmyProvider().post('user', 'token', [message], account)
  ).rejects.toMatchObject({
    message: expect.stringContaining('blocks the URL'),
    details: [expect.objectContaining({ json: '{"error":"blocked_url"}' })],
  });
  expect(request).toHaveBeenCalledTimes(2);
});

it('puts Blob images in Slack message and reply blocks and rejects videos', async () => {
  const provider = new SlackProvider();
  const message = { ...post, media: [photo], settings: { channel: 'room' } };
  const payloads: any[] = [];
  platformFetch((path, body) => {
    if (path === '/api/conversations.join') return Response.json({ ok: true });
    if (path === '/api/chat.getPermalink')
      return Response.json({ permalink: 'https://example.test/message' });
    if (path !== '/api/chat.postMessage')
      throw new Error('Unexpected request ' + path);
    payloads.push(body);
    return Response.json({
      ok: true,
      ts: 'ts-' + payloads.length,
      channel: 'room',
    });
  });
  expect(await provider.checkValidity([[photo], [video]])).toMatch(/no video/i);
  await expect(
    provider.checkValidity([[{ path: photo.path + '#mp4' }]])
  ).resolves.toBe(true);
  await expect(
    provider.checkValidity([[{ path: 'https://media.example/clip.MP4' }]])
  ).resolves.toMatch(/no video/i);
  const [published] = await provider.post(
    'user',
    'token',
    [message],
    integration
  );
  const [reply] = await provider.comment(
    'user',
    published.postId,
    undefined,
    'token',
    [message],
    integration
  );
  expect([published.postId, reply.postId]).toEqual(['ts-1', 'ts-2']);
  expect(payloads[0].thread_ts).toBeUndefined();
  expect(payloads[1].thread_ts).toBe(published.postId);
  for (const body of payloads) {
    expect(body.blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: post.message } },
      { type: 'image', image_url: photo.path, alt_text: '' },
    ]);
  }
});

it('preserves Slack image block errors from a rejected reply without resending it', async () => {
  const request = platformFetch(() =>
    Response.json({
      ok: false,
      error: 'invalid_blocks',
      errors: ['failed to download image'],
    })
  );
  await expect(
    new SlackProvider().comment(
      'user',
      'ts-1',
      undefined,
      'token',
      [{ ...post, media: [photo], settings: { channel: 'room' } }],
      integration
    )
  ).rejects.toThrow('invalid_blocks: failed to download image');
  expect(request).toHaveBeenCalledTimes(1);
});

// Route the real SDKs to the local platform so these assertions cover their wire encoding.
let platformOrigin: string;
vi.mock('node-telegram-bot-api', async (importOriginal) => {
  const { default: Bot } = await importOriginal<
    typeof import('node-telegram-bot-api')
  >();
  return {
    default: class extends Bot {
      constructor() {
        super('fixture', { baseApiUrl: platformOrigin });
      }
    },
  };
});
vi.mock('@neynar/nodejs-sdk', async (importOriginal) => {
  const { NeynarAPIClient } = await importOriginal<
    typeof import('@neynar/nodejs-sdk')
  >();
  return {
    NeynarAPIClient: class extends NeynarAPIClient {
      constructor(config: ConstructorParameters<typeof NeynarAPIClient>[0]) {
        super({ ...config, basePath: platformOrigin });
      }
    },
  };
});

describe('Telegram Bot and Farcaster casts', () => {
  const requests: { url: URL; body: string }[] = [];
  let telegram: import('@gitroom/nestjs-libraries/integrations/social/telegram.provider').TelegramProvider;
  let farcaster: import('@gitroom/nestjs-libraries/integrations/social/farcaster.provider').FarcasterProvider;
  let replyStatus = 200;
  let replyBody: unknown;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: new URL(request.url!, platformOrigin),
      body: Buffer.concat(chunks).toString(),
    });
    response.writeHead(replyStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify(replyBody));
  });

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject).listen(0, '127.0.0.1', resolve);
    });
    platformOrigin =
      'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    vi.stubEnv('STORAGE_PROVIDER', 'azure');
    const { TelegramProvider } = await import(
      '@gitroom/nestjs-libraries/integrations/social/telegram.provider'
    );
    const { FarcasterProvider } = await import(
      '@gitroom/nestjs-libraries/integrations/social/farcaster.provider'
    );
    telegram = new TelegramProvider();
    farcaster = new FarcasterProvider();
  });
  afterEach(() => {
    requests.length = 0;
    replyStatus = 200;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ['photo', 'sendPhoto', photo, imageBytes],
    ['video', 'sendVideo', video, videoBytes],
    ['document', 'sendDocument', document, pdfBytes],
  ] as const)(
    'sends a Telegram %s as a public URL',
    async (field, method, media, expectedBytes) => {
      replyBody = { ok: true, result: { message_id: 82 } };
      const [result] = await telegram.post('room', 'chat', [
        { ...post, media: [media] },
      ]);
      expect(result.postId).toBe('82');
      expect(requests).toHaveLength(1);
      expect(requests[0].url.pathname).toBe('/botfixture/' + method);
      expect(requests[0].url.searchParams.get(field)).toBe(media.path);
      await expect(
        anonymousRead(requests[0].url.searchParams.get(field)!)
      ).resolves.toEqual(expectedBytes);
      expect(requests[0].body).toBe('');
    }
  );

  it('sends a Telegram reply album with typed Blob URLs and its original parent', async () => {
    replyBody = { ok: true, result: [{ message_id: 83 }, { message_id: 84 }] };
    const [reply] = await telegram.comment(
      'room',
      '82',
      undefined,
      'chat',
      [post],
      integration
    );
    expect(reply.postId).toBe('83');
    expect(requests).toHaveLength(1);
    const { url } = requests[0];
    expect(url.pathname).toBe('/botfixture/sendMediaGroup');
    expect(url.searchParams.get('reply_to_message_id')).toBe('82');
    expect(JSON.parse(url.searchParams.get('media')!)).toEqual([
      {
        type: 'photo',
        media: photo.path,
        caption: post.message,
        parse_mode: 'HTML',
      },
      { type: 'video', media: video.path, parse_mode: 'HTML' },
    ]);
  });

  it('preserves the Telegram download rejection and sends the photo once', async () => {
    replyStatus = 400;
    replyBody = {
      ok: false,
      error_code: 400,
      description: 'Bad Request: failed to get HTTP URL content',
    };
    await expect(
      telegram.post('room', 'chat', [{ ...post, media: [photo] }])
    ).rejects.toMatchObject({
      message: expect.stringContaining('could not download'),
      details: [expect.objectContaining({ json: JSON.stringify(replyBody) })],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get('photo')).toBe(photo.path);
  });

  it('embeds Blob images in Farcaster casts and replies', async () => {
    const message = { ...post, media: [photo], settings: { subreddit: [] } };
    expect(await farcaster.checkValidity([[photo], [video]])).toMatch(
      /only accept images/i
    );
    replyBody = { cast: { hash: '0x11', author: { username: 'user' } } };
    const [cast] = await farcaster.post('user', 'signer', [message]);
    replyBody = { cast: { hash: '0x22', author: { username: 'user' } } };
    const [reply] = await farcaster.comment(
      'user',
      cast.postId,
      undefined,
      'signer',
      [message],
      integration
    );
    expect([cast.postId, reply.postId]).toEqual(['0x11', '0x22']);
    expect(requests).toHaveLength(2);
    const bodies = requests.map(({ body }) => JSON.parse(body));
    for (const body of bodies)
      expect(body.embeds).toEqual([{ url: photo.path }]);
    expect(bodies[0].parent).toBeUndefined();
    expect(bodies[1].parent).toBe('0x11');
  });

  it('propagates the rejected Farcaster embed without a file upload', async () => {
    replyStatus = 400;
    replyBody = { message: 'unsupported embed URL' };
    await expect(
      farcaster.post('user', 'signer', [
        { ...post, media: [photo], settings: { subreddit: [] } },
      ])
    ).rejects.toMatchObject({ response: { data: replyBody } });
    expect(requests).toHaveLength(1);
  });
});
