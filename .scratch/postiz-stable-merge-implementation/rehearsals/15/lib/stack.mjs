/**
 * Boots the real candidate processes (compiled orchestrator worker and backend
 * API) against the disposable database, the local media origin and the
 * ephemeral Temporal server.
 *
 * The only injected code is the preload in `stub-provider.cjs`, which replaces
 * the platform and e-mail boundaries. Everything else runs unmodified from
 * the compiled `apps/<app>/dist` trees, the same files PM2 starts.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKEND_MAIN,
  ORCHESTRATOR_MAIN,
  PRELOAD,
  REPO_ROOT,
  WORK_DIR,
} from './paths.mjs';

mkdirSync(WORK_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pure environment for the candidate processes. Inherited developer values
 * (Redis, Stripe, OpenAI, Temporal aliases) must not leak into the rehearsal:
 * the stack is supposed to run without optional services, exactly like the
 * isolated deployment the other tickets exercised.
 */
const OPTIONAL_KEYS = [
  'REDIS_URL',
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'RESEND_API_KEY',
  'RUNPOD_API_KEY',
  'RUNPOD_ENDPOINT_ID',
  'RUNPOD_INGEST_ENDPOINT_ID',
  'RUNPOD_CLIPPER_ENDPOINT_ID',
  'DEEPGRAM_API_KEY',
  'DATABASE_URL',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_TLS',
  'TEMPORAL_API_KEY',
  'TEMPORAL_NAMESPACE',
  'UPLOAD_DIRECTORY',
  'FRONTEND_URL',
  'JWT_SECRET',
  'PORT',
  'ORCHESTRATOR_PORT',
];

function baseEnv() {
  const env = { ...process.env };
  for (const key of OPTIONAL_KEYS) delete env[key];
  return env;
}

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function waitForHttp(url, { timeoutMs = 120_000, name = url } = {}) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return response;
      lastError = `status ${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(500);
  }
  throw new Error(`${name} did not become ready: ${lastError}`);
}

class Process {
  constructor(name, entry, env) {
    this.name = name;
    this.logPath = join(WORK_DIR, `${name}.log`);
    this.lines = [];
    this.child = spawn(process.execPath, [entry], {
      cwd: REPO_ROOT,
      env: {
        ...baseEnv(),
        ...env,
        NODE_OPTIONS: `--require ${PRELOAD}`,
        T15_DIST_ROOT: name.startsWith('orchestrator')
          ? join(REPO_ROOT, 'apps/orchestrator/dist')
          : join(REPO_ROOT, 'apps/backend/dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const stream = createWriteStream(this.logPath, { flags: 'a' });
    const collect = (chunk) => {
      stream.write(chunk);
      const text = chunk.toString();
      this.lines.push(...text.split('\n').filter(Boolean));
      if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    };
    this.child.stdout.on('data', collect);
    this.child.stderr.on('data', collect);
    this.child.on('exit', (code) => {
      this.exited = code;
      stream.end();
    });
  }

  stop(signal = 'SIGTERM') {
    return new Promise((resolve) => {
      if (this.exited !== undefined) return resolve();
      const timer = setTimeout(() => {
        try {
          process.kill(-this.child.pid, 'SIGKILL');
        } catch {}
      }, 8000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        process.kill(-this.child.pid, signal);
      } catch {
        resolve();
      }
    });
  }

  tail(count = 40) {
    return this.lines.slice(-count).join('\n');
  }
}

export async function startOrchestrator({ databaseUrl, temporalAddress, uploadDirectory, frontendUrl, callLog, extraEnv = {} }) {
  const port = await freePort();
  const proc = new Process('orchestrator', ORCHESTRATOR_MAIN, {
    NODE_ENV: 'production',
    ORCHESTRATOR_PORT: String(port),
    DATABASE_URL: databaseUrl,
    TEMPORAL_ADDRESS: temporalAddress,
    TEMPORAL_NAMESPACE: 'default',
    STORAGE_PROVIDER: 'local',
    UPLOAD_DIRECTORY: uploadDirectory,
    NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: 'uploads',
    FRONTEND_URL: frontendUrl,
    EMAIL_PROVIDER: 'empty',
    EMAIL_FROM_ADDRESS: 'synthetic@postiz.invalid',
    EMAIL_FROM_NAME: 'Synthetic Postiz',
    T15_CALL_LOG: callLog,
    T15_STUB_EMAIL: '1',
    ...extraEnv,
  });

  await waitForHttp(`http://127.0.0.1:${port}/health/status`, {
    name: 'orchestrator',
  });
  return { port, process: proc };
}

export async function startBackend({ databaseUrl, temporalAddress, uploadDirectory, frontendUrl, callLog, jwtSecret, redisUrl, extraEnv = {} }) {
  const port = await freePort();
  const proc = new Process('backend', BACKEND_MAIN, {
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    TEMPORAL_ADDRESS: temporalAddress,
    TEMPORAL_NAMESPACE: 'default',
    STORAGE_PROVIDER: 'local',
    UPLOAD_DIRECTORY: uploadDirectory,
    NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: 'uploads',
    FRONTEND_URL: frontendUrl,
    JWT_SECRET: jwtSecret,
    ...(redisUrl ? { REDIS_URL: redisUrl } : {}),
    EMAIL_PROVIDER: 'empty',
    EMAIL_FROM_ADDRESS: 'synthetic@postiz.invalid',
    EMAIL_FROM_NAME: 'Synthetic Postiz',
    T15_CALL_LOG: callLog,
    ...extraEnv,
  });

  await waitForHttp(`http://127.0.0.1:${port}/api/`, { name: 'backend' });
  return { port, process: proc };
}
