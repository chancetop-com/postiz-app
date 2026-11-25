import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isAllowedAddChannel } from '@gitroom/frontend/components/launches/allowed.channels';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';

/**
 * The add-channel surface offers exactly the agreed identifiers
 * and nothing else. Providers in the same platform family have distinct identifiers.
 *
 * Hiding an entry is a frontend list decision only. The providers themselves,
 * their registration, their routes and the existing bindings stay intact.
 */

const CONTRACT = [
  'youtube',
  'linkedin',
  'tiktok',
  'tiktok-business',
  'facebook',
  'instagram',
  'instagram-standalone',
];

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
describe('the add-channel identifier contract', () => {
  it('matches by exact identifier, not by prefix or family', () => {
    const offered = socialIntegrationList
      .map((provider) => provider.identifier)
      .filter(isAllowedAddChannel);
    expect(new Set(offered)).toEqual(new Set(CONTRACT));
    for (const identifier of [
      'linkedin-page',
      'tiktok-business-extra',
      'tumblr',
      'x',
      'devto',
      'instagram-page',
      'youtube-shorts',
      '',
      'LINKEDIN',
    ]) {
      expect(isAllowedAddChannel(identifier)).toBe(false);
    }
  });
});

describe('the hidden providers keep their registration', () => {
  const registered = socialIntegrationList.map((provider) => provider.identifier);

  it('still serves every registered provider through the connect allow-list', () => {
    const manager = new IntegrationManager();
    // `getAllowedSocialsIntegrations` guards POST /integrations/social-connect,
    // so a narrower list here would be a backend disable.
    expect(manager.getAllowedSocialsIntegrations()).toEqual(registered);
  });

  it('still returns hidden providers from GET /integrations', async () => {
    const manager = new IntegrationManager();
    const { social } = await manager.getAllIntegrations();
    const identifiers = social.map((provider: any) => provider.identifier);
    expect(identifiers).toEqual(
      expect.arrayContaining([
        'linkedin-page',
        'tiktok-business',
        'tumblr',
        'bluesky',
        'x',
      ])
    );
  });

  it('does not hide providers by default in the shipped environment example', () => {
    const env = readFileSync(path.resolve(REPO_ROOT, '.env.example'), 'utf8');
    const hidden = env
      .split('\n')
      .filter((line) => /^\s*HIDDEN_PROVIDERS\s*=/.test(line));
    // a commented example is fine, an active one would be a new backend disable
    expect(hidden).toEqual([]);
  });
});
