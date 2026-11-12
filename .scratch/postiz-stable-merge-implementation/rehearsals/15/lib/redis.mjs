/**
 * Disposable Redis for the backend process.
 *
 * The shipped backend wires `ThrottlerStorageRedisService` to the shared
 * ioredis client; with no URL that client is a mock, which the throttler then
 * wraps in a real connection to localhost. The isolated deployment runs a real
 * Redis, so the rehearsal does the same on a loopback-only port.
 */
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Redis {
  constructor(name = 'postiz-rehearsal15-redis') {
    this.name = name;
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
      '-p',
      '127.0.0.1:0:6379',
      'redis:7-alpine',
    ]);

    const port = this.docker(['port', this.name, '6379/tcp'])
      .split('\n')[0]
      .split(':')
      .pop();

    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        this.docker(['exec', this.name, 'redis-cli', 'ping']);
        break;
      } catch {
        await sleep(500);
      }
    }

    this.url = `redis://127.0.0.1:${port}`;
    return this.url;
  }

  remove() {
    try {
      execFileSync('docker', ['rm', '-f', '-v', this.name], { stdio: 'ignore' });
    } catch {
      /* not running */
    }
  }
}
