import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { SkoolProvider } from '@gitroom/nestjs-libraries/integrations/social/skool.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Ticket 09: already-bound channels keep working after the merge.
 *
 * The real database is not available here, so the persistence boundary
 * (Prisma's `integration` delegate) is replaced with an in-memory table that
 * honours the queries the repository issues. Everything between that boundary
 * and the provider stub - the service, the repository, the refresh flow - is
 * the real code.
 */

type Row = {
  id: string;
  organizationId: string;
  internalId: string;
  rootInternalId: string | null;
  providerIdentifier: string;
  name: string;
  picture: string | null;
  profile: string | null;
  token: string;
  refreshToken: string | null;
  tokenExpiration: Date | null;
  inBetweenSteps: boolean;
  deletedAt: Date | null;
  refreshNeeded: boolean;
  type: string;
  additionalSettings: string;
  postingTimes: string;
  customInstanceDetails: string | null;
  [key: string]: any;
};

let seq = 0;
const row = (overrides: Partial<Row> = {}): Row => {
  seq += 1;
  return {
    id: `integration-${seq}`,
    organizationId: 'org-1',
    internalId: `account-${seq}`,
    rootInternalId: null,
    providerIdentifier: 'youtube',
    name: 'Old channel',
    picture: null,
    profile: 'old-handle',
    token: 'old-access-token',
    refreshToken: 'old-refresh-token',
    tokenExpiration: new Date(Date.now() - 60_000),
    inBetweenSteps: false,
    deletedAt: null,
    refreshNeeded: false,
    type: 'social',
    additionalSettings: '[]',
    postingTimes: '[]',
    customInstanceDetails: null,
    ...overrides,
  };
};

const matches = (candidate: Row, where: Record<string, any> = {}): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (key === 'tokenExpiration' && condition && typeof condition === 'object') {
      return (
        candidate.tokenExpiration !== null &&
        candidate.tokenExpiration.getTime() <=
          new Date(condition.lte).getTime()
      );
    }
    if (condition && typeof condition === 'object') {
      if ('in' in condition) {
        return condition.in.includes(candidate[key]);
      }
      if ('not' in condition) {
        return candidate[key] !== condition.not;
      }
    }
    return (candidate[key] ?? null) === (condition ?? null);
  });

const apply = (target: Row, data: Record<string, any>) => {
  for (const [key, value] of Object.entries(data)) {
    // Prisma treats an undefined value as "leave this field alone".
    if (value !== undefined) {
      target[key] = value;
    }
  }
};

const createStore = () => {
  const rows: Row[] = [];
  const byId = (id: string) => {
    const found = rows.find((candidate) => candidate.id === id);
    if (!found) {
      throw new Error(`No integration row ${id}`);
    }
    return found;
  };

  const integration = {
    findMany: async ({ where }: { where?: Record<string, any> } = {}) =>
      rows.filter((candidate) => matches(candidate, where)),
    findFirst: async ({ where }: { where?: Record<string, any> } = {}) =>
      rows.find((candidate) => matches(candidate, where)),
    findUnique: async ({ where }: { where: Record<string, any> }) => {
      if (where.id) {
        return rows.find((candidate) => candidate.id === where.id) ?? null;
      }
      const key = where.organizationId_internalId;
      return (
        rows.find(
          (candidate) =>
            candidate.organizationId === key.organizationId &&
            candidate.internalId === key.internalId
        ) ?? null
      );
    },
    update: async ({
      where,
      data,
    }: {
      where: Record<string, any>;
      data: Record<string, any>;
    }) => {
      const target = byId(where.id);
      if (where.organizationId && target.organizationId !== where.organizationId) {
        throw new Error('Cross-organization update');
      }
      apply(target, data);
      return target;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, any>;
      data: Record<string, any>;
    }) => {
      const affected = rows.filter((candidate) => matches(candidate, where));
      affected.forEach((candidate) => apply(candidate, data));
      return { count: affected.length };
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: Record<string, any>;
      create: Record<string, any>;
      update: Record<string, any>;
    }) => {
      const key = where.organizationId_internalId;
      const existing = rows.find(
        (candidate) =>
          candidate.organizationId === key.organizationId &&
          candidate.internalId === key.internalId
      );
      if (existing) {
        apply(existing, update);
        return existing;
      }
      const created = { ...row(), ...create } as Row;
      rows.push(created);
      return created;
    },
  };

  return { rows, integration };
};

