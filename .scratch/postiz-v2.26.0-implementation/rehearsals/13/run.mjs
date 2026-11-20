#!/usr/bin/env node
/**
 * Delivery fault and recovery rehearsal (implementation ticket 13).
 *
 *   node .scratch/postiz-v2.26.0-implementation/rehearsals/13/run.mjs
 *       Run the live scenarios against the isolated PostgreSQL, Redis and
 *       Temporal namespace. Boots the compiled candidate orchestrator per
 *       scenario; platform/e-mail calls go to the preloaded substitutes.
 *
 *   ... run.mjs --list
 *   ... run.mjs --only <scenario-id>
 *
 * Environment (defaults match the ticket brief):
 *   DATABASE_URL       postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-ticket-13
 *   REDIS_URL          redis://localhost:6379/13
 *   TEMPORAL_ADDRESS   localhost:7233
 *   TEMPORAL_NAMESPACE postiz-ticket-13 (created on first use)
 *   UPLOAD_DIRECTORY   <harness>/work/uploads
 *
 * The harness imports ticket 12's pure helpers (seed/temporal/calls) so the
 * normal samples and this fault run measure the same boundary.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Connection } from '@temporalio/client';
import {
  defineSearchAttributeKey,
  SearchAttributeType,
  TypedSearchAttributes,
} from '@temporalio/common';
import {
  EVIDENCE_DIR,
  FAULT_FILE,
  NORMAL_SAMPLES,
  REPO_ROOT,
  RESULTS_DIR,
  WORK_DIR,
} from './lib/paths.mjs';
import { createCallLog } from '../12/lib/calls.mjs';
import { connectTemporal, listExecutions, waitFor } from '../12/lib/temporal.mjs';
import {
  beginScenario,
  finish,
  recordFailure,
  setMeta,
} from './lib/report.mjs';
import { armFaults, clearFaults, readFaults } from './lib/faults.mjs';
import { startOrchestrator } from './lib/stack.mjs';
import { scenarios } from './lib/scenarios.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const config = {
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-ticket-13',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/13',
  temporalAddress: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'postiz-ticket-13',
  uploadDirectory: process.env.UPLOAD_DIRECTORY || join(WORK_DIR, 'uploads'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4313',
};

mkdirSync(WORK_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(config.uploadDirectory, { recursive: true });

const postIdKey = defineSearchAttributeKey('postId', SearchAttributeType.TEXT);
const organizationIdKey = defineSearchAttributeKey(
  'organizationId',
  SearchAttributeType.TEXT
);

const searchAttributes = (postId, organizationId) =>
  new TypedSearchAttributes([
    { key: postIdKey, value: postId },
    { key: organizationIdKey, value: organizationId },
  ]);

const git = (gitArgs) =>
  execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

function revision() {
  try {
    return {
      commit: git(['rev-parse', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirtyFiles: git(['status', '--porcelain']).split('\n').filter(Boolean)
        .length,
    };
  } catch (err) {
    return { error: err.message };
  }
}

function normalSamples() {
  try {
    return JSON.parse(readFileSync(NORMAL_SAMPLES, 'utf8'));
  } catch (err) {
    return { error: err.message, scenarios: [] };
  }
}

async function ensureNamespace(connection, namespace) {
  try {
    await connection.workflowService.describeNamespace({ namespace });
    return false;
  } catch (err) {
    if (!/NOT_FOUND|not found/i.test(String(err?.message))) throw err;
  }

  try {
    await connection.workflowService.registerNamespace({
      namespace,
      description: 'Ticket 13 isolated delivery fault/recovery rehearsal',
      workflowExecutionRetentionPeriod: { seconds: 86400 },
    });
  } catch (err) {
    // Some server builds return a response shape the SDK does not expose;
    // describeNamespace below is the authority.
    if (!/Cannot read properties|namespaceInfo/i.test(String(err?.message))) {
      throw err;
    }
  }

  await waitFor(
    async () => {
      try {
        await connection.workflowService.describeNamespace({ namespace });
        return true;
      } catch {
        return false;
      }
    },
    { label: `namespace ${namespace}`, timeoutMs: 15_000 }
  );
  return true;
}

async function cleanNamespace(client) {
  const running = await listExecutions(client, 'ExecutionStatus="Running"');
  for (const execution of running) {
    try {
      await client.workflow
        .getHandle(execution.workflowId, execution.runId)
        .terminate('ticket 13 rehearsal clean start');
    } catch {
      /* already closed */
    }
  }
  return running.length;
}

