import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { TumblrProvider } from '@gitroom/nestjs-libraries/integrations/social/tumblr.provider';
import { SkoolProvider } from '@gitroom/nestjs-libraries/integrations/social/skool.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/services/encryption.service';
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { IntegrationsController } from '@gitroom/backend/api/routes/integrations.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
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
    {} as any,
    new EncryptionService()
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

const makeRefresh = (
  store: ReturnType<typeof createStore>,
  providers: Record<string, any>
) => {
  const { service, notifications } = makeService(store, providers);
  const refresh = new RefreshIntegrationService(
    {
      getSocialIntegration: (identifier: string) => providers[identifier],
    } as any,
    service,
    {} as any
  );
  return { refresh, service, notifications };
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

describe('concurrent refresh of one channel', () => {
  it('reuses the credential a parallel refresh rotated and later publishes with it', async () => {
    const store = createStore();
    const stored = row({
      providerIdentifier: 'tumblr',
      internalId: 'tumblr-history',
      rootInternalId: 'tumblr-history',
      token: 'synthetic-old-access',
      refreshToken: 'synthetic-old-refresh',
    });
    store.rows.push(stored);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstCallStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const seen: string[] = [];
    const providers = {
      tumblr: {
        refreshToken: async (refreshToken: string) => {
          seen.push(refreshToken);
          if (refreshToken === 'synthetic-old-refresh' && seen.length === 1) {
            firstStarted();
            // hold the winning rotation until the batch has taken its own
            // snapshot and had its request rejected
            await firstGate;
            return {
              accessToken: 'synthetic-winner-access',
              refreshToken: 'synthetic-winner-refresh',
              expiresIn: 3600,
            };
          }

          if (refreshToken === 'synthetic-old-refresh') {
            throw new Error('invalid_grant');
          }

          return {
            accessToken: 'synthetic-next-access',
            refreshToken: 'synthetic-next-refresh',
            expiresIn: 3600,
          };
        },
      },
    };
    const { refresh, service, notifications } = makeRefresh(store, providers);

    // Temporal hands each activity its own copy of the integration row.
    const single = refresh.refresh({ ...stored } as any);
    await firstCallStarted;
    const batch = service.refreshTokens();
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseFirst();

    const [singleResult] = await Promise.all([single, batch]);

    expect(singleResult).toBeTruthy();
    // both refresh paths called the provider with the same expired token,
    // only one rotation won
    expect(
      seen.filter((token) => token === 'synthetic-old-refresh')
    ).toHaveLength(2);
    expect(stored.token).toBe('synthetic-winner-access');
    expect(stored.refreshToken).toBe('synthetic-winner-refresh');
    // the losing batch must not flag a channel that was just rotated
    expect(stored.refreshNeeded).toBe(false);
    expect(notifications).toHaveLength(0);

    // the publish side reads the row after the refresh and must use the
    // winner, not the token its workflow started with
    const publish = await store.integration.findFirst({
      where: { id: stored.id },
    });
    expect(publish).toMatchObject({
      token: 'synthetic-winner-access',
      refreshToken: 'synthetic-winner-refresh',
      internalId: 'tumblr-history',
      organizationId: 'org-1',
    });
  });

  it('notifies only the attempt that first flags a broken channel', async () => {
    const store = createStore();
    const broken = row({
      providerIdentifier: 'facebook',
      internalId: 'facebook-broken',
      rootInternalId: 'facebook-broken',
    });
    store.rows.push(broken);
    const providers = {
      facebook: {
        refreshToken: async () => {
          throw new Error('revoked');
        },
      },
    };
    const { refresh, notifications } = makeRefresh(store, providers);

    await refresh.refresh({ ...broken } as any);
    expect(broken.refreshNeeded).toBe(true);
    expect(notifications).toHaveLength(1);

    // the next hourly refresh still tries the provider, fails again, and must
    // not send a second notification
    await refresh.refresh({ ...broken } as any);
    expect(broken.refreshNeeded).toBe(true);
    expect(notifications).toHaveLength(1);
  });
});

describe('pages and shared accounts keep their exact associations', () => {
  it('refreshes a root and two pages of one account without mixing their tokens', async () => {
    const store = createStore();
    const root = row({
      internalId: 'instagram-user',
      rootInternalId: 'instagram-user',
      providerIdentifier: 'instagram',
      token: 'synthetic-user-token',
      refreshToken: 'synthetic-user-refresh',
    });
    const pageOne = row({
      internalId: 'instagram-page-one',
      rootInternalId: 'instagram-user',
      providerIdentifier: 'instagram',
      token: 'synthetic-page-one',
      refreshToken: 'synthetic-user-refresh',
    });
    const pageTwo = row({
      internalId: 'instagram-page-two',
      rootInternalId: 'instagram-user',
      providerIdentifier: 'instagram',
      token: 'synthetic-page-two',
      refreshToken: 'synthetic-user-refresh',
    });
    store.rows.push(root, pageOne, pageTwo);

    const reconnects: Array<[string, string, string]> = [];
    const providers = {
      instagram: {
        oneTimeToken: false,
        refreshToken: async () => ({
          accessToken: 'synthetic-user-token-two',
          refreshToken: 'synthetic-user-refresh-two',
          expiresIn: 3600,
        }),
        reConnect: async (
          rootInternalId: string,
          internalId: string,
          token: string
        ) => {
          reconnects.push([rootInternalId, internalId, token]);
          return {
            id: internalId,
            name: internalId,
            accessToken: `page-token-for-${internalId}`,
            picture: '',
            username: internalId,
          };
        },
      },
    };
    const { refresh } = makeRefresh(store, providers);

    await refresh.refresh({ ...root } as any);
    await refresh.refresh({ ...pageOne } as any);
    await refresh.refresh({ ...pageTwo } as any);

    expect(root.token).toBe('synthetic-user-token-two');
    expect(root.rootInternalId).toBe('instagram-user');
    expect(pageOne.token).toBe('page-token-for-instagram-page-one');
    expect(pageOne.refreshToken).toBe('synthetic-user-refresh-two');
    expect(pageOne.rootInternalId).toBe('instagram-user');
    expect(pageTwo.token).toBe('page-token-for-instagram-page-two');
    expect(pageTwo.refreshToken).toBe('synthetic-user-refresh-two');
    expect(pageTwo.rootInternalId).toBe('instagram-user');
    expect(reconnects).toEqual([
      ['instagram-user', 'instagram-page-one', 'synthetic-user-token-two'],
      ['instagram-user', 'instagram-page-two', 'synthetic-user-token-two'],
    ]);
  });

  it('refreshing one organization leaves the same account in another byte-identical', async () => {
    const store = createStore();
    const mine = row({
      organizationId: 'org-1',
      internalId: 'shared-tumblr',
      rootInternalId: 'shared-tumblr',
      providerIdentifier: 'tumblr',
      token: 'synthetic-mine-old',
      refreshToken: 'synthetic-mine-refresh',
    });
    const theirs = row({
      organizationId: 'org-2',
      internalId: 'shared-tumblr',
      rootInternalId: 'shared-tumblr',
      providerIdentifier: 'tumblr',
      token: 'synthetic-theirs-old',
      refreshToken: 'synthetic-theirs-refresh',
    });
    store.rows.push(mine, theirs);
    const before = JSON.stringify(theirs);
    const providers = {
      tumblr: {
        refreshToken: async () => ({
          accessToken: 'synthetic-mine-new',
          refreshToken: 'synthetic-mine-refresh-new',
          expiresIn: 3600,
        }),
      },
    };
    const { refresh } = makeRefresh(store, providers);

    await refresh.refresh({ ...mine } as any);

    expect(mine.token).toBe('synthetic-mine-new');
    expect(theirs.organizationId).toBe('org-2');
    expect(JSON.stringify(theirs)).toBe(before);
  });
});

describe('default deployment without an encryption provider', () => {
  it('keeps synthetic legacy tokens in their original form through a write and read', async () => {
    const store = createStore();
    const legacy = row({
      providerIdentifier: 'instagram',
      internalId: 'instagram-page-legacy',
      rootInternalId: 'instagram-user-legacy',
      token: 'synthetic-page___synthetic-user',
      refreshToken: 'synthetic-user-refresh',
    });
    store.rows.push(legacy);
    const providers = {
      instagram: {
        refreshToken: async () => ({
          accessToken: 'synthetic-renewed-user',
          refreshToken: 'synthetic-renewed-refresh',
          expiresIn: 3600,
        }),
        reConnect: async (root: string, internalId: string) => ({
          id: internalId,
          name: 'Legacy page',
          accessToken: 'synthetic-renewed-page___synthetic-renewed-user',
          picture: '',
          username: 'legacy-page',
        }),
      },
    };
    const { refresh, service } = makeRefresh(store, providers);
    const encryption = new EncryptionService();

    expect(encryption.hasProvider()).toBe(false);
    expect(await encryption.encrypt('synthetic-plain')).toBe(
      'synthetic-plain'
    );
    expect(await encryption.decrypt('synthetic-plain')).toBe('synthetic-plain');

    await refresh.refresh({ ...legacy } as any);

    expect(legacy.token).toBe(
      'synthetic-renewed-page___synthetic-renewed-user'
    );
    expect(legacy.token.startsWith('enc:v1:')).toBe(false);
    expect(legacy.refreshToken).toBe('synthetic-renewed-refresh');
    // the stored legacy value is still readable by the service
    const read = await service.getIntegrationById('org-1', legacy.id);
    expect(read.token).toBe('synthetic-renewed-page___synthetic-renewed-user');
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

  it('publishes a combined Instagram credential with the page half only', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any, init?: any) => {
        const url = String(input);
        calls.push({ url, method: init?.method || 'GET' });
        if (url.includes('/media_publish?')) {
          return respond({ id: 'synthetic-media-1' });
        }
        if (url.includes('/media?')) {
          return respond({ id: 'synthetic-container-1' });
        }
        if (url.includes('/synthetic-container-1?')) {
          return respond({ status_code: 'FINISHED', status: 'ready' });
        }
        if (url.includes('/synthetic-media-1?')) {
          return respond({
            permalink: 'https://www.instagram.com/p/synthetic',
          });
        }
        return respond({});
      })
    );

    const provider = new InstagramProvider();
    const integration = {
      id: 'integration-instagram-page',
      organizationId: 'org-1',
      internalId: 'instagram-page-1',
      providerIdentifier: 'instagram',
      profile: 'synthetic-page',
      token: 'synthetic-page-token___synthetic-user-token',
    } as any;
    const post = {
      id: 'post-1',
      message: 'synthetic caption',
      settings: { post_type: 'post' },
      media: [{ path: 'https://media.invalid/synthetic.jpg' }],
    } as any;

    const [pending] = await provider.postPending(
      integration.internalId,
      integration.token,
      [post],
      integration
    );
    expect(pending).toMatchObject({ status: 'pending' });

    const check = await provider.checkPostStatus(
      integration.token,
      pending.pendingData,
      integration
    );
    expect(check.status).toBe('ready');

    const finalized = await provider.finalizePost(
      integration.token,
      check.pendingData,
      integration
    );
    expect(finalized).toMatchObject({
      status: 'completed',
      postId: 'synthetic-media-1',
      releaseURL: 'https://www.instagram.com/p/synthetic',
    });

    const create = calls.find(
      (call) => call.url.includes('/instagram-page-1/media?') && call.method === 'POST'
    )!;
    expect(create.url).toContain('access_token=synthetic-page-token');
    expect(create.url).not.toContain('___');
    expect(create.url).not.toContain('synthetic-user-token');

    const status = calls.find((call) =>
      call.url.includes('/synthetic-container-1?')
    )!;
    expect(status.url).toContain('access_token=synthetic-user-token');

    const publish = calls.find((call) =>
      call.url.includes('/instagram-page-1/media_publish?')
    )!;
    expect(publish.method).toBe('POST');
    expect(publish.url).toContain('access_token=synthetic-page-token');
    expect(publish.url).not.toContain('___');
  });

  it('publishes with a legacy Skool JWT without reconnecting', async () => {
    process.env.JWT_SECRET = 'ticket-11-test-secret';
    const calls: Array<{ url: string; cookie?: string; body?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any, init?: any) => {
        calls.push({
          url: String(input),
          cookie: init?.headers?.Cookie,
          body: init?.body,
        });
        if (String(input).includes('/posts?follow=true')) {
          return respond({ id: 'synthetic-skool-post', name: 'welcome' });
        }
        return respond({});
      })
    );

    const provider = new SkoolProvider();
    const integration = {
      id: 'integration-skool',
      organizationId: 'org-1',
      internalId: 'synthetic-skool-user',
      providerIdentifier: 'skool',
      customInstanceDetails: AuthService.signJWT({
        client_id: 'synthetic-client',
        auth_token: 'synthetic-legacy-token',
      }),
    } as any;

    const [result] = await provider.post(
      integration.internalId,
      'unused',
      [
        {
          id: 'post-1',
          message: 'synthetic skool post',
          settings: { group: 'synthetic-group', title: 'Synthetic', label: 'none' },
          media: [],
        } as any,
      ],
      integration
    );

    expect(result).toMatchObject({
      postId: 'synthetic-skool-post',
      releaseURL: 'https://www.skool.com/synthetic-group/welcome',
      status: 'success',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].cookie).toBe(
      'auth_token=synthetic-legacy-token; client_id=synthetic-client'
    );
    expect(JSON.parse(calls[0].body!)).toMatchObject({
      post_type: 'generic',
      group_id: 'synthetic-group',
      metadata: { content: 'synthetic skool post' },
    });
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

  it('keeps ordinary OAuth reconnects on the shared window choice', () => {
    // the helper navigates a standalone window and opens the relay only
    // inside the parent application iframe
    expect(reconnect).toContain(
      'openChannelOAuth(url, { embedded: isEmbeddedInIframe() })'
    );
    expect(reconnect).not.toContain('window.open');
    expect(reconnect).not.toContain('window.location.href');
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

/**
 * Ticket 11: the same matrix against a real PostgreSQL database.
 *
 * Everything here is the shipped repository/service/controller/provider code.
 * The database is PostgreSQL (DATABASE_URL), the platform is a local HTTP
 * double reached by replacing global fetch, and only the Google client
 * (youtube) is a provider-level stub. Run it with DATABASE_URL pointing at the
 * ticket database; the suite is skipped without one.
 */
const ticket11DatabaseUrl =
  process.env.TICKET11_DATABASE_URL || process.env.DATABASE_URL;
const databaseSuite = ticket11DatabaseUrl ? describe : describe.skip;

databaseSuite('real PostgreSQL credential matrix', () => {
  const pid = process.pid;
  const orgA = `ticket11-org-a-${pid}`;
  const orgB = `ticket11-org-b-${pid}`;
  const ids = {
    linkedin: `ticket11-linkedin-${pid}`,
    facebook: `ticket11-facebook-${pid}`,
    instagram: `ticket11-instagram-${pid}`,
    instagramPageOne: `ticket11-instagram-page-one-${pid}`,
    instagramPageTwo: `ticket11-instagram-page-two-${pid}`,
    instagramStandalone: `ticket11-instagram-standalone-${pid}`,
    youtube: `ticket11-youtube-${pid}`,
    tiktok: `ticket11-tiktok-${pid}`,
    linkedinPage: `ticket11-linkedin-page-${pid}`,
    tumblrA: `ticket11-tumblr-a-${pid}`,
    tumblrB: `ticket11-tumblr-b-${pid}`,
    skool: `ticket11-skool-${pid}`,
  };

  const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const past = () => new Date(Date.now() - 60 * 60 * 1000);

  let prisma: PrismaClient;
  let repository: IntegrationRepository;
  let service: IntegrationService;
  let manager: IntegrationManager;
  let refresh: RefreshIntegrationService;
  let notifications: Array<{
    orgId: string;
    subject: string;
    message: string;
  }>;
  let youtubeStub: Record<string, any>;

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  type DoubleCall = {
    host: string;
    path: string;
    search: string;
    method: string;
    authorization?: string;
    cookie?: string;
    body?: string;
  };

  /**
   * The platform view. It answers by host and records only semantic fields:
   * tests assert labels such as "Bearer synthetic-tumblr-a-access", never a
   * credential value in an evidence file.
   */
  const installPlatformDouble = (options: {
    onTumblrToken?: (refreshToken: string) => Promise<any>;
  } = {}) => {
    const calls: DoubleCall[] = [];
    const tumblrTokens = new Map<string, number>();

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = new URL(String(input));
      const call: DoubleCall = {
        host: url.host,
        path: url.pathname,
        search: url.search,
        method: init?.method || 'GET',
        authorization: init?.headers?.Authorization,
        cookie: init?.headers?.Cookie,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      calls.push(call);

      if (url.host === 'www.linkedin.com') {
        const form = new URLSearchParams(String(init?.body || ''));
        const scope = form.get('refresh_token') || '';
        return respond({
          access_token: scope.includes('page')
            ? 'synthetic-linkedin-page-access'
            : 'synthetic-linkedin-access',
          refresh_token: scope.includes('page')
            ? 'synthetic-linkedin-page-refresh'
            : 'synthetic-linkedin-refresh',
          expires_in: 3600,
        });
      }

      if (url.host === 'api.linkedin.com') {
        if (url.pathname === '/v2/me') {
          return respond({ vanityName: 'synthetic-linkedin' });
        }
        if (url.pathname === '/v2/userinfo') {
          return respond({
            sub: 'synthetic-linkedin-user',
            name: 'synthetic-linkedin',
            picture: '',
          });
        }
      }

      if (url.host === 'open.tiktokapis.com') {
        if (url.pathname.includes('/oauth/token')) {
          return respond({
            access_token: 'synthetic-tiktok-access',
            refresh_token: 'synthetic-tiktok-refresh',
            expires_in: 86400,
          });
        }
        if (url.pathname.includes('/user/info')) {
          return respond({
            data: {
              user: {
                avatar_url: '',
                display_name: 'synthetic-tiktok',
                open_id: 'synthetic-tiktok-user',
                username: 'synthetic-tiktok',
              },
            },
          });
        }
      }

      if (url.host === 'graph.instagram.com') {
        if (url.pathname.includes('/refresh_access_token')) {
          return respond({ access_token: 'synthetic-ig-standalone-access' });
        }
        if (url.pathname.includes('/me')) {
          return respond({
            user_id: 'synthetic-ig-standalone-user',
            name: 'synthetic-ig-standalone',
            username: 'synthetic-ig-standalone',
            profile_picture_url: '',
          });
        }
      }

      if (url.host === 'api.tumblr.com') {
        if (url.pathname === '/v2/oauth2/token') {
          const form = new URLSearchParams(String(init?.body || ''));
          const refreshToken = form.get('refresh_token') || '';
          if (options.onTumblrToken) {
            return respond(await options.onTumblrToken(refreshToken));
          }
          const count = (tumblrTokens.get(refreshToken) || 0) + 1;
          tumblrTokens.set(refreshToken, count);
          if (count > 1) {
            return respond({ error: 'invalid_grant' }, 400);
          }
          const suffix = refreshToken.includes('-b-') ? 'b' : 'a';
          return respond({
            access_token: `synthetic-tumblr-${suffix}-access`,
            refresh_token: `synthetic-tumblr-${suffix}-refresh`,
            expires_in: 3600,
          });
        }
        if (url.pathname === '/v2/user/info') {
          const suffix = String(init?.headers?.Authorization || '').includes(
            '-b-'
          )
            ? 'b'
            : 'a';
          const name = `synthetic-tumblr-${suffix}`;
          return respond({
            response: {
              user: {
                name,
                blogs: [{ name, primary: true }],
              },
            },
          });
        }
        if (url.pathname.includes('/posts')) {
          return respond({
            response: { id: 'synthetic-tumblr-post', id_string: 'synthetic-tumblr-post' },
          });
        }
      }

      if (url.host === 'api2.skool.com') {
        if (url.pathname.includes('/posts')) {
          return respond({ id: 'synthetic-skool-post', name: 'welcome' });
        }
        return respond({});
      }

      if (url.host === 'graph.facebook.com') {
        if (url.pathname.includes('/media_publish')) {
          return respond({ id: 'synthetic-instagram-media' });
        }
        if (url.pathname.endsWith('/media')) {
          return respond({ id: 'synthetic-instagram-container' });
        }
        if (url.pathname.includes('/synthetic-instagram-container')) {
          return respond({ status_code: 'FINISHED', status: 'ready' });
        }
        if (url.pathname.includes('/synthetic-instagram-media')) {
          return respond({
            permalink: 'https://www.instagram.com/p/synthetic',
          });
        }
      }

      return respond({});
    });

    vi.stubGlobal('fetch', fetchMock);
    return calls;
  };

  const seed = async () => {
    const common = {
      organizationId: orgA,
      type: 'social',
      postingTimes: '[]',
      additionalSettings: '[]',
    };
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: 'Ticket 11 A' },
        { id: orgB, name: 'Ticket 11 B' },
      ],
    });
    await prisma.integration.createMany({
      data: [
        {
          ...common,
          id: ids.linkedin,
          internalId: 'synthetic-linkedin-user',
          rootInternalId: 'synthetic-linkedin-user',
          providerIdentifier: 'linkedin',
          name: 'synthetic-linkedin',
          profile: 'synthetic-linkedin',
          token: 'synthetic-linkedin-old',
          refreshToken: 'synthetic-linkedin-refresh-old',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.facebook,
          internalId: 'synthetic-facebook-page',
          rootInternalId: 'synthetic-facebook-page',
          providerIdentifier: 'facebook',
          name: 'synthetic-facebook',
          profile: 'synthetic-facebook',
          token: 'synthetic-facebook-old',
          refreshToken: 'synthetic-facebook-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.instagram,
          internalId: 'synthetic-instagram-user',
          rootInternalId: 'synthetic-instagram-user',
          providerIdentifier: 'instagram',
          name: 'synthetic-instagram',
          profile: 'synthetic-instagram',
          // old single-token format: the whole value is the user token
          token: 'synthetic-instagram-single-token',
          refreshToken: 'synthetic-instagram-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.instagramPageOne,
          internalId: 'synthetic-instagram-page-one',
          rootInternalId: 'synthetic-instagram-user',
          providerIdentifier: 'instagram',
          name: 'synthetic-instagram-page-one',
          profile: 'synthetic-instagram-page-one',
          // old combined format: page token + user token
          token:
            'synthetic-instagram-page-one-token___synthetic-instagram-user-token',
          refreshToken: 'synthetic-instagram-user-refresh',
          tokenExpiration: future(),
        },
        {
          ...common,
          id: ids.instagramPageTwo,
          internalId: 'synthetic-instagram-page-two',
          rootInternalId: 'synthetic-instagram-user',
          providerIdentifier: 'instagram',
          name: 'synthetic-instagram-page-two',
          profile: 'synthetic-instagram-page-two',
          token:
            'synthetic-instagram-page-two-token___synthetic-instagram-user-token',
          refreshToken: 'synthetic-instagram-user-refresh',
          tokenExpiration: future(),
        },
        {
          ...common,
          id: ids.instagramStandalone,
          internalId: 'synthetic-ig-standalone-user',
          rootInternalId: 'synthetic-ig-standalone-user',
          providerIdentifier: 'instagram-standalone',
          name: 'synthetic-ig-standalone',
          profile: 'synthetic-ig-standalone',
          token: 'synthetic-ig-standalone-old',
          refreshToken: 'synthetic-ig-standalone-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.youtube,
          internalId: 'synthetic-youtube-user',
          rootInternalId: 'synthetic-youtube-user',
          providerIdentifier: 'youtube',
          name: 'synthetic-youtube',
          profile: 'synthetic-youtube',
          token: 'synthetic-youtube-old',
          refreshToken: 'synthetic-youtube-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.tiktok,
          internalId: 'synthetic-tiktok-user',
          rootInternalId: 'synthetic-tiktok-user',
          providerIdentifier: 'tiktok',
          name: 'synthetic-tiktok',
          profile: 'synthetic-tiktok',
          token: 'synthetic-tiktok-old',
          refreshToken: 'synthetic-tiktok-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.linkedinPage,
          internalId: 'synthetic-linkedin-page',
          rootInternalId: 'synthetic-linkedin-page-user',
          providerIdentifier: 'linkedin-page',
          name: 'synthetic-linkedin-page',
          profile: 'synthetic-linkedin-page',
          token: 'synthetic-linkedin-page-old',
          refreshToken: 'synthetic-linkedin-page-refresh-old',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.tumblrA,
          internalId: 'synthetic-tumblr-a',
          rootInternalId: 'synthetic-tumblr-a',
          providerIdentifier: 'tumblr',
          name: 'synthetic-tumblr-a',
          profile: 'synthetic-tumblr-a',
          token: 'synthetic-tumblr-a-old',
          refreshToken: 'synthetic-tumblr-a-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          organizationId: orgB,
          id: ids.tumblrB,
          // same account bound in another organization
          internalId: 'synthetic-tumblr-a',
          rootInternalId: 'synthetic-tumblr-a',
          providerIdentifier: 'tumblr',
          name: 'synthetic-tumblr-b',
          profile: 'synthetic-tumblr-b',
          token: 'synthetic-tumblr-b-old',
          refreshToken: 'synthetic-tumblr-b-refresh',
          tokenExpiration: past(),
        },
        {
          ...common,
          id: ids.skool,
          internalId: 'synthetic-skool-user',
          rootInternalId: 'synthetic-skool-user',
          providerIdentifier: 'skool',
          name: 'synthetic-skool',
          profile: 'synthetic-skool',
          token: 'unused',
          refreshToken: '',
          tokenExpiration: future(),
          customInstanceDetails: AuthService.signJWT({
            client_id: 'synthetic-skool-client',
            auth_token: 'synthetic-skool-legacy-token',
          }),
        },
      ],
    });
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'ticket-11-database-secret';
    prisma = new PrismaClient({ datasourceUrl: ticket11DatabaseUrl });
    await prisma.$connect();
    await seed();

    const encryption = new EncryptionService();
    const forModel = () => new PrismaRepository<any>(prisma as any) as any;
    repository = new IntegrationRepository(
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      encryption
    );

    notifications = [];
    manager = new IntegrationManager();
    youtubeStub = {
      oneTimeToken: false,
      refreshToken: async () => ({
        id: 'synthetic-youtube-user',
        name: 'synthetic-youtube',
        accessToken: 'synthetic-youtube-access',
        refreshToken: 'synthetic-youtube-refresh-new',
        expiresIn: 3600,
        picture: '',
        username: 'synthetic-youtube',
      }),
    };
    const realGet = manager.getSocialIntegration.bind(manager);
    manager.getSocialIntegration = ((identifier: string) =>
      identifier === 'youtube'
        ? youtubeStub
        : realGet(identifier)) as any;

    service = new IntegrationService(
      repository,
      {} as any,
      manager,
      {
        inAppNotification: async (
          orgId: string,
          subject: string,
          message: string
        ) => {
          notifications.push({ orgId, subject, message });
        },
      } as any,
      {} as any,
      {} as any,
      encryption
    );
    refresh = new RefreshIntegrationService(manager, service, {} as any);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.integration.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const raw = (id: string) =>
    prisma.integration.findUniqueOrThrow({ where: { id } });

  it('lists every old binding from the repository, page and public API without credentials', async () => {
    const rows = await repository.getIntegrationsList(orgA);
    expect(rows).toHaveLength(11);
    expect(new Set(rows.map((entry) => entry.id))).toEqual(
      new Set(Object.values(ids).filter((id) => id !== ids.tumblrB))
    );
    for (const row of rows as any[]) {
      expect('token' in row).toBe(false);
      expect('refreshToken' in row).toBe(false);
    }
    expect(
      rows.find((entry) => entry.id === ids.instagramPageOne)
    ).toMatchObject({
      organizationId: orgA,
      internalId: 'synthetic-instagram-page-one',
      rootInternalId: 'synthetic-instagram-user',
      providerIdentifier: 'instagram',
    });

    const publicController = new PublicIntegrationsController(
      service,
      {} as any,
      {} as any,
      {} as any,
      manager,
      refresh,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const publicList = await publicController.listIntegration({ id: orgA } as any);
    expect(publicList).toHaveLength(11);
    expect(publicList.find((entry: any) => entry.id === ids.linkedinPage)).toMatchObject({
      identifier: 'linkedin-page',
      profile: 'synthetic-linkedin-page',
      disabled: false,
    });
    expect(JSON.stringify(publicList)).not.toContain('synthetic-linkedin-old');
    expect(JSON.stringify(publicList)).not.toContain('refresh_token');

    const dashboard = new IntegrationsController(
      manager,
      service,
      {} as any,
      refresh
    );
    const dashboardList = await dashboard.getIntegrationList({
      id: orgA,
    } as any);
    expect(dashboardList.integrations).toHaveLength(11);
    expect(
      dashboardList.integrations.find(
        (entry: any) => entry.id === ids.instagramPageTwo
      )
    ).toMatchObject({
      internalId: 'synthetic-instagram-page-two',
      identifier: 'instagram',
      refreshNeeded: false,
    });
    expect(JSON.stringify(dashboardList)).not.toContain(
      'synthetic-instagram-page-two-token'
    );
  });

  it('refreshes the six dashboard channels, pages and history, and keeps going after a failure', async () => {
    const calls = installPlatformDouble();

    // `refreshTokens` deliberately scans every expiring channel in the
    // database, not just this organization. Other suites may have left live
    // rows behind, so keep them out of this pass and restore them afterwards.
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const others = await prisma.integration.findMany({
      where: { organizationId: { notIn: [orgA, orgB] } },
      select: { id: true, tokenExpiration: true },
    });
    await prisma.integration.updateMany({
      where: { organizationId: { notIn: [orgA, orgB] } },
      data: { tokenExpiration: farFuture },
    });

    try {
      await service.refreshTokens();
    } finally {
      for (const other of others) {
        await prisma.integration.update({
          where: { id: other.id },
          data: { tokenExpiration: other.tokenExpiration },
        });
      }
    }

    expect((await raw(ids.linkedin)).token).toBe('synthetic-linkedin-access');
    expect((await raw(ids.tiktok)).token).toBe('synthetic-tiktok-access');
    expect((await raw(ids.instagramStandalone)).token).toBe(
      'synthetic-ig-standalone-access'
    );
    expect((await raw(ids.youtube)).token).toBe('synthetic-youtube-access');
    expect((await raw(ids.linkedinPage)).token).toBe(
      'synthetic-linkedin-page-access'
    );
    expect((await raw(ids.tumblrA)).token).toBe('synthetic-tumblr-a-access');
    expect((await raw(ids.tumblrB)).token).toBe('synthetic-tumblr-b-access');

    // the two providers with no self-refresh report a reconnect instead of
    // storing an empty token
    expect(await raw(ids.facebook)).toMatchObject({
      token: 'synthetic-facebook-old',
      refreshNeeded: true,
    });
    expect(await raw(ids.instagram)).toMatchObject({
      token: 'synthetic-instagram-single-token',
      refreshNeeded: true,
    });

    // untouched rows keep their exact association and credential
    expect(await raw(ids.skool)).toMatchObject({
      token: 'unused',
      customInstanceDetails: expect.any(String),
      internalId: 'synthetic-skool-user',
    });
    expect(await raw(ids.instagramPageOne)).toMatchObject({
      token:
        'synthetic-instagram-page-one-token___synthetic-instagram-user-token',
      rootInternalId: 'synthetic-instagram-user',
    });
    expect(await raw(ids.instagramPageTwo)).toMatchObject({
      token:
        'synthetic-instagram-page-two-token___synthetic-instagram-user-token',
      rootInternalId: 'synthetic-instagram-user',
    });

    // a failed channel did not stop the rest of the batch
    expect(calls.some((call) => call.host === 'open.tiktokapis.com')).toBe(true);
    expect(calls.some((call) => call.host === 'graph.instagram.com')).toBe(true);
    expect(calls.filter((call) => call.host === 'api.tumblr.com').length).toBeGreaterThan(
      2
    );
    expect(notifications).toHaveLength(2);
    expect(notifications.map((entry) => entry.subject).join(' ')).toContain(
      'facebook'
    );
    expect(notifications.map((entry) => entry.subject).join(' ')).toContain(
      'instagram'
    );

    const linkedin = await repository.getIntegrationById(orgA, ids.linkedin);
    expect(linkedin.token).toBe('synthetic-linkedin-access');
    expect(linkedin.tokenExpiration!.getTime()).toBeGreaterThan(Date.now());
    expect(linkedin.internalId).toBe('synthetic-linkedin-user');
  });

  it('persists a reconnect of an old page into PostgreSQL without moving the root', async () => {
    const state = `ticket11-reconnect-${pid}`;
    await ioRedis.set(`login:${state}`, 'verifier');
    await ioRedis.set(`organization:${state}`, orgA);
    await ioRedis.set(`refresh:${state}`, 'synthetic-instagram-page-one');

    const provider = {
      isBetweenSteps: false,
      authenticate: async () => ({
        id: 'synthetic-instagram-user',
        accessToken: 'synthetic-reconnected-user-token',
        refreshToken: 'synthetic-reconnected-refresh',
        expiresIn: 3600,
        name: 'Synthetic Instagram',
        picture: '',
        username: 'synthetic-instagram',
      }),
      reConnect: async (
        rootInternalId: string,
        internalId: string,
        token: string
      ) => {
        expect(rootInternalId).toBe('synthetic-instagram-user');
        expect(internalId).toBe('synthetic-instagram-page-one');
        expect(token).toBe('synthetic-reconnected-user-token');
        return {
          id: internalId,
          name: 'Synthetic Instagram page one',
          accessToken:
            'synthetic-reconnected-page-token___synthetic-reconnected-user-token',
          picture: '',
          username: 'synthetic-instagram-page-one',
        };
      },
    };
    const controller = new NoAuthIntegrationsController(
      {
        getAllowedSocialsIntegrations: () => ['instagram'],
        getSocialIntegration: () => provider,
      } as any,
      service,
      refresh,
      {
        getOrgById: async () => ({
          id: orgA,
          isTrailing: false,
          apiKey: 'synthetic-key',
        }),
      } as any,
      {} as any
    );

    await controller.connectSocialMedia('instagram', {
      state,
      code: 'synthetic-authorization-code',
      timezone: '0',
      refresh: 'synthetic-instagram-page-one',
    } as any);

    const page = await raw(ids.instagramPageOne);
    expect(page).toMatchObject({
      organizationId: orgA,
      internalId: 'synthetic-instagram-page-one',
      rootInternalId: 'synthetic-instagram-user',
      token:
        'synthetic-reconnected-page-token___synthetic-reconnected-user-token',
      refreshToken: 'synthetic-reconnected-refresh',
    });
    expect(page.tokenExpiration!.getTime()).toBeGreaterThan(Date.now());

    const rootRow = await raw(ids.instagram);
    expect(rootRow).toMatchObject({
      internalId: 'synthetic-instagram-user',
      token: 'synthetic-instagram-single-token',
    });
    expect((await raw(ids.tumblrB)).organizationId).toBe(orgB);
  });

  it('refreshes two pages of one account into their own rows and keeps the root untouched', async () => {
    const pageProvider = {
      oneTimeToken: false,
      refreshToken: async () => ({
        accessToken: 'synthetic-page-user-token',
        refreshToken: 'synthetic-page-user-refresh',
        expiresIn: 3600,
      }),
      reConnect: async (
        rootInternalId: string,
        internalId: string,
        token: string
      ) => ({
        id: internalId,
        name: internalId,
        accessToken: `synthetic-wn-${internalId}`,
        picture: '',
        username: internalId,
      }),
    };
    const pageRefresh = new RefreshIntegrationService(
      { getSocialIntegration: () => pageProvider } as any,
      service,
      {} as any
    );
    const beforeRoot = await raw(ids.instagram);

    const pageOne = await repository.getIntegrationById(orgA, ids.instagramPageOne);
    const pageTwo = await repository.getIntegrationById(orgA, ids.instagramPageTwo);
    await pageRefresh.refresh(pageOne as any);
    await pageRefresh.refresh(pageTwo as any);

    expect(await raw(ids.instagramPageOne)).toMatchObject({
      token: 'synthetic-wn-synthetic-instagram-page-one',
      refreshToken: 'synthetic-page-user-refresh',
      rootInternalId: 'synthetic-instagram-user',
    });
    expect(await raw(ids.instagramPageTwo)).toMatchObject({
      token: 'synthetic-wn-synthetic-instagram-page-two',
      refreshToken: 'synthetic-page-user-refresh',
      rootInternalId: 'synthetic-instagram-user',
    });
    expect(await raw(ids.instagram)).toMatchObject({
      token: beforeRoot.token,
      refreshNeeded: beforeRoot.refreshNeeded,
    });
  });

  it('reuses the winning concurrent rotation and publishes the next Tumblr post with it', async () => {
    await prisma.integration.update({
      where: { id: ids.tumblrA },
      data: {
        token: 'synthetic-tumblr-a-old',
        refreshToken: 'synthetic-tumblr-a-refresh',
        tokenExpiration: past(),
        refreshNeeded: false,
      },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let first = true;

    const calls = installPlatformDouble({
      onTumblrToken: async () => {
        if (first) {
          first = false;
          started();
          await gate;
          return {
            access_token: 'synthetic-tumblr-winner-access',
            refresh_token: 'synthetic-tumblr-winner-refresh',
            expires_in: 3600,
          };
        }
        throw new Error('invalid_grant');
      },
    });

    const one = await repository.getIntegrationById(orgA, ids.tumblrA);
    const two = await repository.getIntegrationById(orgA, ids.tumblrA);
    const firstRefresh = refresh.refresh({ ...one } as any);
    await firstStarted;
    const secondRefresh = refresh.refresh({ ...two } as any);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    const results = await Promise.all([firstRefresh, secondRefresh]);
    expect(results.filter(Boolean)).toHaveLength(2);

    const stored = await raw(ids.tumblrA);
    expect(stored).toMatchObject({
      token: 'synthetic-tumblr-winner-access',
      refreshToken: 'synthetic-tumblr-winner-refresh',
      refreshNeeded: false,
      internalId: 'synthetic-tumblr-a',
      organizationId: orgA,
    });

    const tumblr = new TumblrProvider();
    const [published] = await tumblr.post(
      stored.internalId,
      stored.token,
      [
        {
          id: 'ticket11-tumblr-post',
          message: 'synthetic concurrent publish',
          settings: {},
          media: [],
        } as any,
      ],
      stored as any
    );
    expect(published).toMatchObject({
      postId: 'synthetic-tumblr-post',
      releaseURL: 'https://www.tumblr.com/synthetic-tumblr-a/synthetic-tumblr-post',
    });
    const postCall = calls.find(
      (call) => call.host === 'api.tumblr.com' && call.path.includes('/posts')
    )!;
    expect(postCall.authorization).toBe(
      'Bearer synthetic-tumblr-winner-access'
    );
  });

  it('publishes the old Instagram combined token and the old Skool JWT through the provider', async () => {
    await prisma.integration.update({
      where: { id: ids.instagramPageOne },
      data: {
        token:
          'synthetic-instagram-page-one-token___synthetic-instagram-user-token',
        refreshToken: 'synthetic-instagram-user-refresh',
        tokenExpiration: future(),
        refreshNeeded: false,
      },
    });
    const calls = installPlatformDouble();
    const instagram = await raw(ids.instagramPageOne);
    const provider = new InstagramProvider();

    const [pending] = await provider.postPending(
      instagram.internalId,
      instagram.token,
      [
        {
          id: 'ticket11-instagram-post',
          message: 'synthetic instagram publish',
          settings: { post_type: 'post' },
          media: [{ path: 'https://media.invalid/ticket11.jpg' }],
        } as any,
      ],
      instagram as any
    );
    const checked = await provider.checkPostStatus(
      instagram.token,
      pending.pendingData,
      instagram as any
    );
    const finalized = await provider.finalizePost(
      instagram.token,
      checked.pendingData,
      instagram as any
    );
    expect(finalized).toMatchObject({
      status: 'completed',
      postId: 'synthetic-instagram-media',
    });

    const mediaCreate = calls.find(
      (call) =>
        call.host === 'graph.facebook.com' &&
        call.path.includes('/synthetic-instagram-page-one/media')
    )!;
    expect(mediaCreate.method).toBe('POST');
    expect(mediaCreate.path).toContain('/synthetic-instagram-page-one/media');
    const [pageHalf, userHalf] = instagram.token.split('___');
    expect(pageHalf).toBeTruthy();
    // the double saw the page half when it created the container
    expect(mediaCreate.search).toContain(`access_token=${pageHalf}`);
    expect(mediaCreate.search).not.toContain('___');
    expect(mediaCreate.search).not.toContain(userHalf);

    const containerStatus = calls.find(
      (call) =>
        call.host === 'graph.facebook.com' &&
        call.path.endsWith('/synthetic-instagram-container')
    )!;
    // reading the container is an account-level operation: user half only
    expect(containerStatus.search).toContain(`access_token=${userHalf}`);

    const publish = calls.find(
      (call) =>
        call.host === 'graph.facebook.com' &&
        call.path.includes('/synthetic-instagram-page-one/media_publish')
    )!;
    expect(publish.search).toContain(`access_token=${pageHalf}`);
    expect(publish.search).not.toContain('___');

    const skoolRow = await raw(ids.skool);
    const skool = new SkoolProvider();
    const [skoolPost] = await skool.post(
      skoolRow.internalId,
      'unused',
      [
        {
          id: 'ticket11-skool-post',
          message: 'synthetic skool publish',
          settings: { group: 'synthetic-group', title: 'Synthetic', label: 'none' },
          media: [],
        } as any,
      ],
      skoolRow as any
    );
    expect(skoolPost).toMatchObject({
      postId: 'synthetic-skool-post',
      releaseURL: 'https://www.skool.com/synthetic-group/welcome',
    });
    const skoolCall = calls.find((call) => call.host === 'api2.skool.com')!;
    expect(skoolCall.cookie).toBe(
      'auth_token=synthetic-skool-legacy-token; client_id=synthetic-skool-client'
    );
  });
});
