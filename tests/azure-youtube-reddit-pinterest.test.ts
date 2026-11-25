import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { createLoopbackCertificate } from './azure-blob-tls.fixture';
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, Agent as HttpsAgent } from 'node:https';
import type { AddressInfo } from 'node:net';
import { Agent } from 'undici';
import { google } from 'googleapis';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import type { Integration } from '@prisma/client';
import type { RedditSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/reddit.dto';
import type {
  MediaContent,
  PostDetails,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { RedditProvider } from '@gitroom/nestjs-libraries/integrations/social/reddit.provider';
import { PinterestProvider } from '@gitroom/nestjs-libraries/integrations/social/pinterest.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

const blobBase =
  'https://fixtureaccount.blob.core.windows.net/postiz/dev/org-123';
const videoUrl = blobBase + '/clip.mp4';
const coverUrl = blobBase + '/cover.jpg';
// Append a valid MP4 free-space box to cross the 8 MiB YouTube chunk boundary
// without checking a large asset into Git. Distinct bytes expose offset mistakes.
const firstChunkSize = 8 * 1024 * 1024;
const padding = randomFillSync(Buffer.alloc(firstChunkSize));
padding.writeUInt32BE(padding.length);
padding.write('free', 4);
const video = Buffer.concat([
  readFileSync(new URL('./fixtures/one-frame.mp4', import.meta.url)),
  padding,
]);
const cover = readFileSync(
  new URL('../apps/frontend/public/no-picture.jpg', import.meta.url)
);
const integration = { profile: 'testuser' } as Integration;
const token = 'local-test-token';
const youtubePost = {
  id: 'scheduled-1',
  settings: { title: 'Local clip', type: 'private' },
  message: 'Private clip',
  media: [{ path: videoUrl, type: 'video' as const, thumbnail: coverUrl }],
};

// Route all three HTTP transports to the same temporary TLS server. The
// provider and its SDKs still serialize the headers, ranges and multipart bodies.
let respond: (request: Request) => Promise<Response> | Response;
let server: ReturnType<typeof createServer>;
let origin: string;
let dispatcher: Agent;
let httpsAgent: HttpsAgent;
let interceptor: number;
let serverError: unknown;
const received: Array<{ url: string; method: string }> = [];
const realFetch = globalThis.fetch;

function routeToFixture(input: string | URL) {
  const url = new URL(input);
  if (url.protocol !== 'https:')
    throw new Error('Expected HTTPS: ' + url.origin);
  return origin + '/' + url.host + url.pathname + url.search;
}

beforeAll(async () => {
  const { key, cert } = createLoopbackCertificate();
  server = createServer({ cert, key }, async (req, res) => {
    try {
      const bytes: Buffer[] = [];
      for await (const chunk of req) bytes.push(Buffer.from(chunk));
      const request = new Request('https:/' + req.url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: bytes.length ? Buffer.concat(bytes) : undefined,
      });
      received.push({ url: request.url, method: request.method });
      const result = await respond(request);
      result.headers.forEach((value, key) => res.setHeader(key, value));
      res.writeHead(result.status);
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      serverError ??= error;
      res.writeHead(400).end('Unexpected fixture request');
    }
  });
  await new Promise<void>((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  origin = 'https://127.0.0.1:' + (server.address() as AddressInfo).port;
  dispatcher = new Agent({ connect: { ca: cert } });
  httpsAgent = new HttpsAgent({ ca: cert });
});

beforeEach(() => {
  received.length = 0;
  serverError = undefined;
  vi.stubEnv('UPLOAD_DIRECTORY', undefined);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    realFetch(routeToFixture(url), { ...init, dispatcher } as RequestInit)
  );
  interceptor = getSsrfSafeAxios().interceptors.request.use((config) => {
    config.url = routeToFixture(config.url!);
    config.httpsAgent = httpsAgent;
    config.proxy = false;
    return config;
  });
  google.options({
    adapter: (options, send) =>
      send({
        ...options,
        url: routeToFixture(options.url!),
        agent: httpsAgent,
      }),
  });
});

afterEach(() => {
  google.options({});
  getSsrfSafeAxios().interceptors.request.eject(interceptor);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (serverError) throw serverError;
});

afterAll(async () => {
  await dispatcher?.close();
  httpsAgent?.destroy();
  server?.closeAllConnections();
  if (server?.listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const unexpected = (request: Request): never => {
  throw new Error('Unexpected ' + request.method + ' ' + request.url);
};

it('rejects a Blob error response with Content-Length before opening a YouTube session', async () => {
  respond = (request) => {
    if (request.url === videoUrl && request.method === 'HEAD') {
      return new Response(null, {
        status: 404,
        headers: { 'content-length': '39' },
      });
    }
    return Response.json(
      {},
      { headers: { location: 'https://upload.example/session' } }
    );
  };
  await expect(
    new YoutubeProvider().postPending(
      'account',
      token,
      [youtubePost],
      integration
    )
  ).rejects.toThrow(/size/i);
  expect(received).toEqual([{ url: videoUrl, method: 'HEAD' }]);
});

const youtubeSession = 'https://upload.example/youtube/session-1';
const youtubeCreate = 'https://www.googleapis.com/upload/youtube/v3/videos';
function youtubeStart(request: Request, size: number) {
  if (request.url === videoUrl && request.method === 'HEAD') {
    expect(request.headers.get('accept-encoding')).toBe('identity');
    return new Response(null, { headers: { 'content-length': String(size) } });
  }
  if (
    request.url.startsWith(youtubeCreate + '?') &&
    request.method === 'POST'
  ) {
    expect(request.headers.get('x-upload-content-length')).toBe(String(size));
    return new Response(null, { headers: { location: youtubeSession } });
  }
}

it.each([200, 206])(
  'stops before a YouTube chunk PUT if a %i source response contains the wrong range',
  async (status) => {
    const offset = 128;
    respond = (request) => {
      const start = youtubeStart(request, video.length);
      if (start) return start;
      if (
        request.url === youtubeSession &&
        request.headers.get('content-range') === 'bytes */' + video.length
      ) {
        return new Response(null, {
          status: 308,
          headers: { range: 'bytes=0-127' },
        });
      }
      if (request.url === videoUrl && request.method === 'GET') {
        expect(request.headers.get('range')).toBe(
          'bytes=128-' + (offset + firstChunkSize - 1)
        );
        // Same count of bytes as requested, but starting at the wrong offset.
        return new Response(video.subarray(0, firstChunkSize), {
          status,
          headers: {
            'content-range':
              'bytes 0-' + (firstChunkSize - 1) + '/' + video.length,
          },
        });
      }
      return Response.json({ error: 'Unexpected upload' }, { status: 400 });
    };
    const provider = new YoutubeProvider();
    const [post] = await provider.postPending(
      'account',
      token,
      [youtubePost],
      integration
    );
    await expect(
      provider.finalizePost(token, post.pendingData, integration)
    ).rejects.toThrow(/requested byte range/i);
    expect(received.filter((r) => r.url === youtubeSession)).toHaveLength(1);
  }
);

it('resumes YouTube at the byte acknowledged by the original session and sends the cover for its video ID', async () => {
  const acceptedBeforeFailure = 3 * 1024 * 1024;
  const committed: Buffer[] = [];
  const sourceRanges: string[] = [];
  let committedBytes = 0;
  let coverReceived = false;
  respond = async (request) => {
    const start = youtubeStart(request, video.length);
    if (start) return start;
    if (request.url === videoUrl) {
      const range = request.headers.get('range')!;
      sourceRanges.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const [from, to] = match.slice(1).map(Number);
      expect(request.headers.get('accept-encoding')).toContain('identity');
      return new Response(video.subarray(from, to + 1), {
        status: 206,
        headers: {
          'content-range': 'bytes ' + from + '-' + to + '/' + video.length,
          'content-length': String(to + 1 - from),
        },
      });
    }
    if (request.url === youtubeSession && request.method === 'PUT') {
      const range = request.headers.get('content-range');
      if (range === 'bytes */' + video.length) {
        return new Response(null, {
          status: 308,
          headers: committedBytes
            ? { range: 'bytes=0-' + (committedBytes - 1) }
            : {},
        });
      }
      const bytes = Buffer.from(await request.arrayBuffer());
      const end = committedBytes === 0 ? firstChunkSize - 1 : video.length - 1;
      expect(range).toBe(
        'bytes ' + committedBytes + '-' + end + '/' + video.length
      );
      expect(request.headers.get('content-length')).toBe(
        String(end - committedBytes + 1)
      );
      expect(bytes.equals(video.subarray(committedBytes, end + 1))).toBe(true);
      if (!committedBytes) {
        committed.push(bytes.subarray(0, acceptedBeforeFailure));
        committedBytes = acceptedBeforeFailure;
        return new Response(null, { status: 503 });
      }
      committed.push(bytes);
      committedBytes += bytes.length;
      return Response.json({ id: 'published-video' }, { status: 201 });
    }
    if (request.url === coverUrl && request.method === 'GET')
      return new Response(cover);
    const url = new URL(request.url);
    if (
      url.hostname === 'youtube.googleapis.com' &&
      url.pathname === '/upload/youtube/v3/thumbnails/set'
    ) {
      expect(request.method).toBe('POST');
      expect(url.searchParams.get('videoId')).toBe('published-video');
      expect(Buffer.from(await request.arrayBuffer()).equals(cover)).toBe(true);
      coverReceived = true;
      return Response.json({});
    }
    return unexpected(request);
  };
  const provider = new YoutubeProvider();
  const [post] = await provider.postPending(
    'account',
    token,
    [youtubePost],
    integration
  );
  await expect(
    provider.finalizePost(token, post.pendingData, integration)
  ).rejects.toThrow(/503/);
  const ready = await provider.checkPostStatus(
    token,
    post.pendingData,
    integration
  );
  if (ready.status !== 'ready') throw new Error('Expected resumable session');
  const result = await provider.finalizePost(
    token,
    ready.pendingData,
    integration
  );
  expect(result).toEqual({
    status: 'completed',
    postId: 'published-video',
    releaseURL: 'https://www.youtube.com/watch?v=published-video',
  });
  expect(Buffer.concat(committed).equals(video)).toBe(true);
  expect(sourceRanges).toEqual([
    'bytes=0-' + (firstChunkSize - 1),
    'bytes=' + acceptedBeforeFailure + '-' + (video.length - 1),
  ]);
  expect(
    received.filter((r) => r.url.startsWith(youtubeCreate + '?'))
  ).toHaveLength(1);
  expect(coverReceived).toBe(true);
});

it('retains the live YouTube video ID and URL if the platform rejects its cover', async () => {
  respond = (request) => {
    const start = youtubeStart(request, video.length);
    if (start) return start;
    if (
      request.url === youtubeSession &&
      request.headers.get('content-range') === 'bytes */' + video.length
    ) {
      return Response.json({ id: 'already-live' });
    }
    if (request.url === coverUrl) return new Response(cover);
    if (new URL(request.url).pathname === '/upload/youtube/v3/thumbnails/set') {
      return Response.json(
        { error: { message: 'imageFormatUnsupported' } },
        { status: 400 }
      );
    }
    return unexpected(request);
  };
  const provider = new YoutubeProvider();
  const [post] = await provider.postPending(
    'account',
    token,
    [youtubePost],
    integration
  );
  const checked = await provider.checkPostStatus(
    token,
    post.pendingData,
    integration
  );
  if (checked.status !== 'ready')
    throw new Error('Expected live video with pending cover');
  await expect(
    provider.finalizePost(token, checked.pendingData, integration)
  ).rejects.toMatchObject({
    type: 'published_with_error',
    releaseId: 'already-live',
    releaseURL: 'https://www.youtube.com/watch?v=already-live',
    message: expect.stringContaining('thumbnail format'),
  });
});

const redditSubmit = 'https://oauth.reddit.com/api/submit';
const redditTitle = 'Fixture in r/media';
const redditPermalink = '/r/media/comments/post42/fixture';
const redditLink = coverUrl;
function redditPost(
  type: 'link' | 'media',
  media: MediaContent[] = youtubePost.media
): PostDetails<RedditSettingsDto> {
  return {
    id: 'schedule-reddit',
    message: 'Body text',
    settings: {
      subreddit: [
        {
          value: {
            type,
            subreddit: '/r/media',
            title: redditTitle,
            url: redditLink,
            is_flair_required: false,
            flair: undefined,
          },
        },
      ],
    },
    media: type === 'link' ? [] : media,
  };
}

async function sendReddit(post: ReturnType<typeof redditPost>) {
  const provider = new RedditProvider();
  const [pending] = await provider.postPending('account', token, [post]);
  const check = await provider.checkPostStatus(
    token,
    pending.pendingData,
    integration
  );
  if (check.status !== 'ready')
    throw new Error('Expected Reddit submission to be ready');
  const submission = await provider.finalizePost(
    token,
    check.pendingData,
    integration
  );
  return submission.status === 'pending'
    ? provider.checkPostStatus(token, submission.pendingData, integration)
    : submission;
}

it('sends a Reddit link post with its Blob URL and body text', async () => {
  respond = async (request) => {
    if (request.url !== redditSubmit) return unexpected(request);
    const form = await request.formData();
    expect(form.get('kind')).toBe('link');
    expect(form.get('url')).toBe(redditLink);
    expect(form.get('text')).toBe('Body text');
    expect(form.get('sr')).toBe('media');
    return Response.json({
      json: {
        data: { id: 'link-42', url: 'https://reddit.com/r/media/link-42' },
      },
    });
  };
  expect(await sendReddit(redditPost('link'))).toEqual({
    status: 'completed',
    postId: 'link-42',
    releaseURL: 'https://reddit.com/r/media/link-42',
  });
});

it.each(['image', 'video'] as const)(
  'uploads Reddit %s media and submits only the returned asset locations',
  async (kind) => {
    const imageWithQuery = coverUrl + '?source=clip.mp4';
    const expectedFiles =
      kind === 'video'
        ? [
            {
              url: videoUrl,
              name: 'clip.mp4',
              mime: 'video/mp4',
              bytes: video,
            },
            {
              url: coverUrl,
              name: 'cover.jpg',
              mime: 'image/jpeg',
              bytes: cover,
            },
          ]
        : [
            {
              url: imageWithQuery,
              name: 'cover.jpg',
              mime: 'image/jpeg',
              bytes: cover,
            },
          ];
    const uploaded: string[] = [];
    const submitted: string[] = [];
    respond = async (request) => {
      const file = expectedFiles.find((asset) => asset.url === request.url);
      if (file) {
        return new Response(request.method === 'HEAD' ? null : file.bytes, {
          headers: {
            'content-length': String(file.bytes.length),
            'content-type': file.mime,
          },
        });
      }
      if (request.url === 'https://oauth.reddit.com/api/media/asset') {
        const form = await request.formData();
        const asset = expectedFiles.find(
          (f) => form.get('filepath') === f.name
        )!;
        expect(form.get('mimetype')).toBe(asset.mime);
        return Response.json({
          args: {
            action: '//upload.example/reddit-assets',
            fields: [{ name: 'key', value: asset.name }],
          },
        });
      }
      if (request.url === 'https://upload.example/reddit-assets') {
        const form = await request.formData();
        const uploadedFile = form.get('file') as File;
        const asset = expectedFiles.find((f) => f.name === form.get('key'))!;
        expect(uploadedFile.name).toBe(asset.name);
        expect(uploadedFile.type).toBe(asset.mime);
        expect(
          Buffer.from(await uploadedFile.arrayBuffer()).equals(asset.bytes)
        ).toBe(true);
        uploaded.push(asset.name);
        return new Response(
          '<PostResponse><Location>https://reddit-assets.example/' +
            asset.name +
            '</Location></PostResponse>',
          { status: 201 }
        );
      }
      if (request.url === redditSubmit) {
        const form = await request.formData();
        expect(form.get('kind')).toBe(kind);
        expect(form.get('url')).toBe(
          'https://reddit-assets.example/' + expectedFiles[0].name
        );
        expect(form.get('video_poster_url')).toBe(
          kind === 'video' ? 'https://reddit-assets.example/cover.jpg' : null
        );
        submitted.push(String(form.get('title')));
        return Response.json({
          json: { data: { websocket_url: 'wss://reddit.example/accepted' } },
        });
      }
      if (
        request.url.startsWith(
          'https://oauth.reddit.com/user/testuser/submitted?'
        )
      ) {
        return Response.json({
          data: {
            children: [
              {
                data: {
                  subreddit: 'media',
                  title: redditTitle,
                  created_utc: Date.now() / 1000,
                  id: 'post42',
                  permalink: redditPermalink,
                },
              },
            ],
          },
        });
      }
      return unexpected(request);
    };
    const post =
      kind === 'video'
        ? redditPost('media')
        : redditPost('media', [
            { path: imageWithQuery + '#preview', type: 'image' },
          ]);
    await expect(
      new RedditProvider().checkValidity([post.media!], post.settings)
    ).resolves.toBe(true);
    expect(await sendReddit(post)).toEqual({
      status: 'completed',
      postId: 'post42',
      releaseURL: 'https://www.reddit.com' + redditPermalink,
    });
    expect(uploaded).toEqual(expectedFiles.map((f) => f.name));
    expect(submitted).toEqual([redditTitle]);
  }
);

it('exposes the Reddit submission refusal to the scheduler', async () => {
  respond = (request) =>
    request.url === redditSubmit
      ? Response.json({
          json: {
            errors: [['DOMAIN_BANNED', 'This domain is not allowed', 'url']],
          },
        })
      : unexpected(request);
  await expect(sendReddit(redditPost('link'))).rejects.toThrow(
    /Reddit rejected.*This domain is not allowed/
  );
  expect(received).toEqual([{ method: 'POST', url: redditSubmit }]);
});

const pinterestApi = 'https://api.pinterest.com/v5';
const pin = {
  id: 'scheduled-pin',
  settings: {
    board: '14',
    title: 'Local photos',
    link: 'https://example.org',
    dominant_color: '',
  },
  message: 'Caption',
};
const pinResult = {
  postId: 'pin-123',
  releaseURL: 'https://www.pinterest.com/pin/pin-123',
};
const pinImages = [coverUrl, blobBase + '/second.jpg'];

it.each([1, 2])(
  'sends %i ordered Pinterest image URL(s) to the Pins API',
  async (count) => {
    const images = pinImages.slice(0, count);
    respond = async (request) => {
      if (request.url === pinterestApi + '/user_account')
        return Response.json({});
      if (request.url === pinterestApi + '/pins' && request.method === 'POST') {
        const actual = await request.json();
        expect(actual).toEqual({
          title: pin.settings.title,
          link: pin.settings.link,
          board_id: '14',
          description: 'Caption',
          media_source:
            count === 1
              ? { source_type: 'image_url', url: coverUrl }
              : {
                  source_type: 'multiple_image_urls',
                  items: [{ url: coverUrl }, { url: pinImages[1] }],
                },
        });
        return Response.json({ id: 'pin-123' }, { status: 201 });
      }
      return unexpected(request);
    };
    const post = {
      ...pin,
      media: images.map((path) => ({ type: 'image' as const, path })),
    };
    expect(
      await new PinterestProvider().post('account', token, [post], integration)
    ).toEqual([{ ...pinResult, id: pin.id, status: 'success' }]);
  }
);

it.each(['succeeded', 'failed'])(
  'polls the uploaded Pinterest video ID until processing %s',
  async (processingResult) => {
    const uploadUrl = 'https://upload.example/pinterest-asset';
    let polls = 0;
    let uploads = 0;
    let creates = 0;
    respond = async (request) => {
      if (
        request.url === pinterestApi + '/media' &&
        request.method === 'POST'
      ) {
        expect(await request.json()).toEqual({ media_type: 'video' });
        return Response.json({
          upload_url: uploadUrl,
          media_id: 'media-127',
          upload_parameters: { key: 'signed-key' },
        });
      }
      if (request.url === videoUrl && request.method === 'GET') {
        return new Response(video, {
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(video.length),
          },
        });
      }
      if (request.url === uploadUrl && request.method === 'POST') {
        const form = await request.formData();
        expect(form.get('key')).toBe('signed-key');
        const file = form.get('file') as File;
        expect(Buffer.from(await file.arrayBuffer()).equals(video)).toBe(true);
        uploads++;
        return new Response(null, { status: 204 });
      }
      if (
        request.url === pinterestApi + '/media/media-127' &&
        request.method === 'GET'
      ) {
        return Response.json({
          status: polls++ === 0 ? 'processing' : processingResult,
        });
      }
      if (request.url === pinterestApi + '/user_account')
        return Response.json({});
      if (request.url === pinterestApi + '/pins' && request.method === 'POST') {
        creates++;
        const actual = await request.json();
        expect(actual.media_source).toEqual({
          source_type: 'video_id',
          media_id: 'media-127',
          cover_image_url: coverUrl,
        });
        return Response.json({ id: 'pin-123' }, { status: 201 });
      }
      return unexpected(request);
    };
    const provider = new PinterestProvider();
    const post = {
      ...pin,
      media: [
        { path: videoUrl, type: 'video' as const },
        { path: coverUrl, type: 'image' as const },
      ],
    };
    const [start] = await provider.postPending('account', token, [post]);
    const processing = await provider.checkPostStatus(
      token,
      start.pendingData,
      integration
    );
    if (processing.status !== 'pending')
      throw new Error('Expected Pinterest processing');
    const pollAgain = provider.checkPostStatus(
      token,
      processing.pendingData,
      integration
    );
    if (processingResult === 'failed') {
      await expect(pollAgain).rejects.toThrow(/corrupted/);
      expect(creates).toBe(0);
    } else {
      const ready = await pollAgain;
      if (ready.status !== 'ready') throw new Error('Expected processed media');
      const intent = await provider.finalizePost(
        token,
        ready.pendingData,
        integration
      );
      if (intent.status !== 'pending')
        throw new Error('Expected create intent');
      const confirmed = await provider.checkPostStatus(
        token,
        intent.pendingData,
        integration
      );
      if (confirmed.status !== 'ready')
        throw new Error('Expected create confirmation');
      expect(
        await provider.finalizePost(token, confirmed.pendingData, integration)
      ).toEqual({ ...pinResult, status: 'completed' });
      expect(creates).toBe(1);
    }
    expect(uploads).toBe(1);
  }
);

it('reports Pinterest rejecting the image URL and sends no file upload', async () => {
  respond = (request) => {
    if (request.url === pinterestApi + '/user_account')
      return Response.json({});
    if (request.url === pinterestApi + '/pins') {
      return Response.json(
        { message: 'We blocked this link because it may lead to spam' },
        { status: 400 }
      );
    }
    return unexpected(request);
  };
  const post = { ...pin, media: [{ type: 'image' as const, path: coverUrl }] };
  await expect(
    new PinterestProvider().post('account', token, [post], integration)
  ).rejects.toThrow(/Pinterest blocked the link/);
  expect(received.filter((request) => request.method === 'POST')).toEqual([
    { url: pinterestApi + '/pins', method: 'POST' },
  ]);
});

it('requires an image cover when a Pinterest post contains two videos', async () => {
  expect(
    await new PinterestProvider().checkValidity([
      [{ path: videoUrl }, { path: blobBase + '/second.mp4' }],
    ])
  ).toMatch(/cover image/);
});

it('validates YouTube and Reddit videos by filename across public URL forms', async () => {
  const video = { path: blobBase + '/clip.MP4#preview' };
  const image = { path: blobBase + '/cover.jpg?original=clip.mp4' };
  const youtube = new YoutubeProvider();
  await expect(youtube.checkValidity([[video]])).resolves.toBe(true);
  await expect(youtube.checkValidity([[image]])).resolves.toMatch(
    /must be a video/
  );
  await expect(
    new RedditProvider().checkValidity([[video]], {})
  ).resolves.toMatch(/thumbnail/);
});

it('recognizes Pinterest media by filename when the host, directory or query mentions MP4', async () => {
  const provider = new PinterestProvider();
  const dimensions = vi
    .spyOn(provider as any, 'getImageDimensions')
    .mockResolvedValue({ width: 500, height: 500 });
  const path =
    'https://mp4archive.example/album.mp4/photo.jpg?original=cover.mp4';
  await expect(provider.checkValidity([[{ path }, { path }]])).resolves.toBe(
    true
  );
  expect(dimensions).toHaveBeenCalledTimes(2);
  for (const path of ['video.MP4', 'video.mp4#preview', 'video.MP4?type=jpg']) {
    const media = Object.assign(new MediaDto(), {
      id: 'video',
      path: blobBase + '/' + path,
    });
    expect(validateSync(media)).toEqual([]);
    await expect(provider.checkValidity([[media]])).resolves.toMatch(
      /cover image/
    );
  }
});
