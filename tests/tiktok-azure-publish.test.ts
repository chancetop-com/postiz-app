import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { buffer } from 'node:stream/consumers';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { BlockBlobClient } from '@azure/storage-blob';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { TiktokBusinessProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.business.provider';

const blobPrefix =
  'https://testaccount.blob.core.windows.net/postiz/dev/org-a/';
const video = blobPrefix + 'clip.mp4';
const cover = blobPrefix + 'cover.jpg';
const photos = [blobPrefix + 'one.jpg', blobPrefix + 'two.webp'];
const integration = {
  internalId: 'account',
  profile: 'tester',
  organizationId: 'org-a',
} as any;

function post(paths: string[], method: 'DIRECT_POST' | 'UPLOAD') {
  return {
    id: 'post-1',
    message: 'Caption',
    settings: { content_posting_method: method },
    media: paths.map((path) => ({
      path,
      type: path === video ? 'video' : 'image',
      thumbnail: cover,
    })),
  } as any;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function platform(response: (url: string, body: any) => Response) {
  const requests: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const { pathname, hostname } = new URL(input);
    if (
      !['open.tiktokapis.com', 'business-api.tiktok.com'].includes(hostname)
    ) {
      throw new Error('Unexpected request to ' + input);
    }
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: pathname, body });
    return response(input, body);
  });
  return requests;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['DIRECT_POST', 'UPLOAD'] as const)(
  'uses only the Azure video URL for an ordinary TikTok %s',
  async (mode) => {
    vi.stubEnv('STORAGE_PROVIDER', 'azure');
    const requests = platform(() => json({ data: { publish_id: 'v_123' } }));
    const [result] = await new TiktokProvider().postPending(
      'account',
      'token',
      [post([video], mode)],
      integration
    );
    expect(result).toMatchObject({
      status: 'pending',
      pendingData: { publishId: 'v_123' },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe(
      '/v2/post/publish/' + (mode === 'UPLOAD' ? 'inbox/' : '') + 'video/init/'
    );
    expect(requests[0].body.source_info).toEqual({
      source: 'PULL_FROM_URL',
      video_url: video,
    });
  }
);

it.each([403, 200])(
  'reports an unverified media prefix without switching transport (HTTP %i)',
  async (status) => {
    vi.stubEnv('STORAGE_PROVIDER', 'azure');
    const requests = platform(() =>
      json(
        {
          error: {
            code: 'url_ownership_unverified',
            message: 'Ownership check failed',
          },
        },
        status
      )
    );
    await expect(
      new TiktokProvider().postPending(
        'account',
        'token',
        [post([video], 'UPLOAD')],
        integration
      )
    ).rejects.toThrow(/url_ownership_unverified.*verify.*media URL prefix/i);
    expect(requests.map((r) => r.body.source_info)).toEqual([
      { source: 'PULL_FROM_URL', video_url: video },
    ]);
  }
);

it.each(['DIRECT_POST', 'UPLOAD'] as const)(
  'preserves album order and the accepted publish ID across status failures for %s',
  async (mode) => {
    vi.stubEnv('STORAGE_PROVIDER', 'azure');
    let polls = 0;
    const requests = platform((url, body) => {
      if (url.endsWith('/content/init/'))
        return json({ data: { publish_id: 'p_789' } });
      expect(url).toMatch(/\/status\/fetch\/$/);
      expect(body).toEqual({ publish_id: 'p_789' });
      polls++;
      if (polls === 1) return json({}, 503);
      if (polls === 2) return json({ data: { status: 'PROCESSING_DOWNLOAD' } });
      return json({
        data: {
          status: mode === 'UPLOAD' ? 'SEND_TO_USER_INBOX' : 'PUBLISH_COMPLETE',
          publicaly_available_post_id: ['123'],
        },
      });
    });
    const provider = new TiktokProvider();
    const [pending] = await provider.postPending(
      'account',
      'token',
      [post(photos, mode)],
      integration
    );
    expect(requests[0].body).toMatchObject({
      post_mode: mode === 'UPLOAD' ? 'MEDIA_UPLOAD' : 'DIRECT_POST',
      media_type: 'PHOTO',
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: photos,
      },
    });
    let state = pending.pendingData;
    for (let i = 0; i < 2; i++) {
      const checked = await provider.checkPostStatus(
        'token',
        state,
        integration
      );
      expect(checked).toEqual({
        status: 'pending',
        pendingData: { publishId: 'p_789' },
      });
      if (checked.status === 'pending') state = checked.pendingData;
    }
    expect(await provider.checkPostStatus('token', state, integration)).toEqual(
      {
        status: 'completed',
        postId: mode === 'UPLOAD' ? 'missing' : '123',
        releaseURL:
          mode === 'UPLOAD'
            ? 'https://www.tiktok.com/messages?lang=en#p_789'
            : 'https://www.tiktok.com/@tester/photo/123',
      }
    );
    expect(requests.filter((r) => r.path.endsWith('/init/'))).toHaveLength(1);
  }
);

it.each(['DIRECT_POST', 'UPLOAD'] as const)(
  'sends the Azure album, video and optional cover URLs to TikTok Business for %s',
  async (mode) => {
    vi.stubEnv('STORAGE_PROVIDER', 'azure');
    const requests = platform(() =>
      json({ code: 0, data: { share_id: 'business-id' } })
    );
    const provider = new TiktokBusinessProvider();
    for (const paths of [photos, [video]]) {
      const [pending] = await provider.postPending(
        'account',
        'token',
        [post(paths, mode)],
        integration
      );
      expect(pending).toMatchObject({
        status: 'pending',
        pendingData: { publishId: 'business-id' },
      });
    }
    expect(requests).toHaveLength(2);
    expect(requests[0].path).toMatch(/\/business\/photo\/publish\/$/);
    expect(requests[0].body.photo_images).toEqual(photos);
    expect(requests[1].path).toMatch(/\/business\/video\/publish\/$/);
    expect(requests[1].body).toMatchObject({
      video_url: video,
      custom_thumbnail_url: cover,
    });
    if (mode === 'UPLOAD') {
      expect(requests[0].body.post_info.is_draft).toBe(true);
      expect(requests[1].body.post_info.upload_to_draft).toBe(true);
    } else {
      expect(requests[0].body.post_info).not.toHaveProperty('is_draft');
      expect(requests[1].body.post_info).not.toHaveProperty('upload_to_draft');
    }
  }
);

const http = getSsrfSafeAxios();
const defaultAdapter = http.defaults.adapter;
afterEach(() => {
  http.defaults.adapter = defaultAdapter;
});

async function scheduledPhoto(
  provider: TiktokProvider | TiktokBusinessProvider,
  path: string,
  bytes: Buffer
) {
  vi.stubEnv('STORAGE_PROVIDER', 'azure');
  vi.stubEnv('AZURE_CONTAINER', 'postiz');
  vi.stubEnv('AZURE_BASEPATH', 'dev');
  vi.stubEnv(
    'AZURE_CONNECTIONURL',
    'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=' +
      Buffer.alloc(32, 1).toString('base64') +
      ';EndpointSuffix=core.windows.net'
  );
  vi.stubEnv('UPLOAD_DIRECTORY', undefined);
  vi.stubEnv('STRIPE_SECRET_KEY', undefined);
  const objects = new Map([[path, bytes]]);
  const library = Object.freeze({
    id: 'media-1',
    path,
    name: 'source',
    status: 'ready',
  });
  const source = {
    id: 'post-1',
    content: 'Caption',
    settings: '{}',
    image: JSON.stringify([library]),
  };
  vi.spyOn(BlockBlobClient.prototype, 'uploadStream').mockImplementation(
    async function (stream) {
      objects.set(this.url, await buffer(stream));
      return {} as any;
    }
  );
  http.defaults.adapter = async (config) => {
    const data = objects.get(config.url!);
    if (!data) throw new Error('Missing test blob');
    return {
      data,
      config,
      headers: { 'content-length': String(data.length) },
      status: 200,
      statusText: 'OK',
    };
  };
  const requests = platform(() =>
    json(
      provider.identifier === 'tiktok'
        ? { data: { publish_id: 'p_123' } }
        : { code: 0, data: { share_id: 'p_123' } }
    )
  );
  const manager = { getSocialIntegration: () => provider } as any;
  const posts = new PostsService(
    {
      updateImages: (_id: string, images: string) => {
        source.image = images;
      },
    } as any,
    manager,
    null,
    { getMediaById: () => library } as any,
    null,
    null,
    null,
    null
  );
  const activity = new PostActivity(
    posts,
    null,
    manager,
    { decryptTokens: (i: any) => i } as any,
    null,
    null,
    null,
    null
  );
  const send = () =>
    activity.postSocialPending(
      { ...integration, providerIdentifier: provider.identifier },
      [source as any]
    );
  return { requests, objects, library, source, send };
}

it.each([new TiktokProvider(), new TiktokBusinessProvider()])(
  'sends a separate organization JPEG for a scheduled $identifier PNG, preserving the library original',
  async (provider) => {
    vi.stubEnv(
      'DISABLE_PUBLISH_IMAGE_PROCESSING',
      provider.identifier === 'tiktok' ? undefined : ''
    );
    const original = await sharp({
      create: { width: 64, height: 32, channels: 3, background: '#287fa2' },
    })
      .png()
      .toBuffer();
    const { objects, requests, send, library, source } = await scheduledPhoto(
      provider,
      blobPrefix + 'original.png',
      original
    );
    await send();
    const images = (requests[0].body.source_info || requests[0].body)
      .photo_images;
    expect(images).toHaveLength(1);
    expect(images[0]).toMatch(
      /^https:\/\/testaccount\.blob\.core\.windows\.net\/postiz\/dev\/org-a\/[\w-]+\.jpg$/
    );
    expect(objects.get(images[0])).toEqual(
      await sharp(original).jpeg({ quality: 100 }).toBuffer()
    );
    expect((await http.get(library.path)).data).toEqual(original);
    expect(JSON.parse(source.image)[0].path).toBe(images[0]);
  }
);

it.each([
  ['true', new TiktokProvider()],
  ['false', new TiktokBusinessProvider()],
  ['0', new TiktokProvider()],
] as const)(
  'uses compatible original bytes and rejects a disguised PNG without a copy when processing is %s',
  async (setting, provider) => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
    const image = sharp({
      create: { width: 32, height: 32, channels: 3, background: 'orange' },
    });
    const webp = await image.webp().toBuffer();
    const path = blobPrefix + 'source.webp';
    const { send, objects, requests } = await scheduledPhoto(
      provider,
      path,
      webp
    );
    await send();
    expect(
      (requests[0].body.source_info || requests[0].body).photo_images
    ).toEqual([path]);
    expect(objects.get(path)).toEqual(webp);
    objects.set(path, await image.png().toBuffer());
    await expect(send()).rejects.toThrow(/PNG.*JPEG or WebP/i);
    expect(objects.size).toBe(1);
    expect(requests).toHaveLength(1);
  }
);

