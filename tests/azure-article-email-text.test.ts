import 'reflect-metadata';
import type { Integration, Post } from '@prisma/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import type { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { DevToProvider } from '@gitroom/nestjs-libraries/integrations/social/dev.to.provider';
import { HashnodeProvider } from '@gitroom/nestjs-libraries/integrations/social/hashnode.provider';
import { KickProvider } from '@gitroom/nestjs-libraries/integrations/social/kick.provider';
import { ListmonkProvider } from '@gitroom/nestjs-libraries/integrations/social/listmonk.provider';
import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import { MediumProvider } from '@gitroom/nestjs-libraries/integrations/social/medium.provider';
import { WordpressProvider } from '@gitroom/nestjs-libraries/integrations/social/wordpress.provider';
import { TwitchProvider } from '@gitroom/nestjs-libraries/integrations/social/twitch.provider';

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

const blobBase =
  'https://fixtureaccount.blob.core.windows.net/postiz/dev/org-1';
const bodyImage = blobBase + '/article.png';
const cover = blobBase + '/cover.png';
const html = '<p>Latest news</p><img src="' + bodyImage + '" alt="Article">';
const markdown = '![Article](' + bodyImage + ')';
const integration = {
  profile: 'channel',
  internalId: '42',
  token: 'token',
  organizationId: 'org-1',
} as Integration;

// Use the worker's message formatting and media preparation. No worker,
// database, credentials, or external platform is needed for these fixtures.
function scheduled(
  provider: SocialProvider,
  content: string,
  settings = {},
  channel = integration
) {
  const activity = new PostActivity(
    Object.create(PostsService.prototype),
    undefined!,
    { getSocialIntegration: () => provider } as any,
    { decryptTokens: async (value: Integration) => value } as any,
    undefined!,
    undefined!,
    {
      client: { getRawClient: () => ({ workflow: { start: async () => {} } }) },
    } as any,
    undefined!
  );
  return activity.postSocialPending(
    { ...channel, providerIdentifier: provider.identifier },
    [
      {
        id: 'scheduled-1',
        content,
        settings: JSON.stringify(settings),
        image: '[]',
      } as Post,
    ]
  );
}
const textPost = {
  id: 'scheduled-1',
  message: 'Hello channel',
  media: [{ type: 'image' as const, path: bodyImage }],
  settings: {},
};

function platform(...responses: Response[]) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const request = new Request(url, init);
    requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request: ' + request.url);
    return response;
  });
  return requests;
}

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  vi.stubEnv('STORAGE_PROVIDER', 'azure');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('reports a rejected Twitch announcement to the scheduler', async () => {
  vi.useFakeTimers();
  platform(
    Response.json(
      { message: 'Announcement permission denied' },
      { status: 403 }
    )
  );
  const result = new TwitchProvider().post(
    '42',
    'token',
    [{ ...textPost, settings: { messageType: 'announcement' } }],
    integration
  );
  const failure = expect(result).rejects.toMatchObject({
    type: 'bad_body',
    message: 'Announcement permission denied',
  });
  await vi.advanceTimersByTimeAsync(2000);
  await failure;
});

const wpDomain = 'https://wp.example.test';
const wpChannel = {
  ...integration,
  token: Buffer.from(
    JSON.stringify({
      domain: wpDomain,
      username: 'editor',
      password: 'example',
    })
  ).toString('base64'),
};
const wpSettings = {
  title: 'Article',
  type: 'posts',
  main_image: { id: 'cover-1', path: cover },
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP478AAAAOBAUCnYaqpAAAAAElFTkSuQmCC',
  'base64'
);
const pngResponse = () =>
  new Response(png, { headers: { 'content-type': 'image/png' } });

it('publishes a WordPress article with a Blob image in HTML and the uploaded featured image ID', async () => {
  const requests = platform(
    pngResponse(),
    Response.json({ id: 81 }, { status: 201 }),
    Response.json({ id: 92, link: wpDomain + '/article' }, { status: 201 })
  );
  const result = await scheduled(
    new WordpressProvider(),
    html,
    wpSettings,
    wpChannel
  );
  expect(requests.map((req) => [req.method, req.url])).toEqual([
    ['GET', cover],
    ['POST', wpDomain + '/wp-json/wp/v2/media'],
    ['POST', wpDomain + '/wp-json/wp/v2/posts'],
  ]);
  expect(requests[0].headers.has('authorization')).toBe(false);
  expect(requests[1].headers.get('content-type')).toBe('image/png');
  expect(requests[1].headers.get('content-disposition')).toBe(
    'attachment; filename="cover.png"'
  );
  expect(Buffer.from(await requests[1].arrayBuffer())).toEqual(png);
  expect(await requests[2].json()).toMatchObject({
    content: html,
    featured_media: 81,
  });
  expect(result).toMatchObject([
    { status: 'completed', postId: '92', releaseURL: wpDomain + '/article' },
  ]);
});

