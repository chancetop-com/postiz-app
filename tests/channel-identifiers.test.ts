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
  it('keeps hidden providers available for listing and connection', async () => {
    const manager = new IntegrationManager();
    const { social } = await manager.getAllIntegrations();
    const expectedProviders = expect.arrayContaining([
      'linkedin-page', 'tiktok-business', 'tumblr', 'bluesky', 'x',
    ]);
    expect(social.map((provider) => provider.identifier)).toEqual(expectedProviders);
    expect(manager.getAllowedSocialsIntegrations()).toEqual(expectedProviders);
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
