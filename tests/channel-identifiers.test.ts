import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_ADD_CHANNEL_IDENTIFIERS,
  isAllowedAddChannel,
} from '@gitroom/frontend/components/launches/allowed.channels';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';

/**
 * Ticket 07: the add-channel surface offers exactly the six agreed identifiers
 * and nothing else. The match is by identifier, never by display name or
 * platform family: `tiktok-business` is also called "TikTok" and
 * `linkedin-page` is also "LinkedIn".
 *
 * Hiding an entry is a frontend list decision only. The providers themselves,
 * their registration, their routes and the existing bindings stay intact.
 */

const CONTRACT = [
  'youtube',
  'linkedin',
  'tiktok',
  'facebook',
  'instagram',
  'instagram-standalone',
];

const SOURCE_ROOT = path.resolve(import.meta.dirname, '../apps/frontend/src');
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) =>
  readFileSync(path.resolve(SOURCE_ROOT, relative), 'utf8');

describe('the add-channel identifier contract', () => {
  it('is exactly the six agreed identifiers, in the agreed order', () => {
    expect([...ALLOWED_ADD_CHANNEL_IDENTIFIERS]).toEqual(CONTRACT);
  });

  it('matches by exact identifier, not by prefix or family', () => {
    for (const identifier of CONTRACT) {
      expect(isAllowedAddChannel(identifier)).toBe(true);
    }
    for (const identifier of [
      'linkedin-page',
      'tiktok-business',
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

  it('still registers every hidden provider and every agreed one', () => {
    expect(registered).toEqual(
      expect.arrayContaining([
        ...CONTRACT,
        'linkedin-page',
        'tiktok-business',
        'tumblr',
      ])
    );
  });

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

  it('keeps every provider in the post editor provider map', () => {
    const providers = read(
      'components/new-launch/providers/show.all.providers.tsx'
    );
    for (const identifier of ['linkedin-page', 'tiktok-business', 'tumblr']) {
      expect(providers).toContain(`identifier: '${identifier}'`);
    }
  });
});
