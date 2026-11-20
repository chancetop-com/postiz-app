import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';

/**
 * Ticket 06: public connect links.
 *
 * The API and MCP issue a one-hour link for any platform the upstream
 * eligibility allows, including platforms outside the dashboard's six entries.
 * The signing organisation lives in the link, not in the browser that opens it.
 * Opening the page is read-only; only pressing continue creates OAuth state.
 */

const redis = vi.hoisted(() => {
  const store = new Map<string, { value: string; ex?: string; ttl?: number }>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    set: vi.fn(
      async (key: string, value: string, ex?: string, ttl?: number) => {
        store.set(key, { value, ex, ttl });
        return 'OK';
      }
    ),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
});

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redis,
}));

import { ConnectLinkRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/connect.link.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationConnectTool } from '@gitroom/nestjs-libraries/chat/tools/integration.connect.tool';
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';

const SIX = [
  'youtube',
  'linkedin',
  'tiktok',
  'facebook',
  'instagram',
  'instagram-standalone',
];

const OUTSIDE_SIX = ['x', 'reddit', 'linkedin-page', 'threads', 'pinterest'];

const repository = () => ({
  createOrUpdateIntegration: vi.fn(),
  getIntegrationById: vi.fn(),
});

const provider = () => {
  let sequence = 0;
  return {
    identifier: 'x',
    name: 'X',
    generateAuthUrl: vi.fn(async () => {
      sequence++;
      return {
        url: `https://platform.example/oauth?state=state-${sequence}`,
        codeVerifier: `verifier-${sequence}`,
        state: `state-${sequence}`,
      };
    }),
  };
};

const manager = (linkable: string[]) => {
  const platform = provider();
  return {
    getAllowedSocialsIntegrations: () => linkable,
    getLinkableSocialsIntegrations: () => linkable,
    isHiddenProvider: () => false,
    getSocialIntegration: () => platform,
  } as any;
};

const service = (
  linkable: string[] = ['x', 'youtube'],
  repo = repository()
) =>
  new IntegrationService(
    repo as any,
    {} as any,
    manager(linkable),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new ConnectLinkRepository()
  );

const create = (
  instance: IntegrationService,
  integration = 'x',
  redirectUrl?: string
) => instance.createConnectLink('org-a', integration, redirectUrl);

beforeEach(() => {
  redis.store.clear();
  redis.get.mockClear();
  redis.set.mockClear();
  redis.del.mockClear();
  process.env.FRONTEND_URL = 'https://postiz.example';
  delete process.env.HIDDEN_PROVIDERS;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FRONTEND_URL;
  delete process.env.HIDDEN_PROVIDERS;
});

describe('upstream eligibility', () => {
  it('can link every dashboard platform', () => {
    const linkable = new IntegrationManager().getLinkableSocialsIntegrations();
    expect(linkable).toEqual(expect.arrayContaining(SIX));
  });

  it('can link eligible platforms outside the dashboard six', () => {
    const linkable = new IntegrationManager().getLinkableSocialsIntegrations();
    expect(linkable).toEqual(expect.arrayContaining(OUTSIDE_SIX));
  });

  it('refuses platforms that need fields, an instance, web3 or an extension', () => {
    const linkable = new IntegrationManager().getLinkableSocialsIntegrations();

    for (const identifier of [
      'bluesky',
      'devto',
      'medium',
      'wordpress',
      'nostr',
      'lemmy',
      'telegram',
      'wrapcast',
      'skool',
      'mastodon-custom',
      'unknown-platform',
    ]) {
      expect(linkable, identifier).not.toContain(identifier);
    }
  });

  it('follows HIDDEN_PROVIDERS', () => {
    process.env.HIDDEN_PROVIDERS = 'tiktok';
    const linkable = new IntegrationManager().getLinkableSocialsIntegrations();
    expect(linkable).not.toContain('tiktok');
    expect(linkable).toContain('x');
  });
});

