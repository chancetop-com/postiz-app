/**
 * Boots the real candidate processes (compiled orchestrator worker and backend
 * API) against the disposable database, local media origin and ephemeral
 * Temporal server. Adapted from ticket 15's stack; only the paths and the
 * ticket-16 preload/compat env differ.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  BACKEND_MAIN,
  ORCHESTRATOR_MAIN,
  PRELOAD,
  REPO_ROOT,
  WORK_DIR,
} from './paths.mjs';

mkdirSync(WORK_DIR, { recursive: true });

const require = createRequire(import.meta.url);

/**
 * Only main + the synthetic provider + the two e-mail queues are used by this
 * rehearsal. Starting all ~40 provider workers is unnecessary and can trip the
 * test server's connection ping limiter when the orchestrator restarts.
 */
function rehearsalExcludeQueues() {
  try {
    const { socialIntegrationList } = require(join(
      REPO_ROOT,
      'apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/integration.manager.js'
    ));
    return [
      ...new Set(
        socialIntegrationList
          .map((integration) => integration.identifier.split('-')[0])
          .filter((queue) => queue !== 'bluesky')
      ),
    ].join(',');
  } catch {
    return '';
  }
}

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
  'RUN_CRON',
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
  constructor(name, entry, env, preload = PRELOAD) {
    this.name = name;
    this.logPath = join(WORK_DIR, `${name}.log`);
    this.lines = [];
    this.child = spawn(process.execPath, [entry], {
      cwd: REPO_ROOT,
      env: {
        ...baseEnv(),
        ...env,
        NODE_OPTIONS: `--require ${preload}`,
        T16_DIST_ROOT: join(
          REPO_ROOT,
          name.startsWith('orchestrator')
            ? 'apps/orchestrator/dist'
            : 'apps/backend/dist'
        ),
        T16_CALL_LOG: env.T16_CALL_LOG,
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

export async function startOrchestrator({
  databaseUrl,
  temporalAddress,
  uploadDirectory,
  frontendUrl,
  callLog,
  extraEnv = {},
  preload = PRELOAD,
}) {
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
    T16_CALL_LOG: callLog,
    T16_STUB_EMAIL: '1',
    // See stub-provider.cjs: harness-only workaround for the time-skipping
    // test server's virtual sticky-cache timeout.
    T16_DISABLE_STICKY: '1',
    EXCLUDE_QUEUE: rehearsalExcludeQueues(),
    ...extraEnv,
  }, preload);

  await waitForHttp(`http://127.0.0.1:${port}/health/status`, {
    name: 'orchestrator',
  });
  await waitForMainWorker(proc);
  return { port, process: proc };
}

/**
 * The health route is up before the Temporal pollers are. Skipping the clock
 * while the main workflow poller is not yet registered leaves a fired timer's
 * workflow task with no poller, and the time-skipping server then waits for
 * that task forever. Wait for the SDK's own RUNNING log before returning.
 */
async function waitForMainWorker(proc, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (
      proc.lines.some(
        (line) =>
          line.includes("taskQueue: 'main'") && line.includes("state: 'RUNNING'")
      )
    ) {
      // Let the poller long-poll before the caller can advance the clock.
      await sleep(300);
      return;
    }
    await sleep(100);
  }
  throw new Error('orchestrator main worker did not start polling');
}

export async function startBackend({
  databaseUrl,
  temporalAddress,
  uploadDirectory,
  frontendUrl,
  callLog,
  jwtSecret,
  redisUrl,
  extraEnv = {},
  preload = PRELOAD,
  waitForReady = true,
}) {
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
    T16_CALL_LOG: callLog,
    ...extraEnv,
  }, preload);

  if (waitForReady) {
    await waitForHttp(`http://127.0.0.1:${port}/api/`, { name: 'backend' });
  }
  return { port, process: proc };
}