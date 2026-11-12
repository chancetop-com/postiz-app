import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';

/**
 * Ticket 08: the picked account or page is what gets written.
 *
 * The frontend chooser is only half of the contract. Here the real providers
 * turn the selected id into a platform identity (the platform HTTP call is the
 * only double), the real service validates the pending integration and the real
 * repository writes the row. The assertions are on the stored row, not on the
 * chooser: which account was bound, with which token, in which organisation.
 */

const google = vi.hoisted(() => ({
  channels: vi.fn(),
}));

vi.mock('googleapis', () => {
  const OAuth2 = function () {
    return { setCredentials: () => undefined };
  };
  return {
    google: {
      auth: { OAuth2 },
      youtube: () => ({ channels: { list: google.channels } }),
    },
  };
});

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

interface Row {
  id: string;
  organizationId: string;
  providerIdentifier: string;
  internalId: string;
  rootInternalId?: string;
  token: string;
  refreshToken?: string;
  tokenExpiration?: Date;
  name: string;
  profile?: string;
  picture?: string;
  inBetweenSteps: boolean;
  deletedAt: Date | null;
  disabled?: boolean;
  refreshNeeded?: boolean;
  [key: string]: unknown;
}

const matches = (row: Row, where: any): boolean =>
  Object.entries(where || {}).every(([key, expected]: [string, any]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('not' in expected) {
        return expected.not === null ? actual !== null : actual !== expected.not;
      }
      if ('in' in expected) {
        return expected.in.includes(actual);
      }
      if ('equals' in expected) {
        return actual === expected.equals;
      }
    }
    return actual === expected;
  });

/**
 * The ORM boundary: an in-memory `integration` table exposing only the calls
 * this write path uses, plus the post soft-delete it performs alongside.
 */
