import 'reflect-metadata';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterApiv2 } from 'twitter-api-v2';
import sharp from 'sharp';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';

const blobBase =
  'https://fixtureaccount.blob.core.windows.net/postiz/dev/org-1/';
const photo = blobBase + 'picture.jpg';
const objects = new Map<string, Buffer>();
const uploads: Array<{
  media_type: string;
  media_category: string;
  total_bytes: number;
  segments: Buffer[];
}> = [];
const http = getSsrfSafeAxios();
const originalAdapter = http.defaults.adapter;
const provider = new XProvider();
const integration = { profile: 'test-account' } as any;

function post(path: string, settings = {}, message = 'Caption') {
  return {
    id: 'post-1',
    message,
    settings: {
      active_thread_finisher: false,
      thread_finisher: '',
      who_can_reply_post: 'everyone' as const,
      ...settings,
    },
    media: [{ type: 'image' as const, path }],
  };
}

const fixture = (format: 'png' | 'gif' | 'webp') =>
  sharp({
    create: { width: 32, height: 16, channels: 3, background: '#27693a' },
  })
    .toFormat(format)
    .toBuffer();

beforeEach(() => {
  vi.stubEnv('X_API_KEY', 'test-key');
  vi.stubEnv('X_API_SECRET', 'test-secret');
  http.defaults.adapter = async (config) => {
    const data = objects.get(config.url!);
    if (!data || config.method !== 'get')
      throw Error('Unexpected media request');
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  vi.spyOn(TwitterApiv2.prototype, 'post').mockImplementation(
    async (path, body: any): Promise<any> => {
      if (path === 'media/upload/initialize') {
        uploads.push({ ...body, segments: [] });
        return { data: { id: String(uploads.length) } };
      }
      const match = /^media\/upload\/(\d+)\/(append|finalize)$/.exec(path);
      if (!match) throw Error('Unexpected X upload request');
      if (match[2] === 'append') {
        uploads[Number(match[1]) - 1].segments[body.segment_index] = body.media;
      }
      return { data: { id: match[1] } };
    }
  );
});

afterEach(() => {
  objects.clear();
  uploads.length = 0;
  http.defaults.adapter = originalAdapter;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('X scheduled media', () => {
  it.each([undefined, ''])(
    'sends a proportional 1000px GIF for processing setting %j',
    async (setting) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
      vi.stubEnv('DISABLE_IMAGE_COMPRESSION', 'true');
      objects.set(photo, await fixture('png'));
      await provider.postPending(
        'x',
        'token:secret',
        [post(photo)],
        integration
      );
      expect(uploads[0]).toMatchObject({
        media_type: 'image/gif',
        media_category: 'tweet_image',
      });
      expect(
        await sharp(Buffer.concat(uploads[0].segments)).metadata()
      ).toMatchObject({
        width: 1000,
        height: 500,
        format: 'gif',
      });
    }
  );

  it.each(['true', 'false', '0'])(
    'sends original PNG bytes and actual MIME for setting %j',
    async (setting) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
      const isR2 = setting === '0';
      vi.stubEnv('STORAGE_PROVIDER', isR2 ? 'cloudflare' : 'azure');
      const path = isR2 ? 'https://media.example.test/picture.jpg' : photo;
      const png = await fixture('png');
      objects.set(path, png);
      const [result] = await provider.postPending(
        'x',
        'token:secret',
        [post(path)],
        integration
      );
      expect(result).toMatchObject({
        status: 'pending',
        pendingData: { mediaIds: ['1'] },
      });
      expect(uploads[0]).toMatchObject({
        media_type: 'image/png',
        media_category: 'tweet_image',
      });
      expect(Buffer.concat(uploads[0].segments)).toEqual(png);
    }
  );

  it('reports why a GIF cannot be used as an original article cover', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'false');
    const cover = blobBase + 'cover.gif';
    objects.set(cover, await fixture('gif'));
    const article = post(photo, {
      post_type: 'article',
      article_cover: { path: cover },
    });
    article.media = [];
    await expect(
      provider.postPending('x', 'token:secret', [article], integration)
    ).rejects.toThrow(/X articles.*GIF/i);
    expect(uploads).toHaveLength(0);
  });

  it('explains the size limit before uploading an oversized original', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', '0');
    const png = await sharp({
      create: { width: 1500, height: 1500, channels: 3, background: 'green' },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    objects.set(photo, png);
    await expect(
      provider.postPending('x', 'token:secret', [post(photo)], integration)
    ).rejects.toThrow(/5 MB/);
    expect(uploads).toHaveLength(0);
  });

  it('returns a specific error when input image data cannot be identified', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'true');
    objects.set(photo, Buffer.from('Not an image'));
    await expect(
      provider.postPending('x', 'token:secret', [post(photo)], integration)
    ).rejects.toThrow(/unable to read the image/i);
    expect(uploads).toHaveLength(0);
  });

  it('returns the platform reason when X rejects an image', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'true');
    objects.set(photo, await fixture('webp'));
    vi.mocked(TwitterApiv2.prototype.post).mockRejectedValueOnce({
      code: 400,
      data: { errors: [{ message: 'Invalid image dimensions' }] },
    });
    await expect(
      provider.postPending('x', 'token:secret', [post(photo)], integration)
    ).rejects.toThrow(/Invalid image dimensions/);
  });

  it.each([undefined, 'true'])(
    'prepares attachments, cover and inline article images for setting %j',
    async (setting) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
      const cover = blobBase + 'cover.png';
      const inline = blobBase + 'inline.png';
      const png = await fixture('png');
      for (const path of [photo, cover, inline]) objects.set(path, png);
      const article = post(
        photo,
        {
          post_type: 'article',
          article_title: 'Photos',
          article_status: 'draft',
          article_cover: { id: 'cover', path: cover },
        },
        `<p>Inline <img src="${inline}"></p>`
      );
      const request = vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toBe('https://api.x.com/2/articles/draft');
        const body = JSON.parse(String(options.body));
        expect(body.cover_media).toEqual({
          media_category: 'tweet_image',
          media_id: '2',
        });
        expect(
          body.content_state.entities.map(
            (e: any) => e.value.data.media_items[0].media_id
          )
        ).toEqual(['3', '1']);
        return Response.json({ data: { id: 'draft-id' } });
      });
      vi.stubGlobal('fetch', request);
      const [draft] = await provider.post(
        'x',
        'token:secret',
        [article],
        integration
      );
      expect(draft).toMatchObject({ postId: 'draft-id', status: 'posted' });
      expect(request).toHaveBeenCalledOnce();
      expect(uploads).toHaveLength(3);
      for (const upload of uploads) {
        const bytes = Buffer.concat(upload.segments);
        expect(upload.media_category).toBe('tweet_image');
        if (setting) {
          expect(upload.media_type).toBe('image/png');
          expect(bytes).toEqual(png);
        } else {
          expect(upload.media_type).toBe('image/jpeg');
          expect(await sharp(bytes).metadata()).toMatchObject({
            width: 1000,
            height: 500,
            format: 'jpeg',
          });
        }
      }
    }
  );

  it.each([undefined, 'parent-comment'])(
    'sends an original WebP in a reply to %j',
    async (lastCommentId) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', '0');
      const webp = await fixture('webp');
      objects.set(photo, webp);
      vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
        expect(url).toBe('https://api.x.com/2/tweets');
        expect(JSON.parse(String(options.body))).toMatchObject({
          media: { media_ids: ['1'] },
          reply: { in_reply_to_tweet_id: lastCommentId || 'parent-post' },
        });
        return Response.json({ data: { id: 'sent-comment' } });
      });
      const [comment] = await provider.comment(
        'x',
        'parent-post',
        lastCommentId,
        'token:secret',
        [post(photo)],
        integration
      );
      expect(comment).toMatchObject({
        status: 'posted',
        postId: 'sent-comment',
      });
      expect(uploads[0].media_type).toBe('image/webp');
      expect(Buffer.concat(uploads[0].segments)).toEqual(webp);
    }
  );

  it('preserves animation and original GIF bytes when processing is disabled', async () => {
    vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'false');
    const pixels = Buffer.concat([
      Buffer.alloc(32 * 16 * 3, 0),
      Buffer.alloc(32 * 16 * 3, 255),
    ]);
    const gif = await sharp(pixels, {
      raw: { width: 32, height: 32, pageHeight: 16, channels: 3 },
    })
      .gif()
      .toBuffer();
    objects.set(photo, gif);
    await provider.postPending('x', 'token:secret', [post(photo)], integration);
    expect(uploads[0]).toMatchObject({
      media_type: 'image/gif',
      media_category: 'tweet_gif',
    });
    expect(Buffer.concat(uploads[0].segments)).toEqual(gif);
  });

  it('reads an original local image without writing a publish copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postiz-x-original-'));
    try {
      vi.stubEnv('UPLOAD_DIRECTORY', directory);
      vi.stubEnv('STORAGE_PROVIDER', 'local');
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', 'true');
      const path = join(directory, 'photo.png');
      const png = await fixture('png');
      await writeFile(path, png);
      await provider.postPending(
        'x',
        'token:secret',
        [post(path)],
        integration
      );
      expect(Buffer.concat(uploads[0].segments)).toEqual(png);
      expect(await readdir(directory)).toEqual(['photo.png']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([undefined, 'true'])(
    'uploads the original MP4 in ranged segments for setting %j',
    async (setting) => {
      vi.stubEnv('DISABLE_PUBLISH_IMAGE_PROCESSING', setting);
      const path = blobBase + 'clip.mp4';
      const segment = 1024 * 1024;
      const clip = Buffer.concat([
        Buffer.alloc(segment, 1),
        Buffer.from('last bytes'),
      ]);
      const ranges: string[] = [];
      vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
        expect(url).toBe(path);
        if (options.method === 'HEAD')
          return new Response(null, {
            headers: { 'content-length': String(clip.length) },
          });
        const range = new Headers(options.headers).get('range')!;
        ranges.push(range);
        const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
        return new Response(clip.subarray(Number(start), Number(end) + 1), {
          status: 206,
        });
      });
      const video = {
        ...post(path),
        media: [{ path, type: 'video' as const }],
      };
      const [result] = await provider.postPending(
        'x',
        'token:secret',
        [video],
        integration
      );
      expect(result).toMatchObject({
        status: 'pending',
        pendingData: { mediaIds: ['1'] },
      });
      expect(ranges).toEqual(['bytes=0-1048575', 'bytes=1048576-1048585']);
      expect(uploads[0]).toMatchObject({
        media_category: 'tweet_video',
        media_type: 'video/mp4',
        total_bytes: clip.length,
      });
      expect(Buffer.concat(uploads[0].segments).equals(clip)).toBe(true);
    }
  );
});
