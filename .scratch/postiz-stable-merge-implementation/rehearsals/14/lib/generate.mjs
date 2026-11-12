/**
 * Fixture generation.
 *
 * Runs the pre-upgrade workflow definitions end to end against an ephemeral
 * (time-skipping) Temporal test server with stubbed activities, then stores the
 * resulting event histories. These histories are the only input the replay step
 * needs, so replay is fully offline.
 *
 * Requirements: no database, no provider, no real credentials. The test server
 * binary is downloaded and cached by `@temporalio/testing` on first use.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import pkg from '@temporalio/proto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { bundleLegacy } from './bundle.mjs';
import { materialisePatched } from './derive-patched.mjs';
import {
  CANDIDATE_WORKFLOWS,
  FIXTURES_DIR,
  LEGACY_BASE_WORKFLOWS,
  LEGACY_DIR,
  LEGACY_PATCHED_WORKFLOWS,
  REPO_ROOT,
  TOOLING,
} from './paths.mjs';
import { scenarios } from './scenarios.mjs';
import { createWorld } from './world.mjs';

const { temporal } = pkg;
const History = temporal.api.history.v1.History;

/**
 * Protobuf JSON keeps bytes/base64 and int64 round-trippable, so a fixture can
 * be replayed later without the original server.
 */
const serializeHistory = (history) =>
  History.toObject(history, {
    longs: String,
    bytes: String,
    enums: String,
    defaults: false,
    arrays: true,
    objects: true,
  });
const HOUR = 3_600_000;
const JSON_INDENT = 2;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** Paths are recorded repo-relative so provenance is not machine specific. */
const rel = (value) => relative(REPO_ROOT, value);
const git = (args) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim();

