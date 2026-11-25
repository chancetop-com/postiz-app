import 'reflect-metadata';
import type { Integration } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { GmbProvider } from '@gitroom/nestjs-libraries/integrations/social/gmb.provider';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { ThreadsProvider } from '@gitroom/nestjs-libraries/integrations/social/threads.provider';
import type {
  MediaContent,
  PostDetails,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const blobBase =
  'https://fixtureaccount.blob.core.windows.net/postiz/dev/org-42';
const photo: MediaContent = { type: 'image', path: `${blobBase}/a%2Bb.jpg` };
const video: MediaContent = {
  type: 'video',
  path: `${blobBase}/clip+trailer.MP4`,
};
const secondPhoto: MediaContent = {
  type: 'image',
  path: `${blobBase}/cover.jpg`,
};
const cover = `${blobBase}/cover%20photo.jpg`;
const integration = { internalId: 'account' } as Integration;
const post = (media: MediaContent[], post_type = 'post'): PostDetails[] => [
  {
    id: 'scheduled',
    message: 'Our new collection',
    settings: { post_type },
    media,
  },
];

// The fake platform only accepts the listed endpoints. Any Blob fetch or
// alternate upload route is observable, including calls a provider catches.
type Reply = [endpoint: string, data: unknown, status?: number, host?: string];
function platform(host: string, ...replies: Reply[]) {
  const requests: Request[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const reply = replies[requests.length];
      requests.push(request);
      expect(reply, request.url).toBeDefined();
      expect(url.hostname).toBe(reply[3] ?? host);
      expect(url.pathname.endsWith('/' + reply[0])).toBe(true);
      return Response.json(reply[1], { status: reply[2] ?? 200 });
    }
  );
  return requests;
}

function params(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}

