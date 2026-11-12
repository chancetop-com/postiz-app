#!/usr/bin/env node
/**
 * Scheduled-post continuity rehearsal (implementation ticket 15).
 *
 *   node .scratch/postiz-stable-merge-implementation/rehearsals/15/run.mjs
 *       One disposable PostgreSQL 15, one local media origin and one Redis.
 *       Scenarios are grouped by the clock they need:
 *         real — a real-time Temporal server: watch a post wait, restart the
 *                worker, publish later, and count the stub's calls;
 *         skip — a time-skipping Temporal server for the hourly/daily
 *                maintenance workflows.
 *       The compiled candidate backend and orchestrator run unmodified; the
 *       only injected code replaces the platform and e-mail boundaries.
 *
 *   --only <id>      run one scenario
 *   --keep           keep the containers after the run (debugging)
 *   --list           print scenario ids
 *
 * Results are written to results/latest.json and results/call-log.jsonl; the
 * process exits non-zero if any scenario fails.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startBackend, startOrchestrator } from './lib/stack.mjs';
import { Postgres } from './lib/postgres.mjs';
import { Redis } from './lib/redis.mjs';
import { startMediaServer, syntheticFeed } from './lib/media-server.mjs';
import { startTemporal } from './lib/temporal-env.mjs';
import { createCallLog } from './lib/calls.mjs';
import { beginScenario, finish, recordFailure } from './lib/report.mjs';
import { EVIDENCE_DIR, REPO_ROOT, RESULTS_DIR, WORK_DIR } from './lib/paths.mjs';
import { scenarios } from './lib/scenarios.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

if (flag('--list')) {
  for (const scenario of scenarios) {
    console.log(`${scenario.id} [${scenario.clock}] — ${scenario.description}`);
  }
  process.exit(0);
}

const only = option('--only');
const selected = only ? scenarios.filter((s) => s.id === only) : scenarios;
if (only && selected.length === 0) {
  console.error(`unknown scenario "${only}"`);
  process.exit(2);
}

mkdirSync(WORK_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

const runStamp = Date.now().toString(36);
const uploadDirectory = join(WORK_DIR, `uploads-${runStamp}`);
mkdirSync(uploadDirectory, { recursive: true });
const callLogPath = join(WORK_DIR, `calls-${runStamp}.jsonl`);
const calls = createCallLog(callLogPath);
const jwtSecret = 'rehearsal-15-jwt-secret';

const postgres = new Postgres(`postiz-rehearsal15-pg-${runStamp}`);
const redis = new Redis(`postiz-rehearsal15-redis-${runStamp}`);
let prisma;
let mediaServer;
let temporal;
let orchestrator;
let backend;
let currentScenario = null;
const deferCleanups = [];

function currentContext() {
  return {
    postgres,
    prisma,
    calls,
    temporal,
    uploadDirectory,
    frontendUrl: mediaServer.origin,
    backendOrigin: backend ? `http://127.0.0.1:${backend.port}` : null,
    jwtSecret,
    orchestrator,
    backend,
    defer(fn) {
      deferCleanups.push(fn);
    },
    async stopOrchestrator() {
      await orchestrator.process.stop();
      orchestrator = undefined;
    },
    async bootOrchestrator() {
      orchestrator = await startOrchestrator({
        databaseUrl: postgres.url,
        temporalAddress: temporal.address,
        uploadDirectory,
        frontendUrl: mediaServer.origin,
        callLog: callLogPath,
      });
      return orchestrator;
    },
    async restartOrchestrator() {
      await orchestrator.process.stop();
      return this.bootOrchestrator();
    },
  };
}

async function bootGroup(group) {
  temporal = await startTemporal({ timeSkipping: group.clock === 'skip' });
  console.log(`[harness] temporal (${group.clock}) ${temporal.address}`);

  orchestrator = await startOrchestrator({
    databaseUrl: postgres.url,
    temporalAddress: temporal.address,
    uploadDirectory,
    frontendUrl: mediaServer.origin,
    callLog: callLogPath,
  });
  console.log(`[harness] orchestrator on ${orchestrator.port}`);

  if (group.needsBackend) {
    backend = await startBackend({
      databaseUrl: postgres.url,
      temporalAddress: temporal.address,
      uploadDirectory,
      frontendUrl: mediaServer.origin,
      callLog: callLogPath,
      jwtSecret,
      redisUrl: redis.url,
    });
    console.log(`[harness] backend on ${backend.port}`);
  }
}

async function stopGroup() {
  if (backend) await backend.process.stop().catch(() => {});
  if (orchestrator) await orchestrator.process.stop().catch(() => {});
  if (temporal) await temporal.close().catch(() => {});
  backend = undefined;
  orchestrator = undefined;
  temporal = undefined;
}

const groups = [];
for (const scenario of selected) {
  const clock = scenario.clock ?? 'real';
  const last = groups[groups.length - 1];
  if (last && last.clock === clock) {
    last.scenarios.push(scenario);
    last.needsBackend ||= !!scenario.needsBackend;
  } else {
    groups.push({ clock, scenarios: [scenario], needsBackend: !!scenario.needsBackend });
  }
}

try {
  console.log(`[harness] database ${await postgres.start()}`);
  prisma = postgres.client();
  postgres.push();
  console.log('[harness] prisma db push complete');
  console.log(`[harness] redis ${await redis.start()}`);

  mediaServer = await startMediaServer({
    uploadDirectory,
    feedXml: syntheticFeed('http://feed.invalid'),
  });
  console.log(`[harness] media origin ${mediaServer.origin}`);

  for (const group of groups) {
    await bootGroup(group);
    for (const scenario of group.scenarios) {
      currentScenario = scenario.id;
      beginScenario(scenario.id, scenario.description);
      try {
        await scenario.run(currentContext());
      } catch (err) {
        recordFailure(scenario.id, err);
        console.error(`[harness] ${scenario.id} failed\n${err?.stack ?? err}`);
        if (orchestrator) {
          console.error(`[harness] orchestrator tail:\n${orchestrator.process.tail(30)}`);
        }
        if (backend) console.error(`[harness] backend tail:\n${backend.process.tail(30)}`);
        process.exitCode = 1;
        break;
      }
    }
    await stopGroup();
    if (process.exitCode) break;
  }
} catch (err) {
  recordFailure(currentScenario ?? 'setup', err);
  console.error(err?.stack ?? err);
  if (orchestrator) console.error(`[harness] orchestrator tail:\n${orchestrator.process.tail(60)}`);
  if (backend) console.error(`[harness] backend tail:\n${backend.process.tail(60)}`);
  process.exitCode = 1;
} finally {
  for (const cleanup of deferCleanups.reverse()) await cleanup().catch(() => {});
  await stopGroup();
  if (mediaServer) await mediaServer.close().catch(() => {});
  const { document, path } = finish();
  const sanitize = (file) =>
    readFileSync(file, 'utf8').split(REPO_ROOT).join('<repo>');
  for (const directory of [RESULTS_DIR, EVIDENCE_DIR]) {
    try {
      writeFileSync(join(directory, 'call-log.jsonl'), sanitize(callLogPath));
    } catch {
      /* no calls */
    }
    try {
      copyFileSync(path, join(directory, 'latest.json'));
    } catch {
      /* no results */
    }
  }
  if (!flag('--keep')) {
    postgres.remove();
    redis.remove();
  } else {
    console.log(`[harness] kept ${postgres.name} (${postgres.url}) and ${redis.name}`);
  }
  if (prisma) await prisma.$disconnect().catch(() => {});
  console.log(
    `\n[harness] ${document.ok ? 'PASS' : 'FAIL'} — ${document.scenarios.length} scenario(s), results ${path}`
  );
  rmSync(uploadDirectory, { recursive: true, force: true });
  // The Temporal native pollers keep handles alive even after their workers
  // are shut down; the run's evidence is already on disk.
  process.exit(document.ok ? 0 : 1);
}