it('returns a Medium publication refusal without downloading inline media', async () => {
  const requests = platform(
    Response.json(
      { errors: [{ message: 'Publication denied' }] },
      { status: 403 }
    )
  );
  await expect(
    scheduled(new MediumProvider(), markdown, { title: 'Article' })
  ).rejects.toMatchObject({
    type: 'bad_body',
    details: [
      expect.objectContaining({
        json: expect.stringContaining('Publication denied'),
      }),
    ],
  });
  expect(requests.map((req) => req.url)).toEqual([
    'https://api.medium.com/v1/users/42/posts',
  ]);
});

it('stops before creating the WordPress article when the featured image upload is refused', async () => {
  const requests = platform(
    pngResponse(),
    Response.json({ code: 'rest_upload_error' }, { status: 400 })
  );
  await expect(
    scheduled(new WordpressProvider(), html, wpSettings, wpChannel)
  ).rejects.toMatchObject({
    type: 'bad_body',
    details: [
      expect.objectContaining({
        json: expect.stringContaining('rest_upload_error'),
      }),
    ],
  });
  expect(requests.map((req) => req.url)).toEqual([
    cover,
    wpDomain + '/wp-json/wp/v2/media',
  ]);
});

it.each([
  ['server error', () => new Response('gateway error', { status: 500 })],
  ['incomplete success', () => new Response('{')],
  ['missing article ID', () => Response.json({ data: {} })],
] as const)(
  'leaves Medium creation unconfirmed after %s without sending another POST',
  async (_, response) => {
    const requests = platform(response());
    await expect(
      scheduled(new MediumProvider(), markdown, { title: 'Article' })
    ).rejects.toMatchObject({
      type: 'bad_body',
      details: [expect.objectContaining({ outcome: 'unconfirmed' })],
    });
    expect(requests.map((req) => req.method)).toEqual(['POST']);
  }
);

it('preserves the inline image in the Medium Markdown post', async () => {
  const requests = platform(
    Response.json(
      { data: { id: 'medium-1', url: 'https://medium.example.test/article' } },
      { status: 201 }
    )
  );
  const result = await scheduled(
    new MediumProvider(),
    '<p>' + markdown + '</p>',
    { title: 'Article' }
  );
  expect(requests.map((req) => [req.method, req.url])).toEqual([
    ['POST', 'https://api.medium.com/v1/users/42/posts'],
  ]);
  expect(await requests[0].json()).toMatchObject({
    contentFormat: 'markdown',
    content: markdown + '\n',
  });
  expect(result).toMatchObject([{ postId: 'medium-1', status: 'completed' }]);
});

it('sends the DEV.to Markdown body and optional cover URL in their own fields', async () => {
  const requests = platform(
    Response.json(
      { id: 73, url: 'https://dev.to/user/article' },
      { status: 201 }
    )
  );
  const result = await scheduled(
    new DevToProvider(),
    '<p>' + markdown + '</p>',
    wpSettings
  );
  expect(requests.map((req) => [req.method, req.url])).toEqual([
    ['POST', 'https://dev.to/api/articles'],
  ]);
  expect(await requests[0].json()).toMatchObject({
    article: { body_markdown: markdown + '\n', main_image: cover },
  });
  expect(result).toMatchObject([{ postId: '73', status: 'completed' }]);
});

const hashnodeSettings = {
  title: 'Article',
  tags: [],
  publication: 'publication-id',
  main_image: { path: cover },
};

