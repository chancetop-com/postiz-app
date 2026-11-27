import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const schemaPath = path.resolve(
  import.meta.dirname,
  '../libraries/nestjs-libraries/src/database/prisma/schema.prisma'
);
const schema = readFileSync(schemaPath, 'utf8');

it('generates an upgrade without dropping pre-merge tables', () => {
  const previousSchema = path.resolve(
    import.meta.dirname,
    '../.scratch/postiz-stable-merge-implementation/rehearsals/03/old-schema.prisma'
  );
  const sql = execFileSync(
    'pnpm',
    [
      'exec', 'prisma', 'migrate', 'diff', '--script',
      '--from-schema-datamodel', previousSchema,
      '--to-schema-datamodel', schemaPath,
    ],
    { encoding: 'utf8' }
  );
  expect(sql.match(/^DROP TABLE\b.*$/gim) ?? []).toEqual([]);
});

const models = new Map<string, string>();
for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  models.set(match[1], match[2]);
}

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
});