describe('link creation', () => {
  it('issues a one-hour link for a platform outside the dashboard six', async () => {
    const result = await create(
      service(),
      'x',
      'https://merchant.example/done?keep=1&lang=en'
    );

    expect(result.url).toMatch(
      /^https:\/\/postiz\.example\/integrations\/connect\/[a-f0-9]{64}$/
    );
    const token = result.url.split('/').pop()!;
    expect(redis.set).toHaveBeenCalledWith(
      `connectLink:${token}`,
      JSON.stringify({
        org: 'org-a',
        integration: 'x',
        redirectUrl: 'https://merchant.example/done?keep=1&lang=en',
        redirectTo: 'merchant.example',
      }),
      'EX',
      3600
    );
  });

  it('issues a link for a dashboard platform too', async () => {
    const result = await create(service(['youtube']), 'youtube');
    expect(result.url).toContain('/integrations/connect/');
  });

  it('refuses a platform that cannot be linked', async () => {
    await expect(create(service([]), 'devto')).rejects.toMatchObject({
      status: 400,
    });
    await expect(create(service([]), 'unknown-platform')).rejects.toMatchObject(
      { status: 400 }
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('refuses a redirect URL with a fragment or without http(s)', async () => {
    const instance = service();
    for (const redirectUrl of [
      'https://merchant.example/done#step',
      'ftp://merchant.example/done',
      'merchant.example/done',
    ]) {
      await expect(create(instance, 'x', redirectUrl)).rejects.toBeInstanceOf(
        HttpException
      );
    }
  });
});

describe('reading the link', () => {
  it('shows only the platform and the return host, never the signing organisation', async () => {
    const instance = service();
    const { url } = await create(
      instance,
      'x',
      'https://merchant.example/done?keep=1'
    );
    const token = url.split('/').pop()!;

    const details = await instance.getConnectLink(token);
    expect(details).toEqual({
      identifier: 'x',
      name: 'X',
      redirectTo: 'merchant.example',
    });
    expect(JSON.stringify(details)).not.toContain('org-a');
    expect(JSON.stringify(details)).not.toContain('keep=1');
  });

  it('rejects a missing or expired token', async () => {
    const instance = service();
    const { url } = await create(instance, 'x');
    const token = url.split('/').pop()!;

    expect(await instance.getConnectLinkOrganization(token)).toBe('org-a');
    redis.store.clear();

    await expect(instance.getConnectLink(token)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      instance.getConnectLinkOrganization(token)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('start and retry', () => {
  it('writes the signing organisation into each state and keeps the link for a retry', async () => {
    const instance = service();
    const { url } = await create(
      instance,
      'x',
      'https://merchant.example/done?keep=1'
    );
    const token = url.split('/').pop()!;
    const before = redis.store.get(`connectLink:${token}`)?.value;

    const first = await instance.startConnectLink(token);
    const second = await instance.startConnectLink(token);

    expect(first.url).toBe('https://platform.example/oauth?state=state-1');
    expect(second.url).toBe('https://platform.example/oauth?state=state-2');
    for (const n of [1, 2]) {
      expect(
        JSON.parse(redis.store.get(`connectOAuth:state-${n}`)!.value)
      ).toEqual({ token, codeVerifier: `verifier-${n}` });
    }
    // retrying inside the hour does not consume the link
    expect(redis.store.get(`connectLink:${token}`)?.value).toBe(before);
  });

  it('does not write a binding when the page is opened or continue is pressed', async () => {
    const repo = repository();
    const instance = service(['x'], repo);
    const { url } = await create(instance, 'x');
    const token = url.split('/').pop()!;

    await instance.getConnectLink(token);
    await instance.startConnectLink(token);

    expect(repo.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});

describe('the provider callback', () => {
  const providerForCallback = () => ({
    identifier: 'tiktok',
    name: 'TikTok',
    isBetweenSteps: false,
    isChromeExtension: false,
    oneTimeToken: false,
    authenticate: vi.fn(async () => ({
      id: 'platform-1',
      name: 'My channel',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      username: 'mychannel',
      picture: 'https://merchant.example/picture.png',
      additionalSettings: [],
    })),
  });

  const controller = (integrationService: any) =>
    new NoAuthIntegrationsController(
      {
        getAllowedSocialsIntegrations: () => ['tiktok'],
        getSocialIntegration: () => providerForCallback(),
      } as any,
      { claimConnectAuthorization: async () => undefined, ...integrationService },
      { startRefreshWorkflow: vi.fn(async () => undefined) } as any,
      {
        getOrgById: vi.fn(async () => ({ id: 'org-a', isTrailing: false })),
      } as any,
      {} as any
    );

  const callbackState = () => {
    redis.store.set('login:state-1', { value: 'verifier' });
    redis.store.set('organization:state-1', { value: 'org-a' });
    redis.store.set('redirect:state-1', {
      value: 'https://merchant.example/done?keep=1',
    });
  };

  it('writes the binding into the organisation that signed the link', async () => {
    callbackState();
    const integrationService = {
      checkPreviousConnections: vi.fn(async () => false),
      migrateIntegrationOnConnect: vi.fn(async () => undefined),
      createOrUpdateIntegration: vi.fn(async () => ({ id: 'integration-1' })),
    };

    const result = await controller(integrationService).connectSocialMedia(
      'tiktok',
      { state: 'state-1', code: 'code-1', timezone: 0 } as any
    );

    expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(
      1
    );
    const args =
      integrationService.createOrUpdateIntegration.mock.calls[0];
    // additionalSettings, oneTimeToken, organisation, ...
    expect(args[2]).toBe('org-a');
    expect(result).toMatchObject({
      id: 'integration-1',
      returnURL: 'https://merchant.example/done?keep=1',
    });
    // the OAuth state is single-use, the link itself stays valid for a retry
    expect(redis.store.has('login:state-1')).toBe(false);
    expect(redis.store.has('redirect:state-1')).toBe(false);
  });

  it('rejects a state that was never issued or already used', async () => {
    const integrationService = {
      checkPreviousConnections: vi.fn(async () => false),
      migrateIntegrationOnConnect: vi.fn(async () => undefined),
      createOrUpdateIntegration: vi.fn(async () => ({ id: 'integration-1' })),
    };

    await expect(
      controller(integrationService).connectSocialMedia('tiktok', {
        state: 'unknown',
        code: 'code-1',
        timezone: 0,
      } as any)
    ).rejects.toMatchObject({ status: 400 });
    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});

describe('link-bound page selection', () => {
  const setup = async () => {
    const auth = {
      id: 'root',
      name: 'Account',
      username: 'account',
      accessToken: 'root-token',
      refreshToken: 'refresh',
    };
    const platform = {
      ...provider(),
      identifier: 'youtube',
      isBetweenSteps: true,
      authenticate: vi.fn(async () => auth),
      pages: vi.fn(async () => [
        { id: 'page-1', name: 'One', access_token: 'private' },
      ]),
      fetchPageInformation: vi.fn(async () => ({
        id: 'page-1',
        name: 'One',
        access_token: 'page-token',
        username: 'one',
        picture: '',
      })),
    };
    const mgr = {
      ...manager(['youtube']),
      getSocialIntegration: () => platform,
    };
    const repo = repository();
    repo.createOrUpdateIntegration.mockResolvedValue({ id: 'bound' });
    const refresh = {
      startRefreshWorkflow: vi.fn().mockResolvedValue(undefined),
    };
    const instance = new IntegrationService(
      repo as never,
      {} as never,
      mgr,
      {} as never,
      refresh as never,
      {} as never,
      {
        encrypt: async (s: string) => s,
        decrypt: async (s: string) => s,
      } as never,
      new ConnectLinkRepository()
    );
    const quota = {
      check: async () => ({ can: () => true }),
      channelLimit: async () => undefined,
    };
    const controller = new NoAuthIntegrationsController(
      mgr,
      instance,
      refresh as never,
      { getOrgById: async () => ({ id: 'org-a' }) } as never,
      quota as never
    );
    const returnURL = 'https://merchant.example/done?keep=1';
    const { url } = await create(instance, 'youtube', returnURL);
    const token = url.split('/').pop()!;
    const callback = (state: string, route = 'youtube', code = 'consent') =>
      controller.connectSocialMedia(route, { state, code, timezone: '0' });
    return { token, returnURL, platform, repo, controller, callback };
  };

  it('allows an abandoned chooser to restart and commits only the confirmed page', async () => {
    const { token, repo, controller, callback, platform } = await setup();
    await controller.startConnectLink(token);
    await expect(callback('state-1', 'facebook')).rejects.toMatchObject({
      status: 400,
    });
    expect(platform.authenticate).not.toHaveBeenCalled();
    const first = await callback('state-1');
    expect(first.pages).toEqual([{ id: 'page-1', name: 'One' }]);
    await controller.startConnectLink(token);
    const second = await callback('state-2');
    expect(repo.createOrUpdateIntegration).not.toHaveBeenCalled();
    await expect(
      controller.saveProviderPage(first.id, { state: 'state-2', id: 'page-1' })
    ).rejects.toMatchObject({ status: 400 });
    await controller.saveProviderPage(second.id, {
      state: 'state-2',
      id: 'page-1',
    });
    expect(repo.createOrUpdateIntegration.mock.calls[0]).toEqual(
      expect.arrayContaining([
        'org-a',
        'page-1',
        'page-token',
        { rootInternalId: 'root', channelLimit: undefined },
      ])
    );
    await expect(
      controller.saveProviderPage(second.id, { state: 'state-2', id: 'page-1' })
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
  });

  it('returns the signed address when the provider has no manageable pages', async () => {
    const { token, returnURL, controller, callback, platform, repo } = await setup();
    platform.pages.mockResolvedValueOnce([]);
    await controller.startConnectLink(token);
    await expect(callback('state-1')).rejects.toMatchObject({ status: 400, response: { returnURL } });
    expect(repo.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('returns the configured address on a cancelled provider callback', async () => {
    const { token, returnURL, controller, callback, platform } = await setup();
    await controller.startConnectLink(token);
    await expect(callback('state-1', 'youtube', '')).rejects.toMatchObject({
      status: 400,
      response: { returnURL },
    });
    expect(platform.authenticate).not.toHaveBeenCalled();
  });
});

describe('the MCP tool', () => {
  const context = () => ({
    requestContext: new Map<string, string>([
      ['organization', JSON.stringify({ id: 'org-a' })],
    ]),
  });

  const realService = () =>
    new IntegrationService(
      repository() as any,
      {} as any,
      new IntegrationManager(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new ConnectLinkRepository()
    );

  it('returns a link for an eligible outside-six platform', async () => {
    const tool = new IntegrationConnectTool(
      realService(),
      new IntegrationManager()
    );

    const result: any = await (tool.run().execute as any)(
      { platform: 'x', redirectUrl: 'https://merchant.example/done?keep=1' },
      context()
    );

    expect(result.output.url).toMatch(/\/integrations\/connect\//);
    const token = result.output.url.split('/').pop()!;
    expect(redis.store.get(`connectLink:${token}`)?.value).toContain('org-a');
  });

  it('returns an error for an unsupported platform instead of a link', async () => {
    const tool = new IntegrationConnectTool(
      realService(),
      new IntegrationManager()
    );

    const result: any = await (tool.run().execute as any)(
      { platform: 'devto' },
      context()
    );

    expect(result.output.errors).toBe(
      'This integration cannot be connected with a link'
    );
    expect(result.output.url).toBeUndefined();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