it.each([undefined, '0'])(
  'rejects oversized photos before platform initialization for processing setting %j',
  async (setting) => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
    const jpeg = await sharp({
      create: { width: 1200, height: 1200, channels: 3, background: 'green' },
    })
      .jpeg()
      .toBuffer();
    const { send, requests } = await scheduledPhoto(
      new TiktokProvider(),
      blobPrefix + 'oversize.jpg',
      jpeg
    );
    await expect(send()).rejects.toThrow(/1200x1200.*1080/);
    expect(requests).toHaveLength(0);
  }
);

it.each([new TiktokProvider(), new TiktokBusinessProvider()])(
  'reports incompatible originals when validating a scheduled $identifier album',
  async (provider) => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'false');
    const path = blobPrefix + 'second.png';
    const image = sharp({
      create: { width: 32, height: 16, channels: 3, background: 'teal' },
    });
    const { objects } = await scheduledPhoto(
      provider,
      path,
      await image.png().toBuffer()
    );
    objects.set(photos[0], await image.jpeg().toBuffer());
    const media = [[{ path: photos[0] }, { path }]];
    expect(await provider.checkValidity(media)).toMatch(
      /Image 2.*PNG.*JPEG or WebP/i
    );
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', '');
    expect(await provider.checkValidity(media)).toBe(true);
    expect(objects.size).toBe(2);
  }
);