it('preserves both absolute Blob URLs in the Hashnode publish mutation', async () => {
  const requests = platform(
    Response.json({
      data: {
        publishPost: {
          post: { id: 'hashnode-1', url: 'https://blog.example.test/article' },
        },
      },
    })
  );
  const result = await scheduled(
    new HashnodeProvider(),
    markdown,
    hashnodeSettings
  );
  expect(requests.map((req) => [req.method, req.url])).toEqual([
    ['POST', 'https://gql-beta.hashnode.com/'],
  ]);
  const { query } = await requests[0].json();
  expect(query).toMatch(/publishPost\s*\(/);
  expect(query).toContain('contentMarkdown: "' + markdown + '"');
  expect(query).toContain('coverImage: "' + cover + '"');
  expect(result).toMatchObject([{ postId: 'hashnode-1', status: 'completed' }]);
});

it('propagates a Hashnode mutation refusal without a media transfer', async () => {
  const requests = platform(
    Response.json({ data: null, errors: [{ message: 'Cover image refused' }] })
  );
  await expect(
    scheduled(new HashnodeProvider(), markdown, hashnodeSettings)
  ).rejects.toThrow('Cover image refused');
  expect(requests.map((req) => req.url)).toEqual([
    'https://gql-beta.hashnode.com/',
  ]);
});

it('preserves the DEV.to validation response when publishing fails', async () => {
  const requests = platform(
    Response.json({ error: 'Invalid main image' }, { status: 422 })
  );
  await expect(
    scheduled(new DevToProvider(), markdown, wpSettings)
  ).rejects.toMatchObject({
    type: 'bad_body',
    details: [
      expect.objectContaining({
        json: expect.stringContaining('Invalid main image'),
      }),
    ],
  });
  expect(requests.map((req) => req.url)).toEqual([
    'https://dev.to/api/articles',
  ]);
});

const listmonkDomain = 'https://mail.example.test';
const campaignSettings = {
  subject: 'Weekly issue',
  list: '2',
  preview: 'News',
};
function listmonkChannel() {
  vi.stubEnv('JWT_SECRET', 'test-listmonk');
  return {
    ...integration,
    customInstanceDetails: AuthService.fixedEncryption(
      JSON.stringify({
        url: listmonkDomain,
        username: 'editor',
        password: 'example',
      })
    ),
  };
}

it('starts a Listmonk HTML campaign with an image a recipient can fetch anonymously', async () => {
  const requests = platform(
    Response.json({ data: { uuid: 'campaign-uuid', id: 12 } }),
    Response.json({}),
    pngResponse()
  );
  const result = await scheduled(
    new ListmonkProvider(),
    html,
    campaignSettings,
    listmonkChannel()
  );
  expect(requests.map((req) => [req.method, req.url])).toEqual([
    ['POST', listmonkDomain + '/api/campaigns'],
    ['PUT', listmonkDomain + '/api/campaigns/12/status'],
  ]);
  const campaign = await requests[0].json();
  expect(campaign.content_type).toBe('html');
  expect(campaign.body).toContain(html);
  const [, src] = campaign.body.match(/<img src="([^"]+)"/);
  expect(src).toBe(bodyImage);
  expect(await requests[1].json()).toEqual({ status: 'running' });
  expect(result).toMatchObject([
    { status: 'completed', postId: 'campaign-uuid' },
  ]);
  const publicImage = await fetch(src);
  expect(requests[2].headers.has('authorization')).toBe(false);
  expect(Buffer.from(await publicImage.arrayBuffer())).toEqual(png);
});

it('stops sending a Listmonk campaign after a validation refusal', async () => {
  const requests = platform(
    Response.json({ message: 'Invalid list' }, { status: 400 })
  );
  await expect(
    scheduled(new ListmonkProvider(), html, campaignSettings, listmonkChannel())
  ).rejects.toMatchObject({
    type: 'bad_body',
    details: [
      expect.objectContaining({
        json: expect.stringContaining('Invalid list'),
      }),
    ],
  });
  expect(requests.map((req) => req.url)).toEqual([
    listmonkDomain + '/api/campaigns',
  ]);
});

it('posts a Kick chat message and replies to the prior message using only text', async () => {
  const requests = platform(
    Response.json({ data: { message_id: 'kick-1', is_sent: true } }),
    Response.json({ data: { message_id: 'kick-2', is_sent: true } })
  );
  const provider = new KickProvider();
  const [main] = await provider.post('42', 'token', [textPost], integration);
  const [reply] = await provider.comment(
    '42',
    main.postId,
    'kick-prior',
    'token',
    [{ ...textPost, message: 'Following up' }],
    integration
  );
  expect(requests.map((req) => [req.method, req.url])).toEqual(
    Array(2).fill(['POST', 'https://api.kick.com/public/v1/chat'])
  );
  expect(await requests[0].json()).toEqual({
    type: 'user',
    content: 'Hello channel',
    broadcaster_user_id: 42,
  });
  expect(await requests[1].json()).toEqual({
    type: 'user',
    content: 'Following up',
    broadcaster_user_id: 42,
    reply_to_message_id: 'kick-prior',
  });
  expect([main, reply]).toMatchObject([
    { postId: 'kick-1', status: 'posted' },
    { postId: 'kick-2', status: 'posted' },
  ]);
});

