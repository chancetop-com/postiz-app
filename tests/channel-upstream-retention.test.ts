import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Ticket 07: the upstream behaviour this merge absorbs, and the parts of the
 * two customisation commits the six-entry list must not remove.
 *
 * These are structural guards: they assert control flow exists (a 402 stops
 * before the body is parsed, reconnects use the current window) rather than
 * re-testing the browser flows that `channel-add-flow` and
 * `channel-connect-callback` cover.
 */

const FRONTEND = path.resolve(import.meta.dirname, '../apps/frontend/src');
const BACKEND = path.resolve(import.meta.dirname, '../apps/backend/src');
const read = (root: string, relative: string) =>
  readFileSync(path.resolve(root, relative), 'utf8');

const addProvider = read(
  FRONTEND,
  'components/launches/add.provider.component.tsx'
);
const continueIntegration = read(
  FRONTEND,
  'components/launches/continue.integration.tsx'
);
const launches = read(FRONTEND, 'components/launches/launches.component.tsx');

describe('402 stops the add flow before it parses or authorises', () => {
  it('guards every connect request in the add dialog', () => {
    const sites = [
      ...addProvider.matchAll(/const response = await fetch\(\n/g),
    ].map((match) => match.index!);

    // ordinary OAuth, Web3, chrome extension and account/key custom fields
    expect(sites).toHaveLength(4);

    for (const site of sites) {
      const nextJson = addProvider.indexOf('response.json()', site);
      const stop = addProvider.indexOf(
        'if (response.status === 402)',
        site
      );
      expect(nextJson).toBeGreaterThan(site);
      expect(stop).toBeGreaterThan(site);
      expect(stop).toBeLessThan(nextJson);
    }
  });
});

describe('the customisation commits keep their behaviour', () => {
  it('encodes the Web3 code before putting it in the connect URL', () => {
    expect(addProvider).toContain(
      'code=${encodeURIComponent(code)}&state=${newState}'
    );
  });

  it('checks that the browser extension exists before calling it', () => {
    expect(addProvider).toContain("typeof chrome === 'undefined'");
    expect(addProvider).toContain('chrome.runtime.lastError');
    expect(continueIntegration).toContain('chrome.runtime.lastError');
  });
});

describe('reconnecting an existing channel', () => {
  const reconnect = launches.slice(
    launches.indexOf('const refreshChannel'),
    launches.indexOf('useEffect(() => {', launches.indexOf('const refreshChannel'))
  );

  it('asks the backend for the refresh URL of that integration', () => {
    expect(reconnect).toContain(
      '`/integrations/social/${integration.identifier}?refresh=${integration.internalId}`'
    );
  });

  it('navigates the current window instead of opening a popup', () => {
    expect(reconnect).toContain('window.location.href = url;');
    expect(reconnect).not.toContain('window.open');
  });

  it('keeps the account/key form for custom-field providers', () => {
    expect(reconnect).toContain('integration.isCustomFields');
    expect(reconnect).toContain('<CustomVariables');
  });

  it('is backed by a binding list that marks custom-field providers', () => {
    const controller = read(BACKEND, 'api/routes/integrations.controller.ts');
    expect(controller).toContain('isCustomFields: !!findIntegration.customFields');
    expect(controller).toContain('customFields: await findIntegration.customFields()');
  });
});

describe('the callback keeps the upstream provider adaptations', () => {
  it('translates the TikTok Business auth_code parameter', () => {
    expect(continueIntegration).toContain("provider === 'tiktok-business'");
    expect(continueIntegration).toContain('searchParams.auth_code');
  });

  it('still names the new providers on the selection screen', () => {
    expect(continueIntegration).toContain("tumblr: 'Tumblr'");
    expect(continueIntegration).toContain("'tiktok-business': 'TikTok Business'");
    expect(continueIntegration).toContain("'linkedin-page': 'LinkedIn'");
  });
});

describe('public connect links', () => {
  const connectLink = read(FRONTEND, 'components/launches/connect.link.tsx');
  const connectLayout = read(
    FRONTEND,
    'app/(app)/integrations/connect/layout.tsx'
  );
  const publicController = read(
    BACKEND,
    'public-api/routes/v1/public.integrations.controller.ts'
  );
  const connectTool = read(
    path.resolve(import.meta.dirname, '../libraries/nestjs-libraries/src'),
    'chat/tools/integration.connect.tool.ts'
  );

  it('both upstream entry points issue the same link', () => {
    expect(publicController).toContain('createConnectLink(');
    expect(connectTool).toContain('createConnectLink(');
    expect(connectTool).toContain('{ output: { errors: err.message } }');
  });

  it('uses the customized mark on a light surface instead of the upstream dark page', () => {
    expect(connectLink).toContain(
      "import { Logo } from '@gitroom/frontend/components/new-layout/logo'"
    );
    expect(connectLink).toContain('<Logo />');
    expect(connectLink).not.toContain('/postiz.svg');
    expect(connectLayout).toContain('light');
    expect(connectLayout).not.toContain('#0B0A0A');
  });

  it('keeps the query string of a custom return address', () => {
    expect(continueIntegration).toContain("returnURL.includes('?') ? '&' : '?'");
  });
});

describe('the default deployment keeps reading old credentials in plain text', () => {
  const READ_ROOT = path.resolve(
    import.meta.dirname,
    '../libraries/nestjs-libraries/src'
  );
  const encryption = read(READ_ROOT, 'services/encryption.service.ts');
  const repository = read(
    READ_ROOT,
    'database/prisma/integrations/integration.repository.ts'
  );
  const integrationService = read(
    READ_ROOT,
    'database/prisma/integrations/integration.service.ts'
  );
  const refreshService = read(
    READ_ROOT,
    'integrations/refresh.integration.service.ts'
  );
  const publicController = read(
    BACKEND,
    'public-api/routes/v1/public.integrations.controller.ts'
  );
  const dashboardController = read(
    BACKEND,
    'api/routes/integrations.controller.ts'
  );

  it('only encrypts when a provider is configured and refuses an unknown one', () => {
    expect(encryption).toContain("case 'local':");
    expect(encryption).toContain("case 'aws-kms':");
    expect(encryption).toContain('return new EmptyProvider();');
    expect(encryption).toContain('throw new Error(`Unknown encryption provider:');
    // empty provider: encrypt is a pass-through, not an error
    expect(encryption).toContain('if (!this.canEncrypt()) {');
    expect(encryption).toContain('return value;');
    // values written before the option was enabled have no prefix
    expect(encryption).toContain('value.startsWith(ENCRYPTED_PREFIX)');
  });

  it('writes and reads through the service without a prefix in the default path', () => {
    expect(repository).toContain('token = await this._encryptionService.encrypt(token)');
    expect(repository).toContain(
      'refreshToken = await this._encryptionService.encrypt(refreshToken)'
    );
    expect(repository).toContain('this._encryptionService.decryptFields(');
    // the list never selects the two credential columns
    expect(repository).toContain('omit: {');
    expect(repository).toContain('token: true,');
    expect(repository).toContain('refreshToken: true,');
    // an empty refresh token still does not wipe the stored one
    expect(repository).toContain('...(refreshToken ? { refreshToken } : {})');
  });

  it('never leaks a credential through a list response', () => {
    const publicList = publicController.slice(
      publicController.indexOf('async listIntegration('),
      publicController.indexOf("@Get('/social/:integration')")
    );
    expect(publicList).not.toContain('token:');
    expect(publicList).not.toContain('refreshToken');

    const dashboardList = dashboardController.slice(
      dashboardController.indexOf('async getIntegrationList('),
      dashboardController.indexOf("@Post('/function')")
    );
    expect(dashboardList).not.toContain('token: p.token');
    expect(dashboardList).not.toContain('refreshToken: p.refreshToken');
  });

  it('keeps the batch and the per-channel refresh aligned', () => {
    // one failed provider does not end the loop
    expect(integrationService).toContain('continue;');
    expect(integrationService).toContain('reuseParallelRefresh(');
    // notification only when the update actually flipped refreshNeeded
    expect(integrationService).toContain('if (flagged) {');
    // the per-channel path has the same guard
    expect(refreshService).toContain('stored.refreshToken !== integration.refreshToken');
    expect(refreshService).toContain('if (flagged) {');
  });
});