async function truncateDatabase(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  const tables = rows.map((row) => row.tablename).filter(Boolean);
  if (!tables.length) return 0;
  const quoted = tables.map((name) => `"${name.replace(/"/g, '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`
  );
  return tables.length;
}

async function run() {
  const only = option('--only');
  const prisma = new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });
  let connection;
  let temporal;
  const callLogPath = join(WORK_DIR, `calls-${Date.now().toString(36)}.jsonl`);
  const calls = createCallLog(callLogPath);

  try {
    await prisma.$queryRaw`SELECT 1`;
    const tables = await truncateDatabase(prisma);
    connection = await Connection.connect({ address: config.temporalAddress });
    const created = await ensureNamespace(connection, config.temporalNamespace);
    temporal = await connectTemporal({
      address: config.temporalAddress,
      namespace: config.temporalNamespace,
    });
    const cleaned = await cleanNamespace(temporal.client);
    clearFaults();

    const samples = normalSamples();
    const bootOrchestrator = () =>
      startOrchestrator({
        databaseUrl: config.databaseUrl,
        redisUrl: config.redisUrl,
        temporalAddress: config.temporalAddress,
        temporalNamespace: config.temporalNamespace,
        uploadDirectory: config.uploadDirectory,
        frontendUrl: config.frontendUrl,
        callLog: calls.path,
        compatQueues: 'bluesky',
      });

    setMeta('environment', {
      database: config.databaseUrl.replace(/:[^:@/]+@/, ':***@'),
      redis: config.redisUrl,
      temporalAddress: config.temporalAddress,
      temporalNamespace: config.temporalNamespace,
      namespaceCreated: created,
      runningWorkflowsTerminatedAtStart: cleaned,
      truncatedTables: tables,
      uploadDirectory: config.uploadDirectory,
      candidate: revision(),
      faultFile: FAULT_FILE.replace(REPO_ROOT, '<repo>'),
      compiledEntrypoint: 'apps/orchestrator/dist/apps/orchestrator/src/main.js',
    });
    setMeta('normalSamples', {
      path: NORMAL_SAMPLES.replace(REPO_ROOT, '<repo>'),
      generatedAt: samples.generatedAt,
      namespace: samples.namespace,
      candidateBundle: samples.candidateBundle,
      scenarioIds: (samples.scenarios || []).map((scenario) => scenario.id),
    });
    console.log(
      `[harness] temporal namespace ${config.temporalNamespace} ready; ` +
        `${tables} tables truncated; ${samples.scenarios?.length ?? 0} normal samples loaded`
    );

    if (flag('--list')) {
      for (const scenario of scenarios({
        prisma,
        temporal,
        calls,
        config,
        normalSamples: samples,
        bootOrchestrator,
        searchAttributes,
      })) {
        console.log(`${scenario.id} — ${scenario.description}`);
      }
      return true;
    }

    const list = scenarios({
      prisma,
      temporal,
      calls,
      config,
      normalSamples: samples,
      bootOrchestrator,
      searchAttributes,
    }).filter((scenario) => !only || scenario.id === only);
    if (only && list.length === 0) {
      throw new Error(`unknown scenario "${only}"`);
    }

    for (const scenario of list) {
      beginScenario(scenario.id, scenario.description);
      calls.record({ method: 'scenario-start', scenario: scenario.id });
      try {
        await scenario.run();
      } catch (err) {
        recordFailure(scenario.id, err);
      } finally {
        calls.record({ method: 'scenario-end', scenario: scenario.id });
        clearFaults();
      }
    }

    const result = finish();
    writeFileSync(
      join(EVIDENCE_DIR, 'call-log.jsonl'),
      readFileSync(callLogPath, 'utf8').split(REPO_ROOT).join('<repo>')
    );
    writeFileSync(
      join(EVIDENCE_DIR, 'faults.json'),
      JSON.stringify(readFaults(), null, 2)
    );
    const normalized = readFileSync(result.path, 'utf8')
      .split(REPO_ROOT)
      .join('<repo>');
    writeFileSync(result.path, normalized);
    writeFileSync(join(EVIDENCE_DIR, 'latest.json'), normalized + '\n');
    console.log(`\nresult: ${result.document.ok ? 'PASS' : 'FAIL'}`);
    console.log(`report: ${result.path}`);
    console.log(`summary: ${result.summaryPath}`);
    return result.document.ok;
  } finally {
    clearFaults();
    if (temporal) await temporal.close().catch(() => {});
    else if (connection) await connection.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}

try {
  const ok = await run();
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