function rejection(message: RegExp, error: unknown) {
  return {
    type: 'bad_body',
    message: expect.stringMatching(message),
    details: [expect.objectContaining({ json: JSON.stringify(error) })],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each([
  {
    name: 'instagram',
    provider: new InstagramProvider(),
    host: 'graph.facebook.com',
  },
  {
    name: 'instagram-standalone',
    provider: new InstagramStandaloneProvider(),
    host: 'graph.instagram.com',
  },
])('$name Blob media', ({ provider, host }) => {
  it('submits the exact image URL and returns the accepted container', async () => {
    const requests = platform(host, ['account/media', { id: 'ig-image' }]);
    const [result] = await provider.postPending(
      'account',
      'token',
      post([photo]),
      integration
    );
    expect(result).toMatchObject({
      status: 'pending',
      pendingData: { containers: ['ig-image'] },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(new URL(requests[0].url).searchParams.get('image_url')).toBe(
      photo.path
    );
  });

  it('sends the video and selected cover URLs on a Reel', async () => {
    const requests = platform(host, ['account/media', { id: 'reel' }]);
    await provider.postPending(
      'account',
      'token',
      post([{ ...video, thumbnail: cover }]),
      integration
    );
    expect(requests.map(params)).toEqual([
      expect.objectContaining({
        media_type: 'REELS',
        video_url: video.path,
        cover_url: cover,
      }),
    ]);
  });

  it('publishes a mixed carousel using the accepted child and parent IDs', async () => {
    const requests = platform(
      host,
      ['account/media', { id: 'photo' }],
      ['account/media', { id: 'clip' }],
      ['account/media', { id: 'carousel' }],
      ['account/media_publish', { id: 'published' }],
      ['published', { permalink: 'https://www.instagram.com/p/published' }]
    );
    const [created] = await provider.postPending(
      'account',
      'token',
      post([photo, video]),
      integration
    );
    const parent = await provider.finalizePost(
      'token',
      created.pendingData,
      integration
    );
    expect(parent.status).toBe('pending');
    if (parent.status !== 'pending')
      throw new Error('Expected the carousel container');
    const result = await provider.finalizePost(
      'token',
      parent.pendingData,
      integration
    );
    expect(result).toMatchObject({ status: 'completed', postId: 'published' });
    expect(requests.map(params)).toEqual([
      expect.objectContaining({
        image_url: photo.path,
        is_carousel_item: 'true',
      }),
      expect.objectContaining({
        video_url: video.path,
        media_type: 'VIDEO',
        is_carousel_item: 'true',
      }),
      expect.objectContaining({
        media_type: 'CAROUSEL',
        children: 'photo,clip',
      }),
      expect.objectContaining({ creation_id: 'carousel' }),
      expect.objectContaining({ fields: 'permalink' }),
    ]);
  });

  it('creates individual image and video Stories from their Blob URLs', async () => {
    const requests = platform(
      host,
      ['account/media', { id: 's1' }],
      ['account/media', { id: 's2' }]
    );
    const [result] = await provider.postPending(
      'account',
      'token',
      post([photo, { ...video, thumbnail: cover }], 'story'),
      integration
    );
    expect(result).toMatchObject({
      status: 'pending',
      pendingData: { containers: ['s1', 's2'] },
    });
    expect(requests.map(params)).toEqual([
      expect.objectContaining({ image_url: photo.path, media_type: 'STORIES' }),
      expect.objectContaining({ video_url: video.path, media_type: 'STORIES' }),
    ]);
    expect(params(requests[1])).not.toHaveProperty('cover_url');
  });

  it.each([
    { attachment: photo, field: 'image_url' },
    { attachment: video, field: 'video_url' },
  ])('creates a single Story by $field', async ({ attachment, field }) => {
    const requests = platform(host, ['account/media', { id: 'story' }]);
    await provider.postPending(
      'account',
      'token',
      post([attachment], 'story'),
      integration
    );
    expect(requests.map(params)).toEqual([
      expect.objectContaining({
        [field]: attachment.path,
        media_type: 'STORIES',
      }),
    ]);
  });

  it('returns the platform reason for a rejected media pull', async () => {
    const error = {
      error: { error_subcode: 2207003, message: 'Timeout downloading media' },
    };
    const requests = platform(host, ['account/media', error, 400]);
    await expect(
      provider.postPending('account', 'token', post([photo]), integration)
    ).rejects.toMatchObject(rejection(/downloading media/i, error));
    expect(requests.map(params)).toEqual([
      expect.objectContaining({ image_url: photo.path }),
    ]);
  });
});

describe('Facebook Page Blob media', () => {
  const provider = new FacebookProvider();
  const host = 'graph.facebook.com';

  it.each([[photo], [photo, secondPhoto]].map((media) => ({ media })))(
    'attaches $media.length photos to the feed by ID',
    async ({ media }) => {
      const uploads: Reply[] = media.map((_, i) => [
        'account/photos',
        { id: `fb-photo-${i}` },
      ]);
      const requests = platform(host, ...uploads, [
        'account/feed',
        {
          id: 'feed-1',
          permalink_url: 'https://www.facebook.com/posts/feed-1',
        },
      ]);
      const [result] = await provider.postPending(
        'account',
        'token',
        post(media),
        integration
      );
      expect(result).toMatchObject({ status: 'success', postId: 'feed-1' });
      expect(requests).toHaveLength(media.length + 1);
      const bodies = await Promise.all(
        requests.map((request) => request.json())
      );
      expect(bodies.slice(0, -1)).toEqual(
        media.map((item) => ({ url: item.path, published: false }))
      );
      expect(bodies.at(-1).attached_media).toEqual(
        media.map((_, i) => ({ media_fbid: `fb-photo-${i}` }))
      );
    }
  );

  it('publishes a feed video by file_url', async () => {
    const requests = platform(host, ['account/videos', { id: 'fb-clip' }]);
    const [result] = await provider.postPending(
      'account',
      'token',
      post([video]),
      integration
    );
    expect(result).toMatchObject({ status: 'success', postId: 'fb-clip' });
    expect(requests).toHaveLength(1);
    expect(await requests[0].json()).toMatchObject({
      file_url: video.path,
      published: true,
    });
  });

  it.each([[photo], [photo, secondPhoto]].map((media) => ({ media })))(
    'prepares $media.length photo Stories with their Blob URLs',
    async ({ media }) => {
      const uploads: Reply[] = media.map((_, i) => [
        'account/photos',
        { id: `story-${i}` },
      ]);
      const requests = platform(host, ...uploads);
      const [result] = await provider.postPending(
        'account',
        'token',
        post(media, 'story'),
        integration
      );
      expect(result).toMatchObject({
        status: 'pending',
        pendingData: {
          items: media.map((_, i) => ({
            kind: 'photo',
            mediaId: `story-${i}`,
          })),
        },
      });
      expect(
        await Promise.all(requests.map((request) => request.json()))
      ).toEqual(media.map((item) => ({ url: item.path, published: false })));
    }
  );

  it('submits a video Story URL to the returned upload endpoint and polls its video ID', async () => {
    const requests = platform(
      host,
      [
        'account/video_stories',
        {
          video_id: 'fb-story',
          upload_url: 'https://rupload.facebook.com/video/fb-story',
        },
      ],
      ['video/fb-story', { success: true }, 200, 'rupload.facebook.com'],
      ['fb-story', { status: { video_status: 'in_progress' } }]
    );
    const [result] = await provider.postPending(
      'account',
      'token',
      post([video], 'story'),
      integration
    );
    expect(result.status).toBe('pending');
    const check = await provider.checkPostStatus(
      'token',
      result.pendingData,
      integration
    );
    expect(check.status).toBe('pending');
    expect(requests).toHaveLength(3);
    expect(params(requests[0]).upload_phase).toBe('start');
    expect(requests[1].headers.get('file_url')).toBe(video.path);
    expect(requests[1].body).toBeNull();
    expect(params(requests[2]).fields).toBe('status');
  });

  it('sends a media reply to the preceding comment with attachment_url', async () => {
    const requests = platform(host, [
      'parent-comment/comments',
      { id: 'reply', permalink_url: 'https://www.facebook.com/posts/reply' },
    ]);
    const [result] = await provider.comment(
      'account',
      'post',
      'parent-comment',
      'token',
      post([photo]),
      integration
    );
    expect(result).toMatchObject({ status: 'success', postId: 'reply' });
    expect(requests).toHaveLength(1);
    expect(await requests[0].json()).toMatchObject({
      attachment_url: photo.path,
    });
  });

  it('surfaces Facebook’s media URL rejection without trying another upload', async () => {
    const error = {
      error: { error_subcode: 2061006, message: 'Invalid URL format' },
    };
    const requests = platform(host, ['account/photos', error, 400]);
    await expect(
      provider.postPending('account', 'token', post([photo]), integration)
    ).rejects.toMatchObject(rejection(/invalid url/i, error));
    expect(requests).toHaveLength(1);
    expect(await requests[0].json()).toMatchObject({ url: photo.path });
  });
});

describe('Threads Blob media', () => {
  const provider = new ThreadsProvider();
  const host = 'graph.threads.net';
  const mediaCases = [
    { attachment: photo, field: 'image_url', type: 'IMAGE' },
    { attachment: video, field: 'video_url', type: 'VIDEO' },
  ];

  it.each(mediaCases)(
    'accepts a single $type by URL',
    async ({ attachment, field, type }) => {
      const requests = platform(host, ['account/threads', { id: 'single' }]);
      const [result] = await provider.postPending(
        'account',
        'token',
        post([attachment]),
        integration
      );
      expect(result).toMatchObject({
        status: 'pending',
        pendingData: { containerId: 'single' },
      });
      expect(requests.map(params)).toEqual([
        expect.objectContaining({ [field]: attachment.path, media_type: type }),
      ]);
    }
  );

  it('links the accepted media children to a carousel and publishes the parent', async () => {
    const requests = platform(
      host,
      ['account/threads', { id: 'image-child' }],
      ['account/threads', { id: 'video-child' }],
      ['account/threads', { id: 'parent' }],
      ['account/threads_publish', { id: 'posted' }],
      ['posted', { permalink: 'https://www.threads.net/t/posted' }]
    );
    const [children] = await provider.postPending(
      'account',
      'token',
      post([photo, video]),
      integration
    );
    const parent = await provider.finalizePost(
      'token',
      children.pendingData,
      integration
    );
    if (parent.status !== 'pending')
      throw new Error('Expected the carousel container');
    const result = await provider.finalizePost(
      'token',
      parent.pendingData,
      integration
    );
    expect(result).toMatchObject({ status: 'completed', postId: 'posted' });
    expect(requests.map(params)).toEqual([
      expect.objectContaining({
        is_carousel_item: 'true',
        image_url: photo.path,
      }),
      expect.objectContaining({
        is_carousel_item: 'true',
        video_url: video.path,
      }),
      expect.objectContaining({
        media_type: 'CAROUSEL',
        children: 'image-child,video-child',
      }),
      expect.objectContaining({ creation_id: 'parent' }),
      expect.objectContaining({ fields: 'id,permalink' }),
    ]);
  });

  it.each(mediaCases)(
    'publishes a $type reply to the preceding comment',
    async ({ attachment, field, type }) => {
      vi.useFakeTimers();
      const requests = platform(
        host,
        ['account/threads', { id: 'reply-container' }],
        ['reply-container', { status: 'FINISHED' }],
        ['account/threads_publish', { id: 'reply' }],
        ['reply', { permalink: 'https://www.threads.net/t/reply' }]
      );
      const reply = provider.comment(
        'account',
        'original-post',
        'previous-comment',
        'token',
        post([attachment]),
        integration
      );
      await vi.runAllTimersAsync();
      const [result] = await reply;
      expect(result).toMatchObject({ status: 'success', postId: 'reply' });
      expect(requests).toHaveLength(4);
      expect(params(requests[0])).toMatchObject({
        [field]: attachment.path,
        reply_to_id: 'previous-comment',
        media_type: type,
      });
      expect(params(requests[2]).creation_id).toBe('reply-container');
    }
  );

  it('reports a rejected pull when checking an accepted container', async () => {
    const error = {
      status: 'ERROR',
      error_message: 'Image URL was inaccessible',
    };
    const requests = platform(
      host,
      ['account/threads', { id: 'processing' }],
      ['processing', error]
    );
    const [created] = await provider.postPending(
      'account',
      'token',
      post([photo]),
      integration
    );
    expect(created.status).toBe('pending');
    await expect(
      provider.checkPostStatus('token', created.pendingData, integration)
    ).rejects.toMatchObject(rejection(/Image URL was inaccessible/, error));
    expect(requests).toHaveLength(2);
    expect(params(requests[0]).image_url).toBe(photo.path);
  });
});

describe('Google Business Profile Blob media', () => {
  const provider = new GmbProvider();
  const account = 'accounts/12/locations/34';
  const host = 'mybusiness.googleapis.com';

  it('publishes a text update with one PHOTO sourceUrl', async () => {
    const name = account + '/localPosts/56';
    const requests = platform(host, [
      account + '/localPosts',
      { name, state: 'LIVE' },
    ]);
    const [result] = await provider.post(account, 'token', post([photo]));
    expect(result).toMatchObject({ status: 'success', postId: name });
    expect(requests).toHaveLength(1);
    expect(await requests[0].json()).toMatchObject({
      summary: 'Our new collection',
      media: [{ mediaFormat: 'PHOTO', sourceUrl: photo.path }],
    });
  });

  it('returns the Google error for an inaccessible sourceUrl', async () => {
    const error = {
      error: { status: 'INVALID_ARGUMENT', message: 'Invalid photo sourceUrl' },
    };
    const requests = platform(host, [account + '/localPosts', error, 400]);
    await expect(
      provider.post(account, 'token', post([photo]))
    ).rejects.toMatchObject(rejection(/check your post details/i, error));
    expect(requests).toHaveLength(1);
    expect((await requests[0].json()).media).toEqual([
      { mediaFormat: 'PHOTO', sourceUrl: photo.path },
    ]);
  });

  it.each([
    { media: [photo, photo], error: /only have one image/ },
    { media: [video], error: /do not support video/ },
  ])(
    'rejects unsupported attachments before sending: $error',
    async ({ media, error }) => {
      const requests = platform(host);
      await expect(
        provider.post(account, 'token', post(media))
      ).rejects.toThrow(error);
      expect(requests).toHaveLength(0);
    }
  );
});
