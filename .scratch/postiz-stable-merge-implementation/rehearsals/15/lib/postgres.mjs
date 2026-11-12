/**
 * Disposable PostgreSQL 15 for the rehearsal.
 *
 * A throw-away container on a loopback-only port; the schema is created with
 * the repository's own `prisma db push` (the same command the container
 * entrypoint runs), never by hand-written DDL. Nothing here can reach a real
 * database: the connection string is built from the docker-assigned port and
 * the container is removed when the run ends.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { REPO_ROOT, SCHEMA } from './paths.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Postgres {
  constructor(name = 'postiz-rehearsal15-pg') {
    this.name = name;
    this.url = null;
  }

  docker(args) {
    return execFileSync('docker', args, { encoding: 'utf8' }).trim();
  }

  async start() {
    this.remove();
    this.docker([
      'run',
      '-d',
      '--name',
      this.name,
      '-e',
      'POSTGRES_PASSWORD=postiz',
      '-e',
      'POSTGRES_DB=postiz',
      '-p',
      '127.0.0.1:0:5432',
      'postgres:15',
    ]);

    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        this.docker(['exec', this.name, 'pg_isready', '-U', 'postgres', '-d', 'postiz']);
        break;
      } catch {
        await sleep(1000);
      }
    }

    const mapping = this.docker(['port', this.name, '5432/tcp']);
    const port = mapping.split('\n')[0].split(':').pop();
    this.url = `postgresql://postgres:postiz@127.0.0.1:${port}/postiz`;
    return this.url;
  }

  push() {
    execFileSync(
      'pnpm',
      ['run', 'prisma-db-push', '--skip-generate'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: this.url },
        stdio: 'pipe',
      }
    );
    return SCHEMA;
  }

  client() {
    return new PrismaClient({ datasources: { db: { url: this.url } } });
  }

  remove() {
    try {
      execFileSync('docker', ['rm', '-f', '-v', this.name], { stdio: 'ignore' });
    } catch {
      /* not running */
    }
  }
}
