#!/usr/bin/env node
/**
 * In-flight Temporal continuity rehearsal (implementation ticket 12).
 *
 *   node .scratch/postiz-v2.26.0-implementation/rehearsals/12/run.mjs live
 *       Run the live scenarios against the isolated PostgreSQL, Redis and
 *       Temporal namespace. Boots the compiled candidate orchestrator per
 *       scenario and stops it again; platform and e-mail calls go to the
 *       preloaded substitutes.
 *
 *   ... run.mjs replay
 *       Replay the ticket-14 pre-upgrade histories with the current candidate
 *       bundle and copy the result into this ticket's evidence directory.
 *
 *   ... run.mjs all
 *       replay, then live.
 *
 * Environment (defaults match the ticket brief):
 *   DATABASE_URL      postgresql://<user>:<password>@localhost:5432/postiz-ticket-12
 *   REDIS_URL         redis://localhost:6379/12
 *   TEMPORAL_ADDRESS  localhost:7233
 *   TEMPORAL_NAMESPACE postiz-ticket-12 (created on first use)
 *   UPLOAD_DIRECTORY  <harness>/work/uploads
 *
 * The only injected code is `lib/stub-provider.cjs` (platform/e-mail boundary
 * and one maintenance race hook). Candidate code runs unmodified.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Connection } from '@temporalio/client';
import {
  EVIDENCE_DIR,
  REPLAY_LATEST,
  REPO_ROOT,
  RESULTS_DIR,
  WORK_DIR,
  COMPILED_WORKFLOWS,
} from './lib/paths.mjs';
import { createCallLog } from './lib/calls.mjs';
import {
  beginScenario,
  finish,
  recordFailure,
  setMeta,
} from './lib/report.mjs';
import { connectTemporal, listExecutions, waitFor } from './lib/temporal.mjs';
import { scenarios } from './lib/scenarios.mjs';

const args = process.argv.slice(2);
const command =
  args[0] && !args[0].startsWith('--') ? args[0] : 'live';
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const config = {
  // The password is supplied by the isolated runtime; it is never committed.
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postiz-local@localhost:5432/postiz-ticket-12',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/12',
  temporalAddress: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'postiz-ticket-12',
  uploadDirectory:
    process.env.UPLOAD_DIRECTORY || join(WORK_DIR, 'uploads'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4312',
  // A synthetic 32-byte key, only for this isolated rehearsal.
  encryptionKey: randomBytes(32).toString('base64'),
};

mkdirSync(WORK_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(config.uploadDirectory, { recursive: true });

const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

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
      description: 'Ticket 12 isolated in-flight continuity rehearsal',
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

async function cleanNamespace(client, namespace) {
  const running = await listExecutions(
    client,
    'ExecutionStatus="Running"'
  );
  for (const execution of running) {
    try {
      await client.workflow
        .getHandle(execution.workflowId, execution.runId)
        .terminate('ticket 12 rehearsal clean start');
    } catch {
      /* already closed */
    }
  }
  return running.length;
}

