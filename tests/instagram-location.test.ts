import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

type Call = { url: string; method: string };

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const provider = () => new InstagramProvider();

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

/**
 * Ticket 12: an Instagram location is a Facebook Page that has location data.
 *
 * The DTO shape, the Pages Search call and the payload placement are all
 * observed from the outside: validation results and the URLs the provider
 * really sends.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('InstagramDto location field', () => {
  it('accepts a location with an id, a name and an optional address', async () => {
    const dto = plainToInstance(InstagramDto, {
      post_type: 'post',
      location: {
        id: '102938475610293',
        name: 'Test Place',
        address: '1 Main St, Springfield, IL, USA',
      },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts a location without an address', async () => {
    const dto = plainToInstance(InstagramDto, {
      post_type: 'post',
      location: { id: '102938475610293', name: 'Test Place' },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a location without an id or a name', async () => {
    const dto = plainToInstance(InstagramDto, {
      post_type: 'post',
      location: { address: '1 Main St' },
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('location');
  });

  it('rejects a numeric Page id when validating raw settings', async () => {
    const dto = plainToInstance(InstagramDto, {
      post_type: 'post',
      location: { id: 102938475610293, name: 'Test Place' },
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('location');
  });
});

describe('Instagram location search at the platform boundary', () => {
  const search = async (body: unknown, status = 200) => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any, init?: any) => {
        calls.push({ url: String(input), method: init?.method || 'GET' });
        return respond(body, status);
      })
    );

    const result = await provider().locationSearch(
      'page-token___user-token',
      { q: 'coffee shop' }
    );

    return { calls, result };
  };

  it('searches Facebook Pages with the user token and the fields needed for a location', async () => {
    const { calls, result } = await search({ data: [] });
    expect(result).toEqual([]);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin).toBe('https://graph.facebook.com');
    expect(url.pathname).toBe(`/${META_GRAPH_API_VERSION}/pages/search`);
    expect(url.searchParams.get('q')).toBe('coffee shop');
    expect(url.searchParams.get('fields')).toBe('id,name,location,link');
    expect(url.searchParams.get('access_token')).toBe('user-token');
    expect(calls[0].method).toBe('GET');
  });

  it('falls back to the page token when the token has no user part', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        calls.push({ url: String(input), method: 'GET' });
        return respond({ data: [] });
      })
    );

    await provider().locationSearch('standalone-token', { q: 'coffee' });

    expect(new URL(calls[0].url).searchParams.get('access_token')).toBe(
      'standalone-token'
    );
  });

  it('does not call Facebook for an empty query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(provider().locationSearch('page-token___user-token', { q: '' })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps only Pages that have location data and builds a readable address', async () => {
    const { result } = await search({
      data: [
        { id: 11, name: 'No location field' },
        { id: 12, name: 'Null location', location: null },
        { id: 13, name: 'Empty location', location: {} },
        {
          id: 102938475610293,
          name: 'Test Place',
          location: {
            street: '1 Main St',
            city: 'Springfield',
            state: 'IL',
            country: 'USA',
          },
        },
        {
          id: 15,
          name: 'City only',
          location: { city: 'Springfield' },
        },
      ],
    });

    expect(result).toEqual([
      {
        id: '102938475610293',
        name: 'Test Place',
        address: '1 Main St, Springfield, IL, USA',
      },
      { id: '15', name: 'City only', address: 'Springfield' },
    ]);
  });

  it('returns at most 20 results', async () => {
    const { result } = await search({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        name: `Place ${index + 1}`,
        location: { city: 'Springfield' },
      })),
    });

    expect(result).toHaveLength(20);
    expect(result[0].id).toBe('1');
    expect(result[19].id).toBe('20');
  });

  it('propagates a refresh-token failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond({ error: { message: 'REVOKED_ACCESS_TOKEN', code: 190 } }, 401)
      )
    );

    await expect(
      provider().locationSearch('page-token___user-token', { q: 'coffee' })
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('throws a refresh-token for a 200 Graph error envelope that means the token is dead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond({ error: { message: 'REVOKED_ACCESS_TOKEN', code: 190 } })
      )
    );

    await expect(
      provider().locationSearch('page-token___user-token', { q: 'coffee' })
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it.each([
    ['a Graph error envelope', { error: { message: 'Unsupported get request', code: 100 } }, 200],
    ['a Graph rate limit envelope', { error: { message: 'Too many calls', code: 32 } }, 200],
    ['a plain failure', { message: 'nope' }, 400],
  ])('returns an empty list for %s', async (_label, body, status) => {
    const { result } = await search(body, status);
    expect(result).toEqual([]);
  });
});

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
  calls.filter((call) => call.method === 'POST' && call.url.includes('/media?'));

const locationFlag = (url: string) =>
  new URL(url).searchParams.get('location_id');

const place = {
  id: '102938475610293',
  name: 'Test Place',
  address: '1 Main St, Springfield, IL, USA',
};

describe('Instagram location payload placement', () => {
  it.each(['102938475610293', 'Page & Café #1'])('sends the whole location ID %s on a single image', async (id) => {
    const location = { ...place, id };
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', location }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('https://graph.facebook.com/');
    expect(locationFlag(create.url)).toBe(id);
  });

  it('sends location_id on a single Facebook Login video/Reel container', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', location: place }, [
          'https://media.invalid/clip.mp4',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('media_type=REELS');
    expect(locationFlag(create.url)).toBe(place.id);
  });

  it.each(['102938475610293', 'Page & Café #1'])('sends the whole location ID %s only on the carousel parent', async (id) => {
    const location = { ...place, id };
    const calls = platform();
    const provider = new InstagramProvider();

    const [pending] = await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post', location }, [
          'https://media.invalid/one.jpg',
          'https://media.invalid/two.jpg',
        ]),
      ],
      integration('instagram')
    );

    const children = containerCreates(calls);
    expect(children).toHaveLength(2);
    expect(children.every((call) => locationFlag(call.url) === null)).toBe(true);

    calls.length = 0;
    await provider.finalizePost(
      'page-token___user-token',
      pending.pendingData as any,
      integration('instagram')
    );

    const [parent] = containerCreates(calls);
    expect(parent.url).toContain('media_type=CAROUSEL');
    expect(locationFlag(parent.url)).toBe(id);
  });

  it('never sends location_id on a Story, even when the setting is kept', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'story', location: place }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('media_type=STORIES');
    expect(locationFlag(create.url)).toBeNull();
  });

  it('never sends location_id with Instagram Standalone', async () => {
    const calls = platform();
    const provider = new InstagramStandaloneProvider();

    await provider.postPending(
      'ig-1',
      'standalone-token',
      [
        post({ post_type: 'post', location: place }, [
          'https://media.invalid/photo.jpg',
        ]),
      ],
      integration('instagram-standalone')
    );

    const [create] = containerCreates(calls);
    expect(create.url).toContain('https://graph.instagram.com/');
    expect(locationFlag(create.url)).toBeNull();
  });

  it('never sends location_id on an Instagram Standalone carousel parent', async () => {
    const calls = platform();
    const provider = new InstagramStandaloneProvider();

    const [pending] = await provider.postPending(
      'ig-1',
      'standalone-token',
      [
        post({ post_type: 'post', location: place }, [
          'https://media.invalid/one.jpg',
          'https://media.invalid/two.jpg',
        ]),
      ],
      integration('instagram-standalone')
    );

    calls.length = 0;
    await provider.finalizePost(
      'standalone-token',
      pending.pendingData as any,
      integration('instagram-standalone')
    );

    const [parent] = containerCreates(calls);
    expect(parent.url).toContain('https://graph.instagram.com/');
    expect(parent.url).toContain('media_type=CAROUSEL');
    expect(locationFlag(parent.url)).toBeNull();
  });

  it('omits location_id when no location was selected', async () => {
    const calls = platform();
    const provider = new InstagramProvider();

    await provider.postPending(
      'ig-1',
      'page-token___user-token',
      [
        post({ post_type: 'post' }, ['https://media.invalid/photo.jpg']),
      ],
      integration('instagram')
    );

    const [create] = containerCreates(calls);
    expect(locationFlag(create.url)).toBeNull();
  });

  it('keeps Story and carousel combinations with a location structurally valid', async () => {
    const provider = new InstagramProvider();

    await expect(
      provider.checkValidity([[{ path: 'https://media.invalid/photo.jpg' }]], {
        post_type: 'story',
        location: place,
      })
    ).resolves.toBe(true);

    await expect(
      provider.checkValidity(
        [
          [
            { path: 'https://media.invalid/one.jpg' },
            { path: 'https://media.invalid/two.jpg' },
          ],
        ],
        { post_type: 'post', location: place }
      )
    ).resolves.toBe(true);
  });

  it('keeps an Instagram Standalone post with a location structurally valid', async () => {
    const provider = new InstagramStandaloneProvider();

    await expect(
      provider.checkValidity([[{ path: 'https://media.invalid/photo.jpg' }]], {
        post_type: 'post',
        location: place,
      })
    ).resolves.toBe(true);
  });
});

describe('Instagram invalid location error', () => {
  const message =
    'The selected Page has no valid location data, please choose another location';

  it('classifies INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID as a readable bad body', () => {
    const result = new InstagramProvider().handleErrors(
      JSON.stringify({
        error: {
          message: 'An unknown error occurred',
          error_user_msg: 'INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID',
        },
      }),
      400
    );

    expect(result).toEqual({ type: 'bad-body', value: message });
  });

  it('rejects postPending with a non-retryable bad body when the location is invalid', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return respond(
          {
            error: {
              message: 'INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID',
            },
          },
          400
        );
      })
    );

    let error: any;
    try {
      await new InstagramProvider().postPending(
        'ig-1',
        'page-token___user-token',
        [
          post({ post_type: 'post', location: place }, [
            'https://media.invalid/photo.jpg',
          ]),
        ],
        integration('instagram')
      );
    } catch (err) {
      error = err;
    }

    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(BadBody);
    expect(error.message).toBe(message);
    expect(error.type).toBe('bad_body');
  });
});