it('propagates a Kick chat refusal', async () => {
  const requests = platform(
    Response.json({ message: 'Chat forbidden' }, { status: 403 })
  );
  await expect(
    new KickProvider().post('42', 'token', [textPost], integration)
  ).rejects.toMatchObject({
    type: 'bad_body',
    details: [
      expect.objectContaining({
        json: expect.stringContaining('Chat forbidden'),
      }),
    ],
  });
  expect(requests.map((req) => req.url)).toEqual([
    'https://api.kick.com/public/v1/chat',
  ]);
});

it('sends Twitch chat messages, replies and announcements without fetching attachments', async () => {
  vi.useFakeTimers();
  const requests = platform(
    Response.json({ data: [{ message_id: 'chat-1', is_sent: true }] }),
    Response.json({ data: [{ message_id: 'chat-2', is_sent: true }] }),
    new Response(null, { status: 204 })
  );
  const provider = new TwitchProvider();
  const first = provider.post('42', 'token', [textPost], integration);
  await vi.advanceTimersByTimeAsync(2000);
  const [main] = await first;
  const second = provider.comment(
    '42',
    main.postId,
    undefined,
    'token',
    [{ ...textPost, message: 'Reply' }],
    integration
  );
  await vi.advanceTimersByTimeAsync(2000);
  const [reply] = await second;
  const third = provider.post(
    '42',
    'token',
    [
      {
        ...textPost,
        message: 'Stream started',
        settings: { messageType: 'announcement', announcementColor: 'blue' },
      },
    ],
    integration
  );
  await vi.advanceTimersByTimeAsync(2000);
  expect(await third).toMatchObject([{ status: 'posted' }]);
  const api = 'https://api.twitch.tv/helix/chat/';
  expect(requests.map((req) => [req.method, req.url])).toEqual([
    ['POST', api + 'messages'],
    ['POST', api + 'messages'],
    ['POST', api + 'announcements?broadcaster_id=42&moderator_id=42'],
  ]);
  expect(await requests[0].json()).toEqual({
    broadcaster_id: '42',
    sender_id: '42',
    message: 'Hello channel',
  });
  expect(await requests[1].json()).toEqual({
    broadcaster_id: '42',
    sender_id: '42',
    message: 'Reply',
    reply_parent_message_id: 'chat-1',
  });
  expect(await requests[2].json()).toEqual({
    message: 'Stream started',
    color: 'blue',
  });
  expect([main, reply]).toMatchObject([
    { postId: 'chat-1', status: 'posted' },
    { postId: 'chat-2', status: 'posted' },
  ]);
});

it('sends Moltbook posts and replies as text and propagates refused submissions', async () => {
  const fetchRequests = platform();
  const client = getSsrfSafeAxios();
  const adapter = client.defaults.adapter;
  const requests: { url: string; body: unknown; method: string }[] = [];
  const responses = [
    { success: true, post: { id: 'molt-1' } },
    { success: true, comment: { id: 'molt-2' } },
    { success: false, error: 'Unknown submolt' },
  ];
  client.defaults.adapter = async (config) => {
    requests.push({
      url: config.url!,
      body: JSON.parse(config.data),
      method: config.method!,
    });
    return {
      config,
      data: responses.shift(),
      headers: {},
      status: 200,
      statusText: 'OK',
    };
  };
  try {
    const provider = new MoltbookProvider();
    const [main] = await provider.post('42', 'token', [textPost], integration);
    const [reply] = await provider.comment(
      '42',
      main.postId,
      'prior',
      'token',
      [{ ...textPost, message: 'Reply' }],
      integration
    );
    await expect(
      provider.post(
        '42',
        'token',
        [{ ...textPost, settings: { submolt: 'unknown' } }],
        integration
      )
    ).rejects.toThrow('Unknown submolt');
    const url = 'https://www.moltbook.com/api/v1/posts';
    expect(requests).toEqual([
      {
        url,
        method: 'post',
        body: {
          submolt: 'general',
          title: 'Hello channel',
          content: 'Hello channel',
        },
      },
      {
        url: url + '/molt-1/comments',
        method: 'post',
        body: { content: 'Reply', parent_id: 'prior' },
      },
      {
        url,
        method: 'post',
        body: {
          submolt: 'unknown',
          title: 'Hello channel',
          content: 'Hello channel',
        },
      },
    ]);
    expect(fetchRequests).toHaveLength(0);
    expect([main, reply]).toMatchObject([
      { postId: 'molt-1', status: 'completed' },
      { postId: 'molt-2', status: 'completed' },
    ]);
  } finally {
    client.defaults.adapter = adapter;
  }
});
