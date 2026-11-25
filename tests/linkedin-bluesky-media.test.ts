import 'reflect-metadata';
import type { Integration } from '@prisma/client';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { BlueskyProvider } from '@gitroom/nestjs-libraries/integrations/social/bluesky.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';
import type {
  PostDetails,
  PendingCheckResponse,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const mediaRoot = 'https://postiztest.blob.core.windows.net/postiz/dev/org-42';
const mp4 = readFileSync(new URL('./fixtures/one-frame.mp4', import.meta.url));
const http = getSsrfSafeAxios();
const originalAdapter = http.defaults.adapter;
const integration = { internalId: 'account' } as Integration;

function serveImages(files: Record<string, Buffer>) {
  http.defaults.adapter = async (config) => {
    const data = files[config.url!];
    if (!data) throw new Error('Unexpected media URL ' + config.url);
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
}

function post(paths: string[], pdf = false): PostDetails[] {
  return [
    {
      id: 'scheduled',
      message: 'Our collection',
      settings: { post_as_images_carousel: pdf, carousel_name: 'Collection' },
      media: paths.map((path) => ({
        type: path.endsWith('.mp4') ? 'video' : 'image',
        path,
      })),
    },
  ];
}

function sampleImage(width = 20, height = 10) {
  return sharp({
    create: { width, height, channels: 3, background: '#223344' },
  });
}

function animatedGif(frames: number) {
  return sharp({
    create: {
      width: 20,
      height: frames * 10,
      pageHeight: 10,
      channels: 3,
      background: 'red',
    },
  })
    .gif({ keepDuplicateFrames: true })
    .toBuffer();
}

async function exactSizePng(size: number) {
  const png = await sampleImage().png().toBuffer();
  const chunk = Buffer.alloc(size - png.length, 65);
  chunk.writeUInt32BE(chunk.length - 12);
  chunk.write('tEXtComment\0', 4);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

async function complete(
  provider: {
    checkPostStatus(
      token: string,
      state: any,
      account: Integration
    ): Promise<PendingCheckResponse>;
    finalizePost(
      token: string,
      state: any,
      account: Integration
    ): Promise<PendingCheckResponse>;
  },
  pending: PostResponse,
  account = integration
) {
  let state = pending.pendingData;
  for (let i = 0; i < 8; i++) {
    let result: PendingCheckResponse = await provider.checkPostStatus(
      'token',
      state,
      account
    );
    if (result.status === 'ready')
      result = await provider.finalizePost(
        'token',
        result.pendingData,
        account
      );
    if (result.status === 'completed') return result;
    state = result.pendingData;
  }
  throw new Error('Post did not complete');
}

function linkedinPlatform() {
  const owners: string[] = [];
  const uploads: Buffer[] = [];
  const posts: any[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === 'https://upload.linkedin.test') {
        uploads.push(Buffer.from(await request.arrayBuffer()));
        return new Response(null, { status: 201 });
      }
      expect(url.origin).toBe('https://api.linkedin.com');
      if (url.searchParams.get('action') === 'initializeUpload') {
        owners.push((await request.json()).initializeUploadRequest.owner);
        const type = url.pathname === '/rest/documents' ? 'document' : 'image';
        const id = owners.length;
        return Response.json({
          value: {
            [type]: 'urn:li:' + type + ':' + id,
            uploadUrl: 'https://upload.linkedin.test/media/' + id,
          },
        });
      }
      if (request.method === 'GET')
        return Response.json({ status: 'AVAILABLE' });
      expect(url.pathname).toBe('/rest/posts');
      posts.push(await request.json());
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:123' },
      });
    }
  );
  return { owners, uploads, posts };
}

