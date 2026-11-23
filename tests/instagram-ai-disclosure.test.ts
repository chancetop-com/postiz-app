import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';

/**
 * Ticket 09: the "Made with AI" value travels to the Instagram media container.
 *
 * Only a true value is sent. It goes on the single media container (image,
 * video/Reel) and on the carousel parent container, never on carousel children
 * and never on Stories. Instagram Standalone delegates to the same provider, so
 * it has to behave identically on its own Graph host.
 *
 * The assertions are made against the URLs the provider really sends; no
 * provider internals are named.
 */

type Call = { url: string; method: string };

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const platform = () => {
  const calls: Call[] = [];
  let containerId = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url, method: init?.method || 'GET' });
      if (url.includes('/media_publish?')) {
        return respond({ id: 'published-media-1' });
      }
      if (init?.method === 'POST' && url.includes('/media?')) {
        return respond({ id: `container-${++containerId}` });
      }
      if (url.includes('fields=status_code')) {
        return respond({ status_code: 'FINISHED' });
      }
      if (url.includes('fields=permalink')) {
        return respond({ permalink: 'https://www.instagram.com/p/test' });
      }
      throw new Error(`Unexpected Graph request: ${init?.method || 'GET'} ${url}`);
    })
  );
  return calls;
};

const integration = (identifier: string) =>
  ({
    id: 'integration-1',
    organizationId: 'org-1',
    internalId: 'ig-1',
    providerIdentifier: identifier,
    profile: 'synthetic-profile',
    token: 'page-token___user-token',
  } as any);

const post = (settings: Record<string, unknown>, media: string[]) =>
  ({
    id: 'post-1',
    message: 'caption',
    settings,
    media: media.map((path) => ({ path })),
  } as any);

const containerCreates = (calls: Call[]) =>
  calls.filter(
    (call) => call.method === 'POST' && call.url.includes('/media?')
  );

const aiFlag = (url: string) =>
  new URL(url).searchParams.get('is_ai_generated');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Instagram AI disclosure at the platform boundary', () => {
  it('labels a single Facebook Login image container', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', is_ai_generated: true }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('https://graph.facebook.com/');
    expect(aiFlag(create.url)).toBe('true');
  });

  it('labels a single Facebook Login video/Reel container', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', is_ai_generated: true }, [
          'https://media.invalid/clip.mp4',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('media_type=REELS');
    expect(aiFlag(create.url)).toBe('true');
  });

  it('keeps the AI flag off carousel children and puts it on the parent container', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    const [pending] = await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', is_ai_generated: true }, [
          'https://media.invalid/one.jpg',
          'https://media.invalid/two.jpg',
        ]),
      ],
      integration('instagram')
    );

    const children = containerCreates(calls);
    expect(children).toHaveLength(2);
    expect(children.every((call) => aiFlag(call.url) === null)).toBe(true);

    calls.length = 0;
    await provider.finalizePost(
      'page-token___user-token',
      pending.pendingData as any,
      integration('instagram')
    );

    const [parent] = containerCreates(calls);
    expect(parent.url).toContain('media_type=CAROUSEL');
    expect(new URL(parent.url).searchParams.get('children')).toBe('container-1,container-2');
    expect(aiFlag(parent.url)).toBe('true');
  });

  it('omits the AI flag from the carousel parent when it was not selected', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    const [pending] = await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post' }, [
          'https://media.invalid/one.jpg',
          'https://media.invalid/two.jpg',
        ]),
      ],
      integration('instagram')
    );

    calls.length = 0;
    await provider.finalizePost(
      'page-token___user-token',
      pending.pendingData as any,
      integration('instagram')
    );

    const [parent] = containerCreates(calls);
    expect(parent.url).toContain('media_type=CAROUSEL');
    expect(aiFlag(parent.url)).toBeNull();
  });

  it('never sends the AI flag on a Story, even when the setting is kept', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'story', is_ai_generated: true }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('media_type=STORIES');
    expect(aiFlag(create.url)).toBeNull();
  });

  it('keeps Story + AI structurally valid', async () => {
    const provider = new InstagramProvider();

    await expect(
      provider.checkValidity([[{ path: 'https://media.invalid/photo.jpg' }]], {
        post_type: 'story',
        is_ai_generated: true,
      })
    ).resolves.toBe(true);
  });

  it('omits the AI flag on a single image when is_ai_generated is false', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', is_ai_generated: false }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(aiFlag(create.url)).toBeNull();
  });

  it('omits the AI flag on a single image when is_ai_generated is missing', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [post({ post_type: 'post' }, ['https://media.invalid/photo.jpg'])],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(aiFlag(create.url)).toBeNull();
  });

  it('labels a single Instagram Standalone image on the Instagram Graph host', async () => {
    const calls = platform();
    const provider = new InstagramStandaloneProvider();

    await provider.postPending(
      'ig-1',
      'standalone-token',
      [
        post({ post_type: 'post', is_ai_generated: true }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram-standalone')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('https://graph.instagram.com/');
    expect(aiFlag(create.url)).toBe('true');
  });

  it('labels a single Instagram Standalone video/Reel on the Instagram Graph host', async () => {
    const calls = platform();
    const provider = new InstagramStandaloneProvider();

    await provider.postPending(
      'ig-1',
      'standalone-token',
      [
        post({ post_type: 'post', is_ai_generated: true }, [
          'https://media.invalid/clip.mp4',
        ]),
      ],
      integration('instagram-standalone')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('https://graph.instagram.com/');
    expect(create.url).toContain('media_type=REELS');
    expect(aiFlag(create.url)).toBe('true');
  });

  it('labels an Instagram Standalone carousel parent, not its children', async () => {
    const calls = platform();
    const provider = new InstagramStandaloneProvider();

    const [pending] = await provider.postPending(
      'ig-1',
      'standalone-token',
      [
        post({ post_type: 'post', is_ai_generated: true }, [
          'https://media.invalid/one.jpg',
          'https://media.invalid/two.jpg',
        ]),
      ],
      integration('instagram-standalone')
    );

    const children = containerCreates(calls);
    expect(children).toHaveLength(2);
    expect(children.every((call) => aiFlag(call.url) === null)).toBe(true);

    calls.length = 0;
    await provider.finalizePost(
      'standalone-token',
      pending.pendingData as any,
      integration('instagram-standalone')
    );

    const [parent] = containerCreates(calls);
    expect(parent.url).toContain('https://graph.instagram.com/');
    expect(parent.url).toContain('media_type=CAROUSEL');
    expect(new URL(parent.url).searchParams.get('children')).toBe('container-1,container-2');
    expect(aiFlag(parent.url)).toBe('true');
  });
});