const memoryDb = (seed: Partial<Row>[] = []) => {
  let sequence = 0;
  const rows: Row[] = seed.map((row) => ({
    id: row.id || `row-${++sequence}`,
    organizationId: row.organizationId || 'org-1',
    providerIdentifier: row.providerIdentifier || 'youtube',
    internalId: row.internalId || 'pending',
    token: row.token || 'token',
    name: row.name || 'pending',
    inBetweenSteps: row.inBetweenSteps ?? true,
    deletedAt: row.deletedAt ?? null,
    ...row,
  })) as Row[];

  const integration = {
    findFirst: async ({ where }: any) =>
      rows.find((row) => matches(row, where)) || null,
    findUnique: async ({ where }: any) => {
      if (where.id) {
        return rows.find((row) => row.id === where.id) || null;
      }
      const key = where.organizationId_internalId;
      return (
        rows.find(
          (row) =>
            row.organizationId === key.organizationId &&
            row.internalId === key.internalId
        ) || null
      );
    },
    findMany: async ({ where }: any) => rows.filter((row) => matches(row, where)),
    update: async ({ where, data }: any) => {
      const row = rows.find((current) => current.id === where.id);
      if (!row) {
        throw new Error('row not found');
      }
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const found = rows.filter((row) => matches(row, where));
      found.forEach((row) => Object.assign(row, data));
      return { count: found.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.organizationId_internalId;
      const existing = rows.find(
        (row) =>
          row.organizationId === key.organizationId &&
          row.internalId === key.internalId
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const created = {
        id: `row-${++sequence}`,
        deletedAt: null,
        ...create,
      } as Row;
      rows.push(created);
      return created;
    },
  };

  const posts = {
    updateMany: vi.fn(async () => ({ count: 0 })),
  };

  return { rows, integration, posts };
};

const service = (db: ReturnType<typeof memoryDb>) =>
  new IntegrationService(
    new IntegrationRepository(
      { model: { integration: db.integration } } as any,
      { model: { post: db.posts } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ),
    {} as any,
    new IntegrationManager(),
    {} as any,
    {} as any,
    {} as any
  );

const platformFetch = (handlers: Array<[RegExp, unknown]>) => {
  const fetchMock = vi.fn(async (url: string) => {
    const handler = handlers.find(([pattern]) => pattern.test(url));
    if (!handler) {
      throw new Error(`unexpected platform call ${url}`);
    }
    return new Response(JSON.stringify(handler[1]), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  google.channels.mockReset();
  // The repository uploads pictures that do not already live on the CDN host.
  // Both hosts share the sentinel so platform doubles stay off the network.
  process.env.FRONTEND_URL = 'https://postiz.test';
  process.env.CLOUDFLARE_BUCKET_URL = 'https://postiz.test';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.FRONTEND_URL;
  delete process.env.CLOUDFLARE_BUCKET_URL;
});

describe('YouTube', () => {
  it('binds the picked channel instead of the first one in the list', async () => {
    google.channels.mockResolvedValue({
      data: {
        items: [
          {
            id: 'channel-2',
            snippet: {
              title: 'Second channel',
              customUrl: '@second',
              thumbnails: { default: { url: 'https://postiz.test/yt-2.png' } },
            },
          },
        ],
      },
    });
    const db = memoryDb([
      { id: 'integration-1', providerIdentifier: 'youtube', token: 'yt-user' },
    ]);

    await service(db).saveProviderPage('org-1', 'integration-1', {
      id: 'channel-2',
    });

    expect(google.channels.mock.calls[0][0].id).toEqual(['channel-2']);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      id: 'integration-1',
      organizationId: 'org-1',
      providerIdentifier: 'youtube',
      internalId: 'channel-2',
      name: 'Second channel',
      profile: '@second',
      picture: 'https://postiz.test/yt-2.png',
      // the OAuth token, not a page token
      token: 'yt-user',
      inBetweenSteps: false,
    });
  });
});

describe('Facebook Page', () => {
  const pages = (pages: any[]) => [
    [/me\/accounts/, { data: pages }],
  ];

  it('binds the picked page with that page token', async () => {
    const fetchMock = platformFetch(
      pages([
        {
          id: 'page-1',
          name: 'Shop page',
          username: 'shop',
          access_token: 'token-page-1',
          picture: { data: { url: 'https://postiz.test/page-1.png' } },
        },
        {
          id: 'page-2',
          name: 'Brand page',
          username: 'brandpage',
          access_token: 'token-page-2',
          picture: { data: { url: 'https://postiz.test/page-2.png' } },
        },
      ])
    );
    const db = memoryDb([
      { id: 'integration-1', providerIdentifier: 'facebook', token: 'fb-user' },
    ]);

    await service(db).saveProviderPage('org-1', 'integration-1', {
      page: 'page-2',
    });

    // the listing is read with the OAuth user token…
    expect(String(fetchMock.mock.calls[0][0])).toContain('access_token=fb-user');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      internalId: 'page-2',
      name: 'Brand page',
      profile: 'brandpage',
      picture: 'https://postiz.test/page-2.png',
      token: 'token-page-2',
      inBetweenSteps: false,
    });
  });

  it('leaves a different existing binding in the same organisation alone', async () => {
    platformFetch(
      pages([
        {
          id: 'page-2',
          name: 'Brand page',
          username: 'brandpage',
          access_token: 'token-page-2',
          picture: { data: { url: 'https://postiz.test/page-2.png' } },
        },
      ])
    );
    const db = memoryDb([
      {
        id: 'existing-page-1',
        organizationId: 'org-1',
        providerIdentifier: 'facebook',
        internalId: 'page-1',
        name: 'Shop page',
        token: 'token-page-1',
        inBetweenSteps: false,
      },
      { id: 'integration-1', providerIdentifier: 'facebook', token: 'fb-user' },
    ]);

    await service(db).saveProviderPage('org-1', 'integration-1', {
      page: 'page-2',
    });

    const untouched = db.rows.find((row) => row.id === 'existing-page-1');
    expect(untouched).toMatchObject({
      internalId: 'page-1',
      token: 'token-page-1',
      deletedAt: null,
    });
    expect(
      db.rows.filter((row) => row.internalId === 'page-2' && !row.deletedAt)
    ).toHaveLength(1);
  });

  it('reuses the existing row when the same page is bound again', async () => {
    platformFetch(
      pages([
        {
          id: 'page-1',
          name: 'Shop page',
          username: 'shop',
          access_token: 'token-page-1-fresh',
          picture: { data: { url: 'https://postiz.test/page-1.png' } },
        },
      ])
    );
    const db = memoryDb([
      {
        id: 'existing-page-1',
        organizationId: 'org-1',
        providerIdentifier: 'facebook',
        internalId: 'page-1',
        name: 'Shop page',
        token: 'token-page-1-old',
        inBetweenSteps: false,
      },
      { id: 'integration-1', providerIdentifier: 'facebook', token: 'fb-user' },
    ]);

    await service(db).saveProviderPage('org-1', 'integration-1', {
      page: 'page-1',
    });

    const live = db.rows.filter((row) => row.deletedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      id: 'existing-page-1',
      internalId: 'page-1',
      token: 'token-page-1-fresh',
      inBetweenSteps: false,
    });
  });
});