afterEach(() => {
  http.defaults.adapter = originalAdapter;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const did = 'did:plc:sampleaccount';
const cid = 'bafkreibabalobzn6cd366ukcsjycp4yymjymgfxcv6xczmlgpemzkz3cfa';
const uri = 'at://' + did + '/app.bsky.feed.post/123';
const bluesky = new BlueskyProvider();
function blueskyAccount() {
  return {
    internalId: did,
    customInstanceDetails: AuthService.fixedEncryption(
      JSON.stringify({
        service: 'https://pds.example.test',
        identifier: 'user.example.test',
        password: 'local-test',
      })
    ),
  } as Integration;
}

function blueskyPlatform(
  extra?: (
    request: Request,
    init?: RequestInit
  ) => Promise<Response | undefined>
) {
  const uploads: Buffer[] = [];
  const types: Array<string | null> = [];
  const posts: any[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const custom = await extra?.(request, init);
      if (custom) return custom;
      const url = new URL(request.url);
      expect(url.hostname).toBe('pds.example.test');
      switch (url.pathname.split('/').pop()) {
        case 'com.atproto.server.createSession':
          return Response.json({
            accessJwt: 'access',
            refreshJwt: 'refresh',
            handle: 'user.example.test',
            did,
          });
        case 'com.atproto.repo.uploadBlob': {
          const bytes = Buffer.from(await request.arrayBuffer());
          uploads.push(bytes);
          types.push(request.headers.get('content-type'));
          return Response.json({
            blob: {
              $type: 'blob',
              ref: { $link: cid },
              mimeType: 'image/png',
              size: bytes.length,
            },
          });
        }
        case 'com.atproto.repo.createRecord':
          posts.push((await request.json()).record);
          return Response.json({ uri, cid });
        default:
          throw Error('Unexpected request ' + request.url);
      }
    }
  );
  return { uploads, posts, types };
}

describe('Bluesky publishing', () => {
  it.each(['wrapped', 'legacy', 'already_exists'])(
    'streams MP4 and polls the same processing job from a %s response',
    async (shape) => {
      const path = mediaRoot + '/clip.mp4';
      const bytes = mp4;
      const source = new Response(bytes);
      const reads: string[] = [];
      const checks: string[] = [];
      const job = { jobId: 'job-42', did, state: 'JOB_STATE_PROCESSING' };
      const platform = blueskyPlatform(async (request, init) => {
        const url = new URL(request.url);
        if (request.url === path) {
          reads.push(request.method);
          return request.method === 'HEAD'
            ? new Response(null, {
                headers: { 'Content-Length': String(bytes.length) },
              })
            : source;
        }
        if (url.pathname.endsWith('.getServiceAuth'))
          return Response.json({ token: 'video-token' });
        if (url.pathname.endsWith('.uploadVideo')) {
          expect(url.hostname).toBe('video.bsky.app');
          expect(url.searchParams.get('did')).toBe(did);
          expect(init?.body).toBe(source.body);
          expect(request.headers.get('content-type')).toBe('video/mp4');
          expect(request.headers.get('content-length')).toBe(
            String(bytes.length)
          );
          expect(Buffer.from(await request.arrayBuffer())).toEqual(bytes);
          if (shape === 'already_exists')
            return Response.json({ ...job, error: shape }, { status: 409 });
          return Response.json(shape === 'wrapped' ? { jobStatus: job } : job);
        }
        if (url.pathname.endsWith('.getJobStatus')) {
          checks.push(url.searchParams.get('jobId')!);
          const status =
            checks.length === 1
              ? job
              : {
                  ...job,
                  state: 'JOB_STATE_COMPLETED',
                  blob: {
                    $type: 'blob',
                    ref: { $link: cid },
                    mimeType: 'video/mp4',
                    size: bytes.length,
                  },
                };
          return Response.json({ jobStatus: status });
        }
      });
      const account = blueskyAccount();
      const [pending] = await bluesky.postPending(
        did,
        'token',
        post([path]),
        account
      );
      expect(pending).toMatchObject({
        status: 'pending',
        pendingData: { jobId: 'job-42' },
      });
      expect(
        (await bluesky.checkPostStatus('token', pending.pendingData, account))
          .status
      ).toBe('pending');
      expect(platform.posts).toHaveLength(0);
      expect(await complete(bluesky, pending, account)).toMatchObject({
        status: 'completed',
        postId: uri,
      });
      expect(new Set(checks)).toEqual(new Set(['job-42']));
      expect(reads).toEqual(['HEAD', 'GET']);
      expect(platform.posts[0].embed).toMatchObject({
        $type: 'app.bsky.embed.video',
        video: { ref: { $link: cid } },
      });
    }
  );
  it('reports the video service rejection before the scheduler gets a job', async () => {
    const path = mediaRoot + '/clip.mp4';
    const platform = blueskyPlatform(async (req) => {
      if (req.url === path)
        return new Response(req.method === 'HEAD' ? null : 'video', {
          headers: { 'Content-Length': '5' },
        });
      if (req.url.includes('.getServiceAuth'))
        return Response.json({ token: 'video-token' });
      if (req.url.includes('.uploadVideo'))
        return Response.json(
          { jobStatus: { error: 'unconfirmed_email' } },
          { status: 403 }
        );
    });
    await expect(
      bluesky.postPending(did, 'token', post([path]), blueskyAccount())
    ).rejects.toThrow(/unconfirmed_email/);
    expect(platform.posts).toHaveLength(0);
  });
  it('sends an original exactly at 976 KiB with its actual media type', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', undefined);
    const path = mediaRoot + '/legacy-name.jpg';
    const png = await exactSizePng(976 * 1024);
    serveImages({ [path]: png });
    const platform = blueskyPlatform();
    const account = blueskyAccount();
    const [pending] = await bluesky.postPending(
      did,
      'token',
      post([path]),
      account
    );
    await complete(bluesky, pending, account);
    expect(platform.uploads[0].equals(png)).toBe(true);
    expect(platform.types).toEqual(['image/png']);
  });

  it('rejects oversized originals in posts and replies with the platform limit', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'true');
    const path = mediaRoot + '/too-large.png';
    serveImages({ [path]: await exactSizePng(2_000_001) });
    const platform = blueskyPlatform();
    const account = blueskyAccount();
    const [pending] = await bluesky.postPending(
      did,
      'token',
      post([path]),
      account
    );
    await expect(complete(bluesky, pending, account)).rejects.toThrow(
      /2,000,000 bytes/
    );
    await expect(
      bluesky.comment(did, uri, undefined, 'token', post([path]), account)
    ).rejects.toThrow(/2,000,000 bytes/);
    expect(platform.uploads).toHaveLength(0);
    expect(platform.posts).toHaveLength(0);
  });
  it.each([
    { setting: '', width: 540, height: 540 },
    { setting: 'false', width: 600, height: 600 },
  ])(
    'handles a valid image over the 976 KiB reduction target with setting $setting',
    async ({ setting, width, height }) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
      const png = await sampleImage(600, 600)
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(png.length).toBeGreaterThan(976 * 1024);
      const path = mediaRoot + '/large.png';
      serveImages({ [path]: png });
      const platform = blueskyPlatform();
      const account = blueskyAccount();
      const [pending] = await bluesky.postPending(
        did,
        'token',
        post([path]),
        account
      );
      expect(await complete(bluesky, pending, account)).toMatchObject({
        postId: uri,
      });
      expect(platform.uploads).toHaveLength(1);
      expect(platform.uploads[0].equals(png)).toBe(Boolean(setting));
      expect(await sharp(platform.uploads[0]).metadata()).toMatchObject({
        format: 'png',
        width,
        height,
      });
      expect(platform.posts[0].embed.images[0]).toMatchObject({
        aspectRatio: { width, height },
        image: { ref: { $link: cid } },
      });
    }
  );
});