function candidateBundleInfo() {
  try {
    // Prefer this ticket's replay copy (it records the revision the replay
    // actually ran on); fall back to the ticket-14 ledger if replay was not
    // run in this workspace yet.
    const own = join(RESULTS_DIR, 'replay-latest.json');
    const replay = JSON.parse(
      readFileSync(existsSync(own) ? own : REPLAY_LATEST, 'utf8')
    );
    return {
      workflowsPath: replay.candidate?.workflowsPath,
      bundleSha256: replay.candidate?.bundleSha256,
      replayedAt: replay.replayedAt,
      replayedAgainst: replay.replayedAgainst,
      fixtureProvenance: replay.fixtures,
      totals: replay.totals,
      // The ticket-14 generator records the revision it was generated on; it
      // is not the candidate revision that just replayed the fixtures.
      fixtureGenerationRevision: replay.candidate?.revision,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function runReplay() {
  console.log('[replay] bundling candidate and replaying pre-upgrade histories');
  const output = execFileSync(
    process.execPath,
    [
      join(
        REPO_ROOT,
        '.scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs'
      ),
      'replay',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  console.log(output);
  const replay = JSON.parse(readFileSync(REPLAY_LATEST, 'utf8'));
  replay.replayedAgainst = revision();
  replay.runAt = new Date().toISOString();
  const path = join(RESULTS_DIR, 'replay-latest.json');
  writeFileSync(path, JSON.stringify(replay, null, 2) + '\n');
  return { path, replay };
}

async function runLive() {
  const only = option('--only');
  if (flag('--list')) {
    for (const scenario of scenarios({
      prisma: {},
      temporal: { client: {} },
      calls: { read: () => [], path: '' },
      config,
    })) {
      console.log(`${scenario.id} — ${scenario.description}`);
    }
    process.exit(0);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });

  let connection;
  let temporal;
  const callLogPath = join(WORK_DIR, `calls-${Date.now().toString(36)}.jsonl`);
  const calls = createCallLog(callLogPath);

  try {
    await prisma.$queryRaw`SELECT 1`;
    connection = await Connection.connect({ address: config.temporalAddress });
    const created = await ensureNamespace(
      connection,
      config.temporalNamespace
    );
    temporal = await connectTemporal({
      address: config.temporalAddress,
      namespace: config.temporalNamespace,
    });
    const cleaned = await cleanNamespace(
      temporal.client,
      config.temporalNamespace
    );

    setMeta('environment', {
      database: config.databaseUrl.replace(/:[^:@/]+@/, ':***@'),
      redis: config.redisUrl,
      temporalAddress: config.temporalAddress,
      temporalNamespace: config.temporalNamespace,
      namespaceCreated: created,
      runningWorkflowsTerminatedAtStart: cleaned,
      uploadDirectory: config.uploadDirectory,
      candidateBundle: candidateBundleInfo(),
      compiledWorkflows: COMPILED_WORKFLOWS.replace(REPO_ROOT, '<repo>'),
      stubProvider: {
        identifier: 'bluesky',
        encryptionProvider: 'local',
        keyId: undefined,
      },
    });
    console.log(`[harness] temporal namespace ${config.temporalNamespace} ready`);

    const list = scenarios({ prisma, temporal, calls, config }).filter(
      (scenario) => !only || scenario.id === only
    );
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
      }
    }

    const result = finish();
    // Keep the boundary ledger next to the evidence for ticket 13, with the
    // machine-specific checkout path normalised like the rest of the evidence.
    writeFileSync(
      join(EVIDENCE_DIR, 'call-log.jsonl'),
      readFileSync(callLogPath, 'utf8').split(REPO_ROOT).join('<repo>')
    );
    const normalized = readFileSync(result.path, 'utf8')
      .split(REPO_ROOT)
      .join('<repo>');
    writeFileSync(result.path, normalized);
    writeFileSync(
      join(EVIDENCE_DIR, 'latest.json'),
      normalized + '\n'
    );
    // The normal samples ticket 13 compares a failure run against: the
    // scenario contract plus the exact observations, and the boundary ledger.
    writeFileSync(
      join(EVIDENCE_DIR, 'normal-samples.json'),
      JSON.stringify(
        {
          generatedAt: result.document.generatedAt,
          namespace: config.temporalNamespace,
          candidateBundle: candidateBundleInfo(),
          callLedger: 'evidence/call-log.jsonl',
          scenarios: result.document.scenarios.map((scenario) => ({
            id: scenario.id,
            description: scenario.description,
            assertions: scenario.assertions,
            observations: scenario.observations,
          })),
        },
        null,
        2
      )
        .split(REPO_ROOT)
        .join('<repo>') + '\n'
    );
    console.log(`\nresult: ${result.document.ok ? 'PASS' : 'FAIL'}`);
    console.log(`report: ${result.path}`);
    console.log(`summary: ${result.summaryPath}`);
    return result.document.ok;
  } finally {
    if (temporal) await temporal.close().catch(() => {});
    else if (connection) await connection.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}

try {
  let ok = true;
  if (command === 'replay') {
    const result = await runReplay();
    console.log(
      `replay: ${result.replay.totals.replayed}/${result.replay.totals.histories} histories, bundle ${result.replay.candidate.bundleSha256}`
    );
  } else if (command === 'live') {
    ok = await runLive();
  } else if (command === 'all') {
    await runReplay();
    ok = await runLive();
  } else {
    console.error(`unknown command "${command}" (expected replay | live | all)`);
    process.exit(2);
  }
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