describe('Instagram (Facebook Business)', () => {
  it('binds the picked Instagram account on top of its page token', async () => {
    const fetchMock = platformFetch([
      [
        /\/page-2\?/,
        {
          access_token: 'page-2-token',
          name: 'Brand page',
          picture: { data: { url: 'https://postiz.test/page-2.png' } },
        },
      ],
      [
        /\/ig-2\?/,
        {
          id: 'ig-2',
          username: 'brand_ig',
          name: 'Brand IG',
          profile_picture_url: 'https://postiz.test/ig-2.png',
        },
      ],
    ]);
    const db = memoryDb([
      {
        id: 'integration-1',
        providerIdentifier: 'instagram',
        token: 'user-token',
      },
    ]);

    await service(db).saveProviderPage('org-1', 'integration-1', {
      id: 'ig-2',
      pageId: 'page-2',
    });

    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes('/page-2?'))).toBe(true);
    expect(requested.some((url) => url.includes('/ig-2?'))).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      internalId: 'ig-2',
      name: 'Brand IG',
      profile: 'brand_ig',
      picture: 'https://postiz.test/ig-2.png',
      // the page token comes from the picked page, the user token stays
      token: 'page-2-token___user-token',
      inBetweenSteps: false,
    });
  });

  it('does not write another organisation’s row', async () => {
    platformFetch([
      [
        /\/page-2\?/,
        {
          access_token: 'page-2-token',
          name: 'Brand page',
          picture: { data: { url: 'https://postiz.test/page-2.png' } },
        },
      ],
      [
        /\/ig-2\?/,
        {
          id: 'ig-2',
          username: 'brand_ig',
          name: 'Brand IG',
          profile_picture_url: 'https://postiz.test/ig-2.png',
        },
      ],
    ]);
    const db = memoryDb([
      {
        id: 'integration-1',
        organizationId: 'org-1',
        providerIdentifier: 'instagram',
        token: 'user-token',
      },
      {
        id: 'other-org-row',
        organizationId: 'org-2',
        providerIdentifier: 'instagram',
        internalId: 'ig-9',
        name: 'Other org account',
        token: 'other-token',
        inBetweenSteps: false,
      },
    ]);

    await service(db).saveProviderPage('org-1', 'integration-1', {
      id: 'ig-2',
      pageId: 'page-2',
    });

    expect(db.rows.find((row) => row.id === 'other-org-row')).toMatchObject({
      organizationId: 'org-2',
      internalId: 'ig-9',
      token: 'other-token',
      deletedAt: null,
    });
  });
});

describe('the save refuses anything that is not a pending selection', () => {
  it('rejects a selection for another organisation', async () => {
    const db = memoryDb([
      {
        id: 'integration-1',
        organizationId: 'org-1',
        providerIdentifier: 'youtube',
        token: 'yt-user',
      },
    ]);

    await expect(
      service(db).saveProviderPage('org-2', 'integration-1', {
        id: 'channel-2',
      })
    ).rejects.toThrow(HttpException);
    expect(google.channels).not.toHaveBeenCalled();
    expect(db.rows[0].inBetweenSteps).toBe(true);
  });

  it('rejects an integration that is already bound', async () => {
    const db = memoryDb([
      {
        id: 'integration-1',
        providerIdentifier: 'youtube',
        internalId: 'channel-1',
        token: 'yt-user',
        inBetweenSteps: false,
      },
    ]);

    await expect(
      service(db).saveProviderPage('org-1', 'integration-1', {
        id: 'channel-2',
      })
    ).rejects.toThrow('Invalid request');
    expect(google.channels).not.toHaveBeenCalled();
  });

  it('rejects an unknown integration', async () => {
    const db = memoryDb([]);

    await expect(
      service(db).saveProviderPage('org-1', 'missing', { id: 'channel-2' })
    ).rejects.toThrow('Integration not found');
  });

  it('rejects a provider that cannot resolve a page, and writes nothing', async () => {
    const db = memoryDb([
      { id: 'integration-1', providerIdentifier: 'bluesky', token: 'bsky' },
    ]);

    await expect(
      service(db).saveProviderPage('org-1', 'integration-1', {
        id: 'channel-2',
      })
    ).rejects.toThrow('Provider does not support page selection');
    expect(db.rows[0]).toMatchObject({
      providerIdentifier: 'bluesky',
      inBetweenSteps: true,
    });
  });

  it('propagates a platform refusal without touching the row', async () => {
    platformFetch([
      [
        /me\/accounts/,
        // the page is listed without a token: the user lost page access
        {
          data: [
            {
              id: 'page-2',
              name: 'Brand page',
              picture: { data: { url: 'https://postiz.test/page-2.png' } },
            },
          ],
        },
      ],
      [/me\/businesses/, { data: [] }],
    ]);
    const db = memoryDb([
      {
        id: 'integration-1',
        providerIdentifier: 'facebook',
        token: 'fb-user',
      },
    ]);

    await expect(
      service(db).saveProviderPage('org-1', 'integration-1', {
        page: 'page-2',
      })
    ).rejects.toThrow('no permission to manage this page');
    expect(db.rows[0]).toMatchObject({
      providerIdentifier: 'facebook',
      inBetweenSteps: true,
      internalId: 'pending',
    });
  });
});
