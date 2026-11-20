/**
 * Boots the compiled candidate orchestrator against the provided isolated
 * PostgreSQL, Redis and Temporal services.
 *
 * The candidate runs unmodified. The only injected code is the preload in
 * `stub-provider.cjs`, which replaces the platform and e-mail boundaries and
 * (for one scenario) simulates a post changing state after the maintenance
 * scan loaded its candidate list.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
  ORCHESTRATOR_MAIN,
  PRELOAD,
  REPO_ROOT,
  WORK_DIR,
} from './paths.mjs';

mkdirSync(WORK_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  'COMPAT_WORKFLOW_QUEUES',
  'EXCLUDE_QUEUE',
  'WORKER_CONCURRENCY_DIVIDER',
  'ENCRYPTION_PROVIDER',
  'ENCRYPTION_KEY',
  'ENCRYPTION_READ_ONLY',
];

function baseEnv() {
  const env = { ...process.env };
  for (const key of OPTIONAL_KEYS) delete env[key];
  delete env.NODE_OPTIONS;
  return env;
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function waitForHttp(url, { timeoutMs = 180_000, name = url } = {}) {
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
    this.logPath = join(WORK_DIR, `${name}-${Date.now()}.log`);
    this.lines = [];
    this.child = spawn(process.execPath, [entry], {
      cwd: REPO_ROOT,
      env: {
        ...baseEnv(),
        ...env,
        NODE_OPTIONS: `--require ${PRELOAD}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const stream = createWriteStream(this.logPath, { flags: 'a' });
    const collect = (chunk) => {
      stream.write(chunk);
      const text = chunk.toString();
      this.lines.push(...text.split('\n').filter(Boolean));
      if (this.lines.length > 400) {
        this.lines.splice(0, this.lines.length - 400);
      }
    };
    this.child.stdout.on('data', collect);
    this.child.stderr.on('data', collect);
    this.child.on('error', (err) => {
      this.exited = -1;
      this.lines.push(`spawn error: ${err.message}`);
      stream.write(`spawn error: ${err.message}\n`);
      stream.end();
    });
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

export async function startOrchestrator({
  databaseUrl,
  redisUrl,
  temporalAddress,
  temporalNamespace = 'default',
  uploadDirectory,
  frontendUrl,
  callLog,
  encryptionKey,
  compatQueues,
  scanRacePost,
  extraEnv = {},
}) {
  const port = await freePort();
  const proc = new Process('orchestrator', ORCHESTRATOR_MAIN, {
    NODE_ENV: 'production',
    ORCHESTRATOR_PORT: String(port),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    TEMPORAL_ADDRESS: temporalAddress,
    TEMPORAL_NAMESPACE: temporalNamespace,
    STORAGE_PROVIDER: 'local',
    UPLOAD_DIRECTORY: uploadDirectory,
    NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: 'uploads',
    FRONTEND_URL: frontendUrl,
    JWT_SECRET: 'rehearsal-12-jwt-secret',
    EMAIL_PROVIDER: 'empty',
    EMAIL_FROM_ADDRESS: 'synthetic@postiz.invalid',
    EMAIL_FROM_NAME: 'Synthetic Postiz',
    IS_GENERAL: 'true',
    NOT_SECURED: 'true',
    COMPAT_WORKFLOW_QUEUES: compatQueues || '',
    ENCRYPTION_PROVIDER: encryptionKey ? 'local' : '',
    ...(encryptionKey ? { ENCRYPTION_KEY: encryptionKey } : {}),
    T12_CALL_LOG: callLog,
    T12_DIST_ROOT: join(REPO_ROOT, 'apps/orchestrator/dist'),
    T12_STUB_EMAIL: '1',
    ...(scanRacePost ? { T12_SCAN_RACE_POST: scanRacePost } : {}),
    ...extraEnv,
  });

  try {
    await waitForHttp(`http://127.0.0.1:${port}/health/status`, {
      name: 'orchestrator',
    });
  } catch (err) {
    await proc.stop();
    throw new Error(`${err.message}\n${proc.tail(80)}`);
  }
  return { port, process: proc };
}
