import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json';

const repoRoot = path.resolve(import.meta.dirname, '..');
const entrypoint = path.join(repoRoot, 'var/docker/entrypoint.sh');

const sandboxes: string[] = [];

afterEach(() => {
  while (sandboxes.length > 0) {
    rmSync(sandboxes.pop() as string, { recursive: true, force: true });
  }
});

/**
 * The container start path is a real process, not just Dockerfile text, so it
 * is exercised with stubbed `pnpm` and a stub application command. The sandbox
 * mirrors the image layout: `<root>/var/docker/entrypoint.sh`, with `pnpm`
 * coming from PATH.
 */
const sandbox = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'postiz-startup-'));
  sandboxes.push(root);
  mkdirSync(path.join(root, 'var/docker'), { recursive: true });
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  copyFileSync(entrypoint, path.join(root, 'var/docker/entrypoint.sh'));

  const log = path.join(root, 'calls.log');
  const write = (name: string, body: string) => {
    const file = path.join(root, 'bin', name);
    writeFileSync(file, body);
    chmodSync(file, 0o755);
    return file;
  };

  write(
    'pnpm',
    [
      '#!/bin/sh',
      'printf \'pnpm %s\\n\' "$*" >> "$STARTUP_LOG"',
      'if [ "$*" = "run prisma-db-push" ]; then',
      '  echo "stub pnpm: sync requested"',
      '  exit "${STUB_SYNC_EXIT:-0}"',
      'fi',
      'echo "stub pnpm: unexpected invocation: $*" >&2',
      'exit 90',
      '',
    ].join('\n')
  );

  const app = write(
    'app',
    [
      '#!/bin/sh',
      'printf \'app %s\\n\' "$*" >> "$STARTUP_LOG"',
      'echo "stub app started"',
      'exit "${STUB_APP_EXIT:-0}"',
      '',
    ].join('\n')
  );

  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(path.join(root, 'var/docker/entrypoint.sh'), args, {
      encoding: 'utf8',
      env: {
        PATH: `${path.join(root, 'bin')}:${process.env.PATH ?? ''}`,
        STARTUP_LOG: log,
        DATABASE_URL: 'postgresql://sync:sync@127.0.0.1:5432/postiz',
        ...env,
      },
    });

  const calls = () =>
    existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];

  return { root, app, run, calls, log };
};

describe('container startup database sync', () => {
  it('runs the official root sync before starting the application', () => {
    const box = sandbox();

    const result = box.run([box.app, '--serve']);

    expect(result.status).toBe(0);
    expect(box.calls()).toEqual(['pnpm run prisma-db-push', 'app --serve']);
    expect(result.stdout).toContain('pnpm run prisma-db-push');
    expect(result.stdout).toContain('stub app started');
  });

  it('stops the container without starting the application when the sync fails', () => {
    const box = sandbox();

    const result = box.run([box.app], { STUB_SYNC_EXIT: '3' });

    expect(result.status).toBe(3);
    expect(box.calls()).toEqual(['pnpm run prisma-db-push']);
    expect(result.stdout).not.toContain('stub app started');
    expect(result.stderr).toMatch(/sync/i);
    expect(result.stderr).toMatch(/refus/i);
  });

  it('serves the deployed GTM script and clears stale assets on failure or disablement', () => {
    const box = sandbox();
    const frontend = path.join(box.root, 'apps/frontend');
    mkdirSync(path.join(frontend, 'scripts'), { recursive: true });
    mkdirSync(path.join(frontend, 'public'));
    copyFileSync(path.join(repoRoot, 'apps/frontend/scripts/fetch-gtm.mjs'),
      path.join(frontend, 'scripts/fetch-gtm.mjs'));
    const asset = path.join(frontend, 'public/g.js');
    writeFileSync(asset, 'workstation');
    const mockFetch = path.join(box.root, 'offline-fetch.mjs');
    writeFileSync(mockFetch, `
      globalThis.fetch = async url => {
        if (url === 'https://www.googletagmanager.com/gtm.js?id=GTM-DEPLOY')
          return new Response('deployment script');
        return new Response(null, { status: 503 });
      };
    `);
    const runtime = { NODE_OPTIONS: `--import=${mockFetch}`, NEXT_PUBLIC_GTM_ID: 'GTM-DEPLOY' };
    expect(box.run([box.app], runtime).status).toBe(0);
    expect(readFileSync(asset, 'utf8')).toBe('deployment script');
    expect(box.run([box.app], { ...runtime, NEXT_PUBLIC_GTM_ID: 'GTM-OTHER' }).status).toBe(0);
    expect(existsSync(asset)).toBe(false);
    writeFileSync(asset, 'previous deployment');
    expect(box.run([box.app]).status).toBe(0);
    expect(existsSync(asset)).toBe(false);
  });

  it('passes the exit code of the application command through', () => {
    const box = sandbox();

    const result = box.run([box.app], { STUB_APP_EXIT: '7' });

    expect(result.status).toBe(7);
    expect(box.calls()).toEqual(['pnpm run prisma-db-push', 'app']);
  });

  it('refuses to run without a command instead of exiting zero', () => {
    const box = sandbox();

    const result = box.run([]);

    expect(result.status).not.toBe(0);
    expect(box.calls()).toEqual([]);
  });
});

it('uses the shared startup entrypoint in the development image', () => {
  const devImage = readFileSync(path.join(repoRoot, 'Dockerfile.dev'), 'utf8');
  expect(devImage).toMatch(/^ENTRYPOINT\s+\[\s*"\/app\/var\/docker\/entrypoint\.sh"\s*\]/m);
});

it.each([
  'Dockerfile.dev',
  'k8s/Dockerfile',
  'k8s/Dockerfile.base',
  'k8s/Dockerfile.deps',
  'k8s/Dockerfile.runtime-deps',
])('%s keeps schema sync out of the image build', (file) => {
  const dockerfile = readFileSync(path.join(repoRoot, file), 'utf8');
  expect(dockerfile).not.toMatch(/prisma\s+db\s+push/);
  if (file !== 'Dockerfile.dev') {
    expect(dockerfile).not.toMatch(/--accept-data-loss|DATABASE_URL=/);
  }
});

describe('root package scripts', () => {
  it('does not enable provider migration for the upgrade', () => {
    const env = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    expect(env).not.toMatch(/^MIGRATE_PROVIDERS=/m);
  });

  it('runs the pinned local Prisma CLI so a runtime image needs no registry access', () => {
    expect(pkg.scripts['prisma-db-push']).not.toContain('pnpm dlx');
    expect(pkg.scripts['prisma-db-push']).toMatch(/^prisma db push /);
    expect(pkg.scripts['prisma-db-push']).toContain(
      'libraries/nestjs-libraries/src/database/prisma/schema.prisma'
    );
  });

  it('generates only the client during install', () => {
    expect(pkg.scripts.postinstall).toContain('prisma-generate');
    expect(pkg.scripts.postinstall).not.toContain('db push');
    expect(pkg.scripts['prisma-generate']).toMatch(/^prisma\s+generate\b/);
    expect(pkg.scripts['prisma-generate']).not.toContain('db push');
  });
});
