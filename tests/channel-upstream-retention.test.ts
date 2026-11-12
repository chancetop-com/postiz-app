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