const makeService = (
  store: ReturnType<typeof createStore>,
  providers: Record<string, any>
) => {
  const notifications: Array<{ orgId: string; message: string }> = [];
  const repository = new IntegrationRepository(
    { model: { integration: store.integration } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const manager = {
    getSocialIntegration: (identifier: string) => providers[identifier],
    getMigrationTarget: () => undefined,
    getMigrationSources: () => [],
  } as any;
  const service = new IntegrationService(
    repository,
    {} as any,
    manager,
    {
      inAppNotification: async (orgId: string, message: string) => {
        notifications.push({ orgId, message });
      },
    } as any,
    {} as any,
    {} as any
  );

  return { repository, manager, service, notifications };
};

beforeEach(() => {
  seq = 0;
});

describe('rotating credentials of already-bound channels', () => {
  const boundChannels = [
    { identifier: 'youtube', internalId: 'yt-account', root: 'yt-account' },
    { identifier: 'linkedin', internalId: 'li-account', root: 'li-account' },
    { identifier: 'tiktok', internalId: 'tt-account', root: 'tt-account' },
    { identifier: 'facebook', internalId: 'fb-page', root: 'fb-page' },
    { identifier: 'instagram', internalId: 'ig-page', root: 'ig-user-root' },
    {
      identifier: 'instagram-standalone',
      internalId: 'igs-account',
      root: 'igs-account',
    },
    { identifier: 'tumblr', internalId: 'tumblr-account', root: 'tumblr-account' },
    { identifier: 'linkedin-page', internalId: 'li-page', root: 'li-root' },
  ];

  it('refreshes the six and other bound providers without changing identity', async () => {
    const store = createStore();
    const rows = boundChannels.map((channel) =>
      row({
        internalId: channel.internalId,
        rootInternalId: channel.root,
        providerIdentifier: channel.identifier,
        token: `${channel.identifier}-old`,
        refreshToken: `${channel.identifier}-refresh-old`,
      })
    );
    store.rows.push(...rows);

    const providers = Object.fromEntries(
      boundChannels.map((channel) => [
        channel.identifier,
        {
          refreshToken: async (refreshToken: string) => ({
            accessToken: `${channel.identifier}-new-access`,
            refreshToken: `${refreshToken}-rotated`,
            expiresIn: 3600,
          }),
        },
      ])
    );
    const { service } = makeService(store, providers);

    await service.refreshTokens();

    rows.forEach((candidate, index) => {
      const channel = boundChannels[index];
      expect(candidate.id).toBe(`integration-${index + 1}`);
      expect(candidate.organizationId).toBe('org-1');
      expect(candidate.internalId).toBe(channel.internalId);
      expect(candidate.rootInternalId).toBe(channel.root);
      expect(candidate.name).toBe('Old channel');
      expect(candidate.profile).toBe('old-handle');
      expect(candidate.additionalSettings).toBe('[]');
      expect(candidate.token).toBe(`${channel.identifier}-new-access`);
      expect(candidate.refreshToken).toBe(
        `${channel.identifier}-refresh-old-rotated`
      );
      expect(candidate.refreshNeeded).toBe(false);
      expect(candidate.tokenExpiration!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('keeps refreshing the remaining channels when one refresh fails', async () => {
    const store = createStore();
    const broken = row({
      internalId: 'broken',
      rootInternalId: 'broken',
      providerIdentifier: 'facebook',
      token: 'broken-old',
    });
    const healthy = row({
      internalId: 'healthy',
      rootInternalId: 'healthy',
      providerIdentifier: 'tumblr',
      token: 'healthy-old',
    });
    store.rows.push(broken, healthy);

    const providers = {
      facebook: {
        refreshToken: async () => {
          throw new Error('revoked');
        },
      },
      tumblr: {
        refreshToken: async () => ({
          accessToken: 'healthy-new',
          refreshToken: 'healthy-refresh-new',
          expiresIn: 3600,
        }),
      },
    };
    const brokenExpiry = broken.tokenExpiration;
    const { service, notifications } = makeService(store, providers);

    await service.refreshTokens();

    expect(broken.refreshNeeded).toBe(true);
    expect(broken.token).toBe('broken-old');
    expect(broken.refreshToken).toBe('old-refresh-token');
    expect(broken.tokenExpiration).toBe(brokenExpiry);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toContain('facebook');

    expect(healthy.refreshNeeded).toBe(false);
    expect(healthy.token).toBe('healthy-new');
    expect(healthy.refreshToken).toBe('healthy-refresh-new');
  });

  it('treats an empty refreshed token as a failure, never as success', async () => {
    const store = createStore();
    const instagram = row({
      internalId: 'ig-page',
      rootInternalId: 'ig-user-root',
      providerIdentifier: 'instagram',
      token: 'ig-still-valid',
      refreshToken: 'ig-refresh',
    });
    store.rows.push(instagram);

    const providers = {
      // The Facebook-Business Instagram provider has no self-refresh: it
      // answers with an empty token and the channel needs a reconnect.
      instagram: {
        refreshToken: async () => ({
          accessToken: '',
          refreshToken: '',
          expiresIn: 0,
        }),
      },
    };
    const previousExpiry = instagram.tokenExpiration;
    const { service, notifications } = makeService(store, providers);

    await service.refreshTokens();

    expect(instagram.token).toBe('ig-still-valid');
    expect(instagram.refreshToken).toBe('ig-refresh');
    expect(instagram.tokenExpiration).toBe(previousExpiry);
    expect(instagram.refreshNeeded).toBe(true);
    expect(notifications).toHaveLength(1);
  });

  it('keeps the same account on another organization untouched', async () => {
    const store = createStore();
    const mine = row({
      organizationId: 'org-1',
      internalId: 'shared-account',
      rootInternalId: 'shared-account',
      providerIdentifier: 'tumblr',
      token: 'mine-old',
      refreshToken: 'mine-refresh-old',
    });
    const theirs = row({
      organizationId: 'org-2',
      internalId: 'shared-account',
      rootInternalId: 'shared-account',
      providerIdentifier: 'tumblr',
      token: 'theirs-old',
      refreshToken: 'theirs-refresh-old',
    });
    store.rows.push(mine, theirs);

    const providers = {
      tumblr: {
        refreshToken: async (refreshToken: string) =>
          refreshToken === 'mine-refresh-old'
            ? {
                accessToken: 'mine-new',
                refreshToken: 'mine-refresh-new',
                expiresIn: 3600,
              }
            : {
                accessToken: 'theirs-new',
                refreshToken: 'theirs-refresh-new',
                expiresIn: 3600,
              },
      },
    };
    const { service } = makeService(store, providers);

    await service.refreshTokens();

    // Both organizations keep their own row: same account, same internal id,
    // but the refresh writes only the org-scoped row it was started for.
    expect(mine.organizationId).toBe('org-1');
    expect(mine.token).toBe('mine-new');
    expect(mine.refreshToken).toBe('mine-refresh-new');
    expect(theirs.organizationId).toBe('org-2');
    expect(theirs.token).toBe('theirs-new');
    expect(theirs.refreshToken).toBe('theirs-refresh-new');
  });

  it('keeps non-whitelisted bindings queryable and settable', async () => {
    const store = createStore();
    const tumblr = row({ providerIdentifier: 'tumblr' });
    const linkedinPage = row({ providerIdentifier: 'linkedin-page' });
    const removed = row({
      providerIdentifier: 'tumblr',
      deletedAt: new Date(),
    });
    const otherOrg = row({
      organizationId: 'org-2',
      providerIdentifier: 'linkedin-page',
    });
    store.rows.push(tumblr, linkedinPage, removed, otherOrg);

    const { service } = makeService(store, {});

    const list = await service.getIntegrationsList('org-1');
    expect(list.map((candidate: Row) => candidate.providerIdentifier)).toEqual([
      'tumblr',
      'linkedin-page',
    ]);

    await service.updateProviderSettings(
      'org-1',
      linkedinPage.id,
      '["settings"]'
    );

    expect(linkedinPage.additionalSettings).toBe('["settings"]');
    expect(tumblr.additionalSettings).toBe('[]');
    expect(otherOrg.additionalSettings).toBe('[]');
  });
});

describe('refresh with grouped pages of the same account', () => {
  const refreshService = (
    store: ReturnType<typeof createStore>,
    providers: Record<string, any>
  ) => {
    const { service } = makeService(store, providers);
    return new RefreshIntegrationService(
      {
        getSocialIntegration: (identifier: string) => providers[identifier],
      } as any,
      service,
      {} as any
    );
  };

  it('reconnects a page with its root id and stores the page token', async () => {
    const store = createStore();
    const page = row({
      internalId: 'page-2',
      rootInternalId: 'user-root',
      providerIdentifier: 'instagram',
      token: 'old-page-token',
      refreshToken: 'old-user-token',
    });
    store.rows.push(page);

    const calls: any[] = [];
    const provider = {
      oneTimeToken: false,
      refreshToken: async (refreshToken: string) => ({
        accessToken: 'fresh-user-token',
        refreshToken: 'fresh-user-refresh',
        expiresIn: 3600,
      }),
      reConnect: async (
        rootInternalId: string,
        internalId: string,
        token: string
      ) => {
        calls.push({ rootInternalId, internalId, token });
        return {
          id: internalId,
          name: 'Page two',
          accessToken: 'fresh-page-token',
          picture: '',
          username: 'page-two',
        };
      },
    };
    const refresh = refreshService(store, { instagram: provider });

    const result = await refresh.refresh(page as any);

    expect(calls).toEqual([
      {
        rootInternalId: 'user-root',
        internalId: 'page-2',
        token: 'fresh-user-token',
      },
    ]);
    expect(result).toBeTruthy();
    expect(page.token).toBe('fresh-page-token');
    expect(page.refreshToken).toBe('fresh-user-refresh');
    expect(page.internalId).toBe('page-2');
    expect(page.rootInternalId).toBe('user-root');
  });

  it('does not call reConnect for a root channel', async () => {
    const store = createStore();
    const root = row({
      internalId: 'root-channel',
      rootInternalId: 'root-channel',
      providerIdentifier: 'instagram',
    });
    store.rows.push(root);

    const calls: any[] = [];
    const provider = {
      oneTimeToken: false,
      refreshToken: async () => ({
        accessToken: 'fresh-root-token',
        refreshToken: 'fresh-root-refresh',
        expiresIn: 3600,
      }),
      reConnect: async (...args: any[]) => {
        calls.push(args);
        return {};
      },
    };
    const refresh = refreshService(store, { instagram: provider });

    await refresh.refresh(root as any);

    expect(calls).toEqual([]);
    expect(root.token).toBe('fresh-root-token');
  });

  it('flags the channel when the token refresh itself fails', async () => {
    const store = createStore();
    const page = row({
      internalId: 'page-3',
      rootInternalId: 'user-root',
      providerIdentifier: 'instagram',
      token: 'old-page-token',
    });
    store.rows.push(page);

    const calls: any[] = [];
    const provider = {
      oneTimeToken: false,
      refreshToken: async () => {
        throw new Error('invalid grant');
      },
      reConnect: async (...args: any[]) => {
        calls.push(args);
        return {};
      },
    };
    const previousExpiry = page.tokenExpiration;
    const refresh = refreshService(store, { instagram: provider });

    const result = await refresh.refresh(page as any);

    expect(result).toBe(false);
    expect(calls).toEqual([]);
    expect(page.token).toBe('old-page-token');
    expect(page.tokenExpiration).toBe(previousExpiry);
    expect(page.refreshNeeded).toBe(true);
  });
});

describe('provider-specific credential reads', () => {
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const instagramFetch = () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/me/accounts')) {
        return respond({
          data: [{ id: 'page-1', instagram_business_account: { id: 'ig-1' } }],
        });
      }
      if (url.includes('/me/businesses')) {
        return respond({ data: [] });
      }
      if (url.includes('/ig-1?')) {
        return respond({
          id: 'ig-1',
          name: 'Instagram One',
          profile_picture_url: 'https://example.test/ig-1.png',
        });
      }
      if (url.includes('/page-1?')) {
        return respond({
          access_token: 'resolved-page-token',
          name: 'Page One',
          picture: { data: { url: 'https://example.test/page-1.png' } },
        });
      }
      return respond({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  };

  it('reads an old Instagram single token as the whole access token', async () => {
    const calls = instagramFetch();
    const provider = new InstagramProvider();

    const pages = await provider.pages('single-token');

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ id: 'ig-1', pageId: 'page-1' });
    const graphCalls = calls.filter((url) =>
      url.includes('access_token=single-token')
    );
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(calls.some((url) => url.includes('___'))).toBe(false);

    const reconnected = await provider.reConnect(
      'user-root',
      'ig-1',
      'single-token'
    );
    expect(reconnected.id).toBe('ig-1');
    expect(reconnected.accessToken).toBe(
      'resolved-page-token___single-token'
    );
  });

  it('reads the combined page/user token format', async () => {
    const calls = instagramFetch();
    const provider = new InstagramProvider();

    await provider.pages('page-token___user-token');

    expect(
      calls.every(
        (url) =>
          !url.includes('access_token=page-token___user-token') &&
          !url.includes('access_token=user-token')
      )
    ).toBe(true);
    expect(calls.some((url) => url.includes('access_token=page-token'))).toBe(
      true
    );
  });

  const skoolFetch = () => {
    const calls: Array<{ url: string; cookie?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any, init?: any) => {
        calls.push({
          url: String(input),
          cookie: init?.headers?.Cookie,
        });
        return respond({
          groups: [{ id: 7, metadata: { display_name: 'Group A' } }],
        });
      })
    );
    return calls;
  };

  it('reads Skool credentials stored as an AES-encrypted JSON blob', async () => {
    process.env.JWT_SECRET = 'ticket-09-test-secret';
    const calls = skoolFetch();
    const provider = new SkoolProvider();
    const stored = AuthService.fixedEncryption(
      JSON.stringify({ client_id: 'new-client', auth_token: 'new-token' })
    );

    const groups = await provider.groups('unused', {}, 'user-1', {
      customInstanceDetails: stored,
    } as any);

    expect(groups).toEqual([{ id: '7', name: 'Group A' }]);
    expect(calls[0].cookie).toBe(
      'auth_token=new-token; client_id=new-client'
    );
  });

  it('reads a legacy Skool JWT without forcing a reconnect', async () => {
    process.env.JWT_SECRET = 'ticket-09-test-secret';
    const calls = skoolFetch();
    const provider = new SkoolProvider();
    const stored = AuthService.signJWT({
      client_id: 'legacy-client',
      auth_token: 'legacy-token',
    });

    const groups = await provider.groups('unused', {}, 'user-1', {
      customInstanceDetails: stored,
    } as any);

    expect(groups).toEqual([{ id: '7', name: 'Group A' }]);
    expect(calls[0].cookie).toBe(
      'auth_token=legacy-token; client_id=legacy-client'
    );
  });

  it('does not repair a malformed Skool credential into something usable', async () => {
    process.env.JWT_SECRET = 'ticket-09-test-secret';
    const calls = skoolFetch();
    const provider = new SkoolProvider();

    const groups = await provider.groups('unused', {}, 'user-1', {
      customInstanceDetails: 'not-a-jwt-and-not-ciphertext',
    } as any);

    expect(groups).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('reconnect of an already-bound channel', () => {
  const FRONTEND = path.resolve(import.meta.dirname, '../apps/frontend/src');
  const launches = readFileSync(
    path.resolve(FRONTEND, 'components/launches/launches.component.tsx'),
    'utf8'
  );
  const menu = readFileSync(
    path.resolve(FRONTEND, 'components/launches/menu/menu.tsx'),
    'utf8'
  );
  const reconnect = launches.slice(
    launches.indexOf('const refreshChannel'),
    launches.indexOf('useEffect(() => {', launches.indexOf('const refreshChannel'))
  );

  it('asks for the credential form from the backend flag, not a provider list', () => {
    const customBranch = reconnect.slice(
      reconnect.indexOf('if (integration.isCustomFields)'),
      reconnect.indexOf('const { url }')
    );

    expect(reconnect).toContain('if (integration.isCustomFields)');
    expect(customBranch).toContain('<CustomVariables');
    expect(customBranch).not.toMatch(
      /['"](bluesky|hashnode|medium|wordpress|nostr|lemmy|listmonk|devto)['"]/
    );
  });

  it('keeps ordinary OAuth reconnects in the current window', () => {
    expect(reconnect).toContain('window.location.href = url;');
    expect(reconnect).not.toContain('window.open');
  });

  it('shows the credential entry and hides the OAuth one for account/key providers', () => {
    expect(menu).toContain('!!findIntegration?.isCustomFields');
    expect(menu).toContain('!findIntegration.customFields');
    // a failed refresh is visible as "refreshNeeded", not as a success
    expect(menu).toContain('findIntegration?.refreshNeeded');
    expect(menu).toContain('refreshChannel(findIntegration!)');
  });
});

describe('reconnect persistence', () => {
  const controllerFor = (provider: Record<string, any>) => {
    const createOrUpdateIntegration = vi.fn(async () => ({
      id: 'integration-1',
      token: 'stored-token',
      refreshToken: 'stored-refresh',
    }));
    const controller = new NoAuthIntegrationsController(
      {
        getAllowedSocialsIntegrations: () => ['instagram'],
        getSocialIntegration: () => provider,
      } as any,
      {
        createOrUpdateIntegration,
        checkPreviousConnections: vi.fn(async () => false),
        migrateIntegration: vi.fn(),
        migrateIntegrationOnConnect: vi.fn(),
      } as any,
      { startRefreshWorkflow: vi.fn(async () => true) } as any,
      {
        getOrgById: vi.fn(async () => ({
          id: 'org-1',
          isTrailing: false,
          apiKey: 'org-key',
        })),
      } as any
    );

    return { controller, createOrUpdateIntegration };
  };

  const state = (suffix: string) => {
    const value = `ticket-09-${suffix}`;
    ioRedis.set(`login:${value}`, 'verifier');
    ioRedis.set(`organization:${value}`, 'org-1');
    ioRedis.set(`refresh:${value}`, 'page-2');
    return value;
  };

  const body = (value: string) => ({
    state: value,
    code: 'authorization-code',
    timezone: '0',
    refresh: 'page-2',
  });

  it('stores the freshly authenticated refresh token and expiration', async () => {
    const reConnect = vi.fn(async () => ({
      id: 'page-2',
      name: 'Page Two',
      accessToken: 'new-page-token',
      picture: 'https://example.test/page-2.png',
      username: 'page-two',
    }));
    const { controller, createOrUpdateIntegration } = controllerFor({
      isBetweenSteps: false,
      authenticate: async () => ({
        id: 'user-root',
        accessToken: 'new-user-token',
        refreshToken: 'new-user-refresh',
        expiresIn: 3600,
        name: 'User',
        picture: '',
        username: 'user',
      }),
      reConnect,
    });

    await controller.connectSocialMedia('instagram', body(state('reconnect')) as any);

    expect(reConnect).toHaveBeenCalledWith(
      'user-root',
      'page-2',
      'new-user-token'
    );
    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[3]).toBe('Page Two');
    expect(args[5]).toBe('social');
    expect(args[6]).toBe('page-2');
    expect(args[7]).toBe('instagram');
    expect(args[8]).toBe('new-page-token');
    // the fresh authentication wins, not the old stored refresh token
    expect(args[9]).toBe('new-user-refresh');
    expect(args[10]).toBe(3600);
  });

  it('does not persist anything when the reauthorised account is rejected', async () => {
    const reConnect = vi.fn(async () => {
      throw new Error('Please connect the same account');
    });
    const { controller, createOrUpdateIntegration } = controllerFor({
      isBetweenSteps: false,
      authenticate: async () => ({
        id: 'different-account',
        accessToken: 'new-user-token',
        refreshToken: 'new-user-refresh',
        expiresIn: 3600,
        name: 'Other',
        picture: '',
        username: 'other',
      }),
      reConnect,
    });

    await expect(
      controller.connectSocialMedia('instagram', body(state('rejected')) as any)
    ).rejects.toThrow('Please connect the same account');
    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});

describe('old root lookup', () => {
  const service = (store: ReturnType<typeof createStore>) =>
    makeService(store, {}).service;

  it('still finds a root id that a deleted account stored as md5', async () => {
    const store = createStore();
    store.rows.push(
      row({
        organizationId: 'org-1',
        internalId: 'account-1',
        rootInternalId: createHash('md5').update('raw-root').digest('hex'),
      })
    );

    expect(await service(store).checkPreviousConnections('org-2', 'raw-root')).toBe(
      true
    );
    expect(await service(store).checkPreviousConnections('org-1', 'raw-root')).toBe(
      false
    );
  });

  it('does not invent an underscore-suffixed root id', async () => {
    const store = createStore();
    store.rows.push(
      row({
        organizationId: 'org-1',
        internalId: 'account-1',
        rootInternalId: 'raw-root_page_2',
      })
    );

    expect(
      await service(store).checkPreviousConnections('org-2', 'raw-root')
    ).toBe(false);
  });
});
