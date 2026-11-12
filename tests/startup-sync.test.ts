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

  it('never accepts data loss or resets the database', () => {
    const source = readFileSync(entrypoint, 'utf8');

    expect(source).not.toContain('--accept-data-loss');
    expect(source).not.toContain('force-reset');
    expect(source).not.toContain('db push');
  });
});

const readDockerfile = (name: string) => readFileSync(path.join(repoRoot, name), 'utf8');

/**
 * Splits a Dockerfile into named build stages. `Dockerfile.dev` has a single
 * unnamed stage, which is reported as `default`.
 */
const stagesOf = (text: string) => {
  const stages = new Map<string, string[]>();
  let current = 'default';
  for (const line of text.split('\n')) {
    const from = /^FROM\s+(.+)$/i.exec(line.trim());
    if (from) {
      const named = /\sAS\s+([\w.-]+)\s*$/i.exec(from[1]);
      current = named ? named[1].toLowerCase() : stages.size === 0 ? 'default' : `stage${stages.size}`;
      stages.set(current, [line]);
      continue;
    }
    if (!stages.has(current)) {
      stages.set(current, []);
    }
    stages.get(current)?.push(line);
  }
  return stages;
};

const runtimeImages = [
  { name: 'root image', file: 'Dockerfile.dev', stage: 'default' },
  { name: 'single-image candidate', file: 'k8s/Dockerfile', stage: 'runtime' },
  { name: 'packaged runtime image', file: 'k8s/Dockerfile.runtime', stage: 'runtime' },
];

describe.each(runtimeImages)('$name', ({ file, stage }) => {
  const text = readDockerfile(file);
  const body = (stagesOf(text).get(stage) ?? []).join('\n');

  it('uses the shared startup entrypoint and does not start the app first', () => {
    expect(body).toMatch(/^ENTRYPOINT\s+\[\s*"\/app\/var\/docker\/entrypoint\.sh"/m);
    expect(body).toMatch(/^CMD\s+\[/m);
    expect(body).not.toMatch(/^CMD[^\n]*prisma/m);
    expect(body).not.toMatch(/(^|\n)ENTRYPOINT[^\n]*pm2/m);
  });

  it('ships the root script, the schema and the pinned Prisma CLI', () => {
    const copiesWholeTree = /^COPY\s+\.\s+\/app\s*$/m.test(body);
    if (!copiesWholeTree) {
      expect(body).toMatch(/COPY[^\n]*package\.json/);
      expect(body).toMatch(/COPY[^\n]*schema\.prisma/);
      expect(body).toMatch(/COPY[^\n]*entrypoint\.sh/);
    }
    expect(body).toMatch(/pnpm@10\.6\.1/);
  });
});

describe.each(runtimeImages)('$name build rules', ({ file }) => {
  const stages = stagesOf(readDockerfile(file));

  it('never applies the schema while the image is being built', () => {
    for (const [name, lines] of stages) {
      const stage = lines.join('\n');
      expect(stage).not.toMatch(/prisma\s+db\s+push/);
      if (name === 'runtime' || name === 'default') {
        continue;
      }
      expect(stage).not.toMatch(/--accept-data-loss/);
      expect(stage).not.toMatch(/DATABASE_URL=/);
    }
  });
});

describe('root package scripts', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  it('does not enable provider migration for the upgrade', () => {
    const env = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    expect(env).not.toMatch(/^MIGRATE_PROVIDERS=/m);
  });

  it('runs the pinned local Prisma CLI so a runtime image needs no registry access', () => {
    expect(pkg.devDependencies.prisma).toBe('6.5.0');
    expect(pkg.scripts['prisma-db-push']).not.toContain('pnpm dlx');
    expect(pkg.scripts['prisma-db-push']).toMatch(/^prisma db push /);
    expect(pkg.scripts['prisma-db-push']).toContain(
      'libraries/nestjs-libraries/src/database/prisma/schema.prisma'
    );
  });

  it('generates only the client during install', () => {
    expect(pkg.scripts.postinstall).toContain('prisma-generate');
    expect(pkg.scripts.postinstall).not.toContain('db push');
    expect(pkg.scripts['prisma-generate']).toContain('generate');
    expect(pkg.scripts['prisma-generate']).not.toContain('db push');
  });
});