it('keeps the existing R2 video transfer and uploads the requested bytes', async () => {
  vi.stubEnv('STORAGE_PROVIDER', 'cloudflare');
  const r2Video = 'https://media.example.test/clip.mp4';
  const bytes = Uint8Array.from([0, 1, 2, 3]);
  const upload = 'https://upload.tiktokapis.com/video';
  const received: number[] = [];
  let source: unknown;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url === r2Video && init.method === 'HEAD') {
      return new Response(null, { headers: { 'content-length': '4' } });
    }
    if (
      url === r2Video &&
      new Headers(init.headers).get('range') === 'bytes=0-3'
    ) {
      return new Response(bytes, { status: 206 });
    }
    if (url.endsWith('/video/init/')) {
      source = JSON.parse(String(init.body)).source_info;
      return json({ data: { publish_id: 'v_r2', upload_url: upload } });
    }
    if (url === upload && init.method === 'PUT') {
      received.push(
        ...new Uint8Array(await new Response(init.body).arrayBuffer())
      );
      return new Response(null, { status: 201 });
    }
    throw Error('Unexpected request to ' + url);
  });
  const [accepted] = await new TiktokProvider().postPending(
    'account',
    'token',
    [post([r2Video], 'DIRECT_POST')],
    integration
  );
  expect(accepted.pendingData).toEqual({ publishId: 'v_r2' });
  expect(source).toEqual({
    source: 'FILE_UPLOAD',
    video_size: 4,
    chunk_size: 4,
    total_chunk_count: 1,
  });
  expect(received).toEqual([0, 1, 2, 3]);
});