function gitState() {
  try {
    return {
      commit: git(['rev-parse', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirtyFiles: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
    };
  } catch {
    return { commit: 'unknown', branch: 'unknown', dirtyFiles: -1 };
  }
}

function testServerInfo() {
  // @temporalio/testing caches the binary in the OS temp dir; record what was used.
  const tmp = process.env.TMPDIR ?? '/tmp';
  const candidates = readdirSync(tmp)
    .filter((name) => name.startsWith('temporal-test-server-sdk-typescript-'))
    .map((name) => join(tmp, name));
  return candidates.map((path) => ({
    file: path.split('/').pop(),
    size: statSync(path).size,
    sha256: sha256(readFileSync(path)),
  }));
}

async function runScenario(scenario, bundle) {
  // One ephemeral server per scenario: the time-skipping server only advances
  // time while every open execution is waiting, so a deliberately abandoned
  // long-running execution from one scenario must not be able to hold up the
  // next one.
  const env = await TestWorkflowEnvironment.createTimeSkipping();

  // The time-skipping test server does not accept `--search-attribute` on its
  // command line, so register the attributes the old workflows write (repeat
  // children set `postId`) through the operator service.
  await env.connection.operatorService.addSearchAttributes({
    namespace: 'default',
    searchAttributes: {
      postId: temporal.api.enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_TEXT,
      organizationId: temporal.api.enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_TEXT,
    },
  });

  const world = createWorld();
  world.reset(scenario.stubs ?? {});

  const worker = await Worker.create({
    connection: env.nativeConnection,
    workflowBundle: { code: bundle.code },
    taskQueue: 'main',
    activities: world.activities,
  });
  const run = worker.run();

  const handle = await env.client.workflow.start(scenario.workflowType, {
    taskQueue: 'main',
    workflowId: scenario.workflowId,
    args: scenario.args,
  });

  try {
    return await withTimeout(
      scenario.run({ env, world, handle }),
      scenario.timeoutMs ?? 180_000,
      scenario.id
    );
  } finally {
    // The long running scenarios are intentionally still open when captured.
    await Promise.race([handle.terminate().catch(() => undefined), delay(10_000)]);
    worker.shutdown();
    await Promise.race([run.catch(() => undefined), delay(10_000)]);
    await Promise.race([env.teardown(), delay(20_000)]);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: scenario did not finish within ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertCapture(scenario, entry) {
  const json = serializeHistory(entry.history);
  const eventTypes = json.events.map((event) => event.eventType);
  if (!eventTypes.length) throw new Error(`${scenario.id}: captured an empty history`);

  if (scenario.expectLastEvent) {
    const last = eventTypes[eventTypes.length - 1];
    if (last !== scenario.expectLastEvent) {
      throw new Error(
        `${scenario.id}: expected the captured history to end with ${scenario.expectLastEvent}, got ${last}`
      );
    }
  }

  return {
    name: entry.name,
    workflowId: entry.workflowId,
    runId: entry.runId,
    eventCount: eventTypes.length,
    lastEventType: eventTypes[eventTypes.length - 1],
    history: json,
  };
}

export async function generate({ refreshLegacy = false } = {}) {
  materialisePatched({ refresh: refreshLegacy });

  const baseBundle = await bundleLegacy(LEGACY_BASE_WORKFLOWS, {
    signalDir: join(LEGACY_DIR, 'base/signals'),
  });
  const patchedBundle = await bundleLegacy(LEGACY_PATCHED_WORKFLOWS, {
    signalDir: join(LEGACY_DIR, 'patched/signals'),
  });
  const bundles = { base: baseBundle, patched: patchedBundle };

  mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const file of readdirSync(FIXTURES_DIR)) {
    if (file.endsWith('.json')) rmSync(join(FIXTURES_DIR, file));
  }

  const generated = [];
  for (const scenario of scenarios) {
    const startedAt = Date.now();
    const captured = await runScenario(scenario, bundles[scenario.bundle]);
    const histories = captured.map((entry) => assertCapture(scenario, entry));
    const fixture = {
      scenario: {
        id: scenario.id,
        description: scenario.description,
        bundle: scenario.bundle,
        workflowType: scenario.workflowType,
        workflowId: scenario.workflowId,
        proves: scenario.proves,
      },
      histories,
    };
    writeFileSync(
      join(FIXTURES_DIR, `${scenario.id}.json`),
      JSON.stringify(fixture, null, JSON_INDENT) + '\n'
    );
    generated.push({
      id: scenario.id,
      workflowType: scenario.workflowType,
      bundle: scenario.bundle,
      histories: histories.map(({ name, workflowId, runId, eventCount, lastEventType }) => ({
        name,
        workflowId,
        runId,
        eventCount,
        lastEventType,
      })),
      wallClockMs: Date.now() - startedAt,
    });
    console.log(
      `generated ${scenario.id} (${histories.map((h) => `${h.name}:${h.eventCount} events`).join(', ')})`
    );
  }

  const provenance = {
    generatedAt: new Date().toISOString(),
    generator: 'rehearsals/14/run.mjs generate',
    synthetic: true,
    note: 'All ids, tokens, emails and payloads are synthetic (.invalid). No production history was read or stored.',
    candidate: { workflowsPath: rel(CANDIDATE_WORKFLOWS), ...gitState() },
    legacy: {
      commit: JSON.parse(readFileSync(join(LEGACY_DIR, 'base/MANIFEST.json'), 'utf8')).legacyCommit,
      extractedFrom: 'legacy/extract.mjs (git show, verbatim)',
      manifestSha256: sha256(readFileSync(join(LEGACY_DIR, 'base/MANIFEST.json'))),
      patchedDerivation:
        'legacy/patched = legacy/base + documented patched()/continue-as-new gates (lib/derive-patched.mjs)',
    },
    bundles: {
      base: { workflowsPath: rel(LEGACY_BASE_WORKFLOWS), sha256: baseBundle.sha256 },
      patched: { workflowsPath: rel(LEGACY_PATCHED_WORKFLOWS), sha256: patchedBundle.sha256 },
    },
    lockfileSha256: sha256(readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'))),
    tooling: { ...TOOLING, testServer: testServerInfo() },
    searchAttributes: ['postId TEXT', 'organizationId TEXT'],
    timeSkipping: true,
    scenarios: generated,
  };
  writeFileSync(join(FIXTURES_DIR, 'provenance.json'), JSON.stringify(provenance, null, JSON_INDENT) + '\n');

  console.log(`\n${generated.length} fixtures written to ${FIXTURES_DIR}`);
  return provenance;
}

export { HOUR };