describe.each([
  {
    channel: 'linkedin',
    provider: new LinkedinProvider(),
    owner: 'urn:li:person:account',
  },
  {
    channel: 'linkedin-page',
    provider: new LinkedinPageProvider(),
    owner: 'urn:li:organization:account',
  },
])('$channel publishing', ({ provider, owner }) => {
  it('uploads compliant originals byte for byte when automatic processing is disabled', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'false');
    const path = mediaRoot + '/art.png';
    const png = await sampleImage().withMetadata().png().toBuffer();
    serveImages({ [path]: png });
    const platform = linkedinPlatform();
    const [result] = await provider.postPending(
      'account',
      'token',
      post([path]),
      integration
    );
    expect(result.status).toBe('pending');
    expect(platform.owners).toEqual([owner]);
    expect(platform.uploads).toEqual([png]);
    expect(await complete(provider, result)).toMatchObject({
      postId: 'urn:li:share:123',
    });
    expect(platform.posts).toMatchObject([
      { author: owner, content: { media: { id: 'urn:li:image:1' } } },
    ]);
  });

  it('keeps GIF bytes, re-encodes PNG and JPEG, and converts oversized WebP to JPEG', async () => {
    vi.stubEnv(
      'DISABLE_PUBLISH_IMAGE_PROCESSING',
      provider.identifier === 'linkedin' ? undefined : ''
    );
    const gif = await animatedGif(2);
    const png = await sampleImage().withMetadata().png().toBuffer();
    const jpeg = await sampleImage().withMetadata().jpeg().toBuffer();
    const webp = await sampleImage(8000, 40).webp().toBuffer();
    const files = {
      [mediaRoot + '/animation.gif']: gif,
      [mediaRoot + '/small.png']: png,
      [mediaRoot + '/photo.jpg']: jpeg,
      [mediaRoot + '/wide.webp']: webp,
    };
    serveImages(files);
    const platform = linkedinPlatform();
    const [result] = await provider.postPending(
      'account',
      'token',
      post(Object.keys(files)),
      integration
    );
    const [animation, art, photo, wide] = platform.uploads;
    expect(animation).toEqual(gif);
    expect(await sharp(animation).metadata()).toMatchObject({ pages: 2 });
    expect(art.equals(png)).toBe(false);
    expect(photo.equals(jpeg)).toBe(false);
    expect(await sharp(art).metadata()).toMatchObject({
      format: 'png',
      width: 20,
      height: 10,
    });
    expect(await sharp(photo).metadata()).toMatchObject({
      format: 'jpeg',
      width: 20,
      height: 10,
    });
    expect(await sharp(wide).metadata()).toMatchObject({
      format: 'jpeg',
      width: 6000,
      height: 30,
    });
    await complete(provider, result);
    expect(platform.posts[0]).toMatchObject({
      author: owner,
      content: {
        multiImage: {
          images: [1, 2, 3, 4].map((i) => ({ id: 'urn:li:image:' + i })),
        },
      },
    });
  });

  it('rejects an incompatible original by its actual format before allocating a LinkedIn upload', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', '0');
    const path = mediaRoot + '/imported.jpg';
    serveImages({ [path]: await sampleImage().webp().toBuffer() });
    const platform = linkedinPlatform();
    await expect(
      provider.postPending('account', 'token', post([path]), integration)
    ).rejects.toThrow(/webp.*JPEG.*PNG.*GIF/i);
    expect(platform.owners).toHaveLength(0);
  });

  it('rejects a GIF with more than 250 frames', async () => {
    vi.stubEnv(
      'DISABLE_PUBLISH_IMAGE_PROCESSING',
      provider.identifier === 'linkedin' ? undefined : 'true'
    );
    const path = mediaRoot + '/animation.gif';
    serveImages({ [path]: await animatedGif(251) });
    const platform = linkedinPlatform();
    await expect(
      provider.postPending('account', 'token', post([path]), integration)
    ).rejects.toThrow(/250 frames/);
    expect(platform.owners).toHaveLength(0);
  });

  it('rejects an oversized original by pixel count when automatic processing is disabled', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', '0');
    const path = mediaRoot + '/original.jpg';
    serveImages({
      [path]: await sampleImage(6020, 6020).greyscale().jpeg().toBuffer(),
    });
    const platform = linkedinPlatform();
    await expect(
      provider.postPending('account', 'token', post([path]), integration)
    ).rejects.toThrow(/36,152,320 pixels/);
    expect(platform.owners).toHaveLength(0);
  });

  it.each(['', 'true'])(
    'uploads the explicitly selected two-page PDF with setting %j',
    async (setting) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
      const files = {
        [mediaRoot + '/first.webp']: await sampleImage().webp().toBuffer(),
        [mediaRoot + '/second.png']: await sampleImage().png().toBuffer(),
      };
      serveImages(files);
      const platform = linkedinPlatform();
      const [result] = await provider.postPending(
        'account',
        'token',
        post(Object.keys(files), true),
        integration
      );
      expect(platform.uploads).toHaveLength(1);
      const document = platform.uploads[0].toString('latin1');
      expect(document).toMatch(/^%PDF-/);
      expect(document).toMatch(/\/Count 2\b/);
      await complete(provider, result);
      expect(platform.posts).toMatchObject([
        {
          author: owner,
          content: { media: { id: 'urn:li:document:1', title: 'Collection' } },
        },
      ]);
    }
  );

  it('sends the assigned video byte ranges to their respective upload URLs', async () => {
    const path = mediaRoot + '/movie.mp4';
    const video = mp4;
    const firstPartSize = 512;
    const puts: Array<[string, Buffer]> = [];
    const ranges: string[] = [];
    let finalize: unknown;
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        if (req.url === path) {
          if (req.method === 'HEAD')
            return new Response(null, {
              headers: { 'Content-Length': String(video.length) },
            });
          const range = req.headers.get('range')!;
          ranges.push(range);
          const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
          return new Response(video.subarray(Number(start), Number(end) + 1), {
            status: 206,
          });
        }
        if (url.searchParams.get('action') === 'initializeUpload') {
          expect((await req.json()).initializeUploadRequest).toMatchObject({
            owner,
            fileSizeBytes: video.length,
          });
          return Response.json({
            value: {
              video: 'urn:li:video:7',
              uploadToken: 'session',
              uploadInstructions: [
                {
                  firstByte: 0,
                  lastByte: firstPartSize - 1,
                  uploadUrl: 'https://upload.linkedin.test/p1',
                },
                {
                  firstByte: firstPartSize,
                  lastByte: video.length - 1,
                  uploadUrl: 'https://upload.linkedin.test/p2',
                },
              ],
            },
          });
        }
        if (url.hostname === 'upload.linkedin.test') {
          puts.push([url.pathname, Buffer.from(await req.arrayBuffer())]);
          return new Response(null, {
            status: 201,
            headers: { etag: '"' + url.pathname.slice(1) + '"' },
          });
        }
        expect(url.searchParams.get('action')).toBe('finalizeUpload');
        finalize = (await req.json()).finalizeUploadRequest;
        return Response.json({});
      }
    );
    const [result] = await provider.postPending(
      'account',
      'token',
      post([path]),
      integration
    );
    expect(result).toMatchObject({
      status: 'pending',
      pendingData: { mediaIds: ['urn:li:video:7'] },
    });
    expect(ranges).toEqual(['bytes=0-511', 'bytes=512-' + (video.length - 1)]);
    expect(puts).toEqual([
      ['/p1', video.subarray(0, firstPartSize)],
      ['/p2', video.subarray(firstPartSize)],
    ]);
    expect(finalize).toEqual({
      video: 'urn:li:video:7',
      uploadToken: 'session',
      uploadedPartIds: ['p1', 'p2'],
    });
  });
});
