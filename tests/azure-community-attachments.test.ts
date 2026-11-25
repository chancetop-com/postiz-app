import 'reflect-metadata';
import type { Integration } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeweProvider } from '@gitroom/nestjs-libraries/integrations/social/mewe.provider';
import { SkoolProvider } from '@gitroom/nestjs-libraries/integrations/social/skool.provider';
import { TumblrProvider } from '@gitroom/nestjs-libraries/integrations/social/tumblr.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { PassThrough } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import sharp from 'sharp';
import { WhopProvider } from '@gitroom/nestjs-libraries/integrations/social/whop.provider';

const blobBase = 'https://fixtureaccount.blob.core.windows.net/postiz/dev/org';
const photo = { type: 'image' as const, path: blobBase + '/photo.png' };
const clip = { type: 'video' as const, path: blobBase + '/clip.mp4' };
const integration = { id: 'account', profile: 'test' } as Integration;
const timeline = { postType: 'timeline' as const };
const photoBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3goAAAAASUVORK5CYII=',
  'base64'
);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// The byte-stream transports treat the video as opaque.
const videoBytes = Buffer.from(
  '000000186674797069736f6d0000020069736f6d69736f32',
  'hex'
);
const whopFiles = 'https://api.whop.com/api/v1/files';
const whopPosts = 'https://api.whop.com/api/v1/forum_posts';
const whopPost = {
  id: 'post-1',
  message: 'attachment',
  settings: { company: 'company-1', experience: 'experience-1' },
  media: [clip],
};
const jsonBody = (init?: RequestInit) => JSON.parse(String(init?.body));
const mockHttp = (
  handle: (url: string, init: RequestInit) => Response | Promise<Response>
) => {
  const fetch = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
    handle(String(input), init)
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
function blobResponse(init: RequestInit, bytes: Buffer, type: string) {
  return new Response(init.method === 'HEAD' ? null : new Uint8Array(bytes), {
    headers: { 'content-length': String(bytes.length), 'content-type': type },
  });
}

describe('MeWe scheduled attachments', () => {
  it('uploads the Blob bytes as a photo and uses the returned ID in the timeline', async () => {
    const fetch = mockHttp(async (url, init) => {
      if (url === photo.path)
        return blobResponse(init, photoBytes, 'image/png');
      if (url === 'https://mewe.com/api/dev/photo/upload') {
        const file = (init.body as FormData).get('file') as File;
        expect(file.name).toBe('photo.png');
        expect(file.type).toBe('image/png');
        expect(Buffer.from(await file.arrayBuffer())).toEqual(photoBytes);
        return Response.json({ id: 'photo-29' });
      }
      expect(url).toBe('https://mewe.com/api/dev/me/post');
      expect(jsonBody(init)).toEqual({
        text: 'caption',
        uploadedPhotoIds: ['photo-29'],
      });
      return new Response(null, { status: 204 });
    });
    const post = {
      id: 'p',
      message: 'caption',
      settings: timeline,
      media: [photo],
    };
    expect(
      await new MeweProvider().post('account', 'token', [post], integration)
    ).toMatchObject([{ id: 'p', status: 'success' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops when MeWe accepts the upload without returning a photo ID', async () => {
    const fetch = mockHttp((url, init) =>
      url === photo.path
        ? blobResponse(init, photoBytes, 'image/png')
        : Response.json({})
    );
    const post = {
      id: 'p',
      message: 'caption',
      settings: timeline,
      media: [photo],
    };
    await expect(
      new MeweProvider().post('account', 'token', [post], integration)
    ).rejects.toThrow(/photo ID/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a missing Blob photo before sending the error body as a file', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('missing', { status: 404 }))
    );
    vi.stubGlobal('fetch', fetch);
    const post = {
      id: 'p',
      message: 'caption',
      settings: timeline,
      media: [photo],
    };
    await expect(
      new MeweProvider().post('account', 'token', [post], integration)
    ).rejects.toThrow(/photo.*404/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the MP4 restriction during scheduling validation', async () => {
    expect(await new MeweProvider().checkValidity([[photo, clip]])).toMatch(
      /MeWe.*(video|MP4)/i
    );
  });

  it('rejects a post containing an MP4 before uploading any photos', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetch);
    const post = {
      id: 'p',
      message: 'caption',
      settings: timeline,
      media: [photo, clip],
    };
    await expect(
      new MeweProvider().post('account', 'token', [post], integration)
    ).rejects.toThrow(/MeWe.*(video|MP4)/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Whop scheduled attachments', () => {
  it.each(['post', 'reply'])(
    'streams the attachment and waits for ready before its %s',
    async (kind) => {
      vi.useFakeTimers();
      const upload = 'https://whop-upload.example.test/asset';
      let polls = 0;
      const fetch = mockHttp(async (url, init) => {
        if (url === clip.path)
          return blobResponse(init, videoBytes, 'video/mp4');
        if (url === whopFiles) {
          expect(jsonBody(init)).toMatchObject({ filename: 'clip.mp4' });
          return Response.json({
            id: 'file-3',
            upload_url: upload,
            upload_headers: { 'x-upload-token': 'signed' },
          });
        }
        if (url === upload) {
          expect(init.method).toBe('PUT');
          const headers = new Headers(init.headers);
          expect(headers.get('content-length')).toBe(String(videoBytes.length));
          expect(headers.get('x-upload-token')).toBe('signed');
          expect(init.body).toBeInstanceOf(ReadableStream);
          expect(
            Buffer.from(await new Response(init.body).arrayBuffer())
          ).toEqual(videoBytes);
          return new Response(null, { status: 200 });
        }
        if (url === whopFiles + '/file-3') {
          polls++;
          return Response.json({
            upload_status: polls === 1 ? 'processing' : 'ready',
          });
        }
        expect(url).toBe(whopPosts);
        expect(polls).toBe(2);
        expect(jsonBody(init)).toEqual({
          experience_id: 'experience-1',
          content: 'attachment',
          ...(kind === 'reply' ? { parent_id: 'previous' } : {}),
          attachments: [{ id: 'file-3' }],
        });
        return Response.json({ id: 'whop-result' });
      });
      const provider = new WhopProvider();
      const result =
        kind === 'post'
          ? provider.post('account', 'token', [whopPost], integration)
          : provider.comment(
              'account',
              'root',
              'previous',
              'token',
              [whopPost],
              integration
            );
      await vi.advanceTimersByTimeAsync(5000);
      expect(await result).toMatchObject([
        { status: 'success', postId: 'whop-result' },
      ]);
      expect(
        fetch.mock.calls.map(([url, init]) => [url, init?.method || 'GET'])
      ).toEqual([
        [clip.path, 'HEAD'],
        [whopFiles, 'POST'],
        [clip.path, 'GET'],
        [upload, 'PUT'],
        [whopFiles + '/file-3', 'GET'],
        [whopFiles + '/file-3', 'GET'],
        [whopPosts, 'POST'],
      ]);
    }
  );

  it('reports a failed Whop processing result without sending a forum post', async () => {
    const upload = 'https://whop-upload.example.test/asset';
    mockHttp((url, init) => {
      if (url === clip.path) return blobResponse(init, videoBytes, 'video/mp4');
      if (url === whopFiles)
        return Response.json({ id: 'file-3', upload_url: upload });
      if (url === upload) return new Response(null, { status: 200 });
      if (url === whopFiles + '/file-3')
        return Response.json({ upload_status: 'failed' });
      throw new Error('Unexpected request ' + url);
    });
    await expect(
      new WhopProvider().post('account', 'token', [whopPost], integration)
    ).rejects.toThrow('File upload failed');
  });

  it('stops before publishing a file record with no upload destination', async () => {
    const fetch = mockHttp((url, init) => {
      if (url === clip.path) return blobResponse(init, videoBytes, 'video/mp4');
      if (url === whopFiles) return Response.json({ id: 'unuploaded' });
      if (url === whopPosts) return Response.json({ id: 'broken-post' });
      throw new Error('Unexpected request ' + url);
    });
    await expect(
      new WhopProvider().post('account', 'token', [whopPost], integration)
    ).rejects.toThrow(/upload destination/i);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      clip.path,
      whopFiles,
    ]);
  });
});

const skoolFiles = 'https://api2.skool.com/files';
const skoolPosts = 'https://api2.skool.com/posts?follow=true';
const skoolAccount = () => ({
  ...integration,
  customInstanceDetails: AuthService.fixedEncryption(
    JSON.stringify({ client_id: 'client', auth_token: 'token' })
  ),
});

describe('Skool scheduled attachments', () => {
  it('stops before uploading when Skool omits the new file ID', async () => {
    const fetch = mockHttp((url, init) => {
      if (url === clip.path) return blobResponse(init, videoBytes, 'video/mp4');
      if (url === skoolFiles)
        return Response.json({
          file: {},
          write_url: 'https://skool-upload.example.test/write',
        });
      return Response.json({ id: 'broken-result' });
    });
    const post = { ...whopPost, settings: { group: 'group-1' } };
    await expect(
      new SkoolProvider().post('account', 'token', [post], skoolAccount())
    ).rejects.toThrow(/file ID/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['post', 'reply', 'rejected upload'])(
    'handles file metadata, bytes and ID for %s',
    async (kind) => {
      const writeUrl = 'https://skool-upload.example.test/write';
      const fetch = mockHttp(async (url, init) => {
        if (url === clip.path)
          return blobResponse(init, videoBytes, 'video/mp4');
        if (url === skoolFiles) {
          expect(jsonBody(init)).toMatchObject({
            file_name: 'clip.mp4',
            content_type: 'video/mp4',
            content_length: videoBytes.length,
            owner_id: 'account',
          });
          return Response.json({
            file: { id: 'file-39' },
            write_url: writeUrl,
            content_type: 'video/mp4',
            acl: 'private',
          });
        }
        if (url === writeUrl) {
          const headers = new Headers(init.headers);
          expect(headers.get('content-type')).toBe('video/mp4');
          expect(headers.get('content-length')).toBe(String(videoBytes.length));
          expect(headers.get('x-amz-acl')).toBe('private');
          expect(init.body).toBeInstanceOf(ReadableStream);
          expect(
            Buffer.from(await new Response(init.body).arrayBuffer())
          ).toEqual(videoBytes);
          return new Response(null, {
            status: kind === 'rejected upload' ? 403 : 200,
          });
        }
        expect(url).toBe(skoolPosts);
        expect(jsonBody(init)).toMatchObject({
          post_type: kind === 'reply' ? 'comment' : 'generic',
          group_id: 'group-1',
          ...(kind === 'reply'
            ? { parent_id: 'previous', root_id: 'root' }
            : {}),
          metadata: { content: 'attachment', attachments: 'file-39' },
        });
        return Response.json({ id: 'skool-result', name: 'slug' });
      });
      const provider = new SkoolProvider();
      const post = { ...whopPost, settings: { group: 'group-1' } };
      const result =
        kind === 'reply'
          ? provider.comment(
              'account',
              'root',
              'previous',
              'token',
              [post],
              skoolAccount()
            )
          : provider.post('account', 'token', [post], skoolAccount());
      const calls = [
        [clip.path, 'HEAD'],
        [skoolFiles, 'POST'],
        [clip.path, 'GET'],
        [writeUrl, 'PUT'],
      ];
      if (kind === 'rejected upload') {
        await expect(result).rejects.toThrow('Failed to upload the media file');
      } else {
        expect(await result).toMatchObject([
          { postId: 'skool-result', status: 'success' },
        ]);
        calls.push([skoolPosts, 'POST']);
      }
      expect(
        fetch.mock.calls.map(([url, init]) => [url, init?.method || 'GET'])
      ).toEqual(calls);
    }
  );
});

describe('Tumblr scheduled posts', () => {
  const endpoint = 'https://api.tumblr.com/v2/blog/blog/posts';
  const post = { id: 'p', message: 'a paragraph', settings: {} };
  it('publishes a text-only post as JSON', async () => {
    const fetch = mockHttp((url, init) => {
      expect(url).toBe(endpoint);
      expect(new Headers(init.headers).get('content-type')).toBe(
        'application/json'
      );
      expect(jsonBody(init)).toEqual({
        state: 'published',
        content: [{ type: 'text', text: post.message }],
      });
      return Response.json(
        { response: { id_string: 'text-result' } },
        { status: 201 }
      );
    });
    expect(
      await new TumblrProvider().post('blog', 'token', [post], integration)
    ).toMatchObject([{ postId: 'text-result', status: 'completed' }]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['image', 'video', 'video with thumbnail'])(
    'streams original %s bytes into the corresponding NPF block',
    async (kind) => {
      const png = await sharp({
        create: { width: 17, height: 11, channels: 3, background: 'teal' },
      })
        .png()
        .toBuffer();
      const isImage = kind === 'image';
      const media = isImage
        ? { ...photo, alt: 'a teal image' }
        : {
            ...clip,
            thumbnail: kind === 'video with thumbnail' ? photo.path : undefined,
          };
      const expectedBytes = isImage ? png : videoBytes;
      const mime = isImage ? 'image/png' : 'video/mp4';
      const reads = mockHttp((url, init) => {
        expect(url).toBe(media.path);
        return blobResponse(init, expectedBytes, mime);
      });
      const http = getSsrfSafeAxios();
      const originalAdapter = http.defaults.adapter;
      const adapter = vi.fn<import('axios').AxiosAdapter>(async (config) => {
        let data;
        if (config.method === 'get') {
          expect(config.url).toBe(photo.path);
          data = png;
        } else {
          expect(config.method).toBe('post');
          expect(config.url).toBe(endpoint);
          const stream = config.data.pipe(new PassThrough());
          const multipart = await new Response(
            new Uint8Array(await buffer(stream)),
            {
              headers: {
                'content-type': config.headers.getContentType() as string,
              },
            }
          ).formData();
          const payload = JSON.parse(String(multipart.get('json')));
          const details = {
            identifier: 'media-0',
            type: mime,
            ...(kind === 'video'
              ? { width: 540, height: 405 }
              : { width: 17, height: 11 }),
          };
          expect(payload.content[1]).toEqual(
            isImage
              ? { type: 'image', media: [details], alt_text: 'a teal image' }
              : { type: 'video', provider: 'tumblr', media: details }
          );
          const file = multipart.get('media-0') as File;
          expect(file.type).toBe(mime);
          expect(Buffer.from(await file.arrayBuffer())).toEqual(expectedBytes);
          data = { response: { id_string: 'tumblr-result' } };
        }
        return { config, data, headers: {}, status: 200, statusText: 'OK' };
      });
      http.defaults.adapter = adapter;
      try {
        expect(
          await new TumblrProvider().post(
            'blog',
            'token',
            [{ ...post, media: [media] }],
            integration
          )
        ).toMatchObject([{ postId: 'tumblr-result', status: 'completed' }]);
        expect(adapter.mock.calls.map(([call]) => call.method)).toEqual(
          kind === 'video' ? ['post'] : ['get', 'post']
        );
        expect(
          reads.mock.calls.map(([, init]) => init?.method || 'GET')
        ).toEqual(['HEAD', 'GET']);
      } finally {
        http.defaults.adapter = originalAdapter;
      }
    }
  );

  it('reports Tumblr content rejections to the scheduler', async () => {
    mockHttp(() =>
      Response.json({ errors: [{ code: 8001 }] }, { status: 400 })
    );
    await expect(
      new TumblrProvider().post('blog', 'token', [post], integration)
    ).rejects.toThrow(/rejected the post content format/);
  });
});