it.each(['lossy', 'lossless', 'alpha'])(
  'validates large %s WebP from the first Blob range',
  async (format) => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'true');
    const channels = format === 'alpha' ? 4 : 3;
    const image = await sharp(randomBytes(400 * 400 * channels), {
      raw: { width: 400, height: 400, channels },
    })
      .webp({ lossless: format === 'lossless' })
      .toBuffer();
    expect(image.length).toBeGreaterThan(65536);
    const path = blobPrefix + 'photo.webp';
    const { send, requests } = await scheduledPhoto(
      new TiktokProvider(),
      path,
      image
    );
    const ranges: string[] = [];
    http.defaults.adapter = async (config) => {
      const range = config.headers.get('range');
      if (range !== 'bytes=0-65535')
        throw Error('Expected a metadata range only');
      ranges.push(range);
      return {
        config,
        data: image.subarray(0, 65536),
        status: 206,
        statusText: 'Partial Content',
        headers: { 'content-range': 'bytes 0-65535/' + image.length },
      };
    };
    await send();
    expect(ranges).toHaveLength(1);
    expect(requests[0].body.source_info.photo_images).toEqual([path]);
  }
);

it('keeps a Business share ID through a temporary status error and preserves an explicit pull rejection', async () => {
  vi.stubEnv('STORAGE_PROVIDER', 'azure');
  let polls = 0;
  const requests = platform((url) => {
    if (url.endsWith('/business/video/publish/'))
      return json({ code: 0, data: { share_id: 'share-16' } });
    expect(new URL(url).searchParams.get('publish_id')).toBe('share-16');
    polls++;
    return polls === 1
      ? json({}, 503)
      : json({
          code: 0,
          data: { status: 'FAILED', reason: 'url_ownership_unverified' },
        });
  });
  const provider = new TiktokBusinessProvider();
  const [accepted] = await provider.postPending(
    'account',
    'token',
    [post([video], 'UPLOAD')],
    integration
  );
  const check = await provider.checkPostStatus(
    'token',
    accepted.pendingData,
    integration
  );
  expect(check).toEqual({
    status: 'pending',
    pendingData: { publishId: 'share-16' },
  });
  if (check.status !== 'pending') throw new Error('Expected pending status');
  await expect(
    provider.checkPostStatus('token', check.pendingData, integration)
  ).rejects.toThrow(/url_ownership_unverified.*verify.*media URL prefix/i);
  expect(
    requests.filter((r) => r.path.endsWith('/business/video/publish/'))
  ).toHaveLength(1);
});

it.each([new TiktokProvider(), new TiktokBusinessProvider()])(
  'uses the scheduled public URL for an original local $identifier photo',
  async (provider) => {
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'true');
    const publicUrl = 'https://postiz.example/uploads/photo.webp';
    const local = post(['/mnt/uploads/photo.webp'], 'DIRECT_POST');
    local.media[0].url = publicUrl;
    const requests = platform(() =>
      json(
        provider.identifier === 'tiktok'
          ? { data: { publish_id: 'p_local' } }
          : { code: 0, data: { share_id: 'p_local' } }
      )
    );
    await provider.postPending('account', 'token', [local], integration);
    expect(
      (requests[0].body.source_info || requests[0].body).photo_images
    ).toEqual([publicUrl]);
  }
);
