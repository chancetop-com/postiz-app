import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const schemaPath = path.resolve(
  import.meta.dirname,
  '../libraries/nestjs-libraries/src/database/prisma/schema.prisma'
);
const schema = readFileSync(schemaPath, 'utf8');

const models = new Map<string, string>();
for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  models.set(match[1], match[2]);
}

/**
 * Every model that existed before the v2.25.3 merge (customization commit
 * 6fdf7cb5) must still be declared. `db push` only adds to the database, so a
 * model that silently disappears from the schema would turn a later sync into a
 * drop. This list is the guard, not the absence of a delete statement.
 */
const BASELINE_MODELS = [
  'Organization',
  'Tags',
  'TagsPosts',
  'User',
  'UsedCodes',
  'UserOrganization',
  'GitHub',
  'Trending',
  'TrendingLog',
  'ItemUser',
  'Star',
  'Media',
  'SocialMediaAgency',
  'SocialMediaAgencyNiche',
  'Credits',
  'Subscription',
  'Customer',
  'Integration',
  'Signatures',
  'Comments',
  'Post',
  'Notifications',
  'MessagesGroup',
  'PayoutProblems',
  'Orders',
  'OrderItems',
  'Messages',
  'Plugs',
  'ExisingPlugData',
  'PopularPosts',
  'IntegrationsWebhooks',
  'Webhooks',
  'AutoPost',
  'Sets',
  'ThirdParty',
  'Errors',
  'Mentions',
  'mastra_ai_spans',
  'mastra_evals',
  'mastra_messages',
  'mastra_resources',
  'mastra_scorers',
  'mastra_threads',
  'mastra_traces',
  'mastra_workflow_snapshot',
  'OAuthApp',
  'OAuthAuthorization',
  'Announcement',
];

describe('prisma schema keeps the pre-merge models', () => {
  it.each(BASELINE_MODELS)('still declares %s', (model) => {
    expect(models.has(model)).toBe(true);
  });
});

describe('new columns default the way existing rows need them', () => {
  const field = (model: string, name: string) => {
    const body = models.get(model);
    expect(body, `model ${model} is missing`).toBeDefined();
    const line = new RegExp(`^\\s+${name}\\s+.*$`, 'm').exec(body as string);
    expect(line, `field ${model}.${name} is missing`).toBeTruthy();
    return (line as RegExpExecArray)[0];
  };

  it('adds a nullable soft delete to organizations', () => {
    expect(field('Organization', 'deletedAt')).toMatch(/DateTime\?/);
    expect(field('User', 'deletedAt')).toMatch(/DateTime\?/);
  });

  it('keeps an empty IANA timezone instead of guessing one', () => {
    expect(field('User', 'timezoneName')).toMatch(/String\?/);
  });

  it('marks existing media as ready', () => {
    expect(field('Media', 'status')).toContain('@default("ready")');
    expect(field('Media', 'processingError')).toMatch(/String\?/);
  });

  it('marks existing subscriptions as stripe', () => {
    expect(field('Subscription', 'provider')).toContain('@default("stripe")');
  });

  it('leaves the creation method of old posts unknown', () => {
    expect(field('Post', 'creationMethod')).toContain('@default(UNKNOWN)');
    expect(field('Post', 'batchId')).toMatch(/String\?/);
  });

  it('keeps static OAuth applications static', () => {
    expect(field('OAuthApp', 'dynamic')).toContain('@default(false)');
    expect(field('OAuthApp', 'organizationId')).toMatch(/String\?/);
    expect(field('OAuthApp', 'clientSecret')).toMatch(/String\?/);
  });

  it('adds the clippings relation without changing channel credentials', () => {
    expect(field('Integration', 'internalId')).toMatch(/String\b/);
    expect(field('Integration', 'rootInternalId')).toMatch(/String\?/);
    expect(field('Integration', 'token')).toMatch(/String\b/);
    expect(field('Integration', 'refreshToken')).toMatch(/String\?/);
    expect(field('Integration', 'tokenExpiration')).toMatch(/DateTime\?/);
  });
});
