/**
 * Offline replay.
 *
 * Bundles the candidate orchestrator workflows exactly like the worker does at
 * runtime, then feeds every stored history to `Worker.runReplayHistory`. No
 * server, database or network is involved: a non-determinism error therefore
 * means the candidate cannot resume the recorded execution.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '@temporalio/proto';
import { Worker } from '@temporalio/worker';
import { bundleCandidate } from './bundle.mjs';
import { CANDIDATE_WORKFLOWS, COMPILED_WORKFLOWS, FIXTURES_DIR, RESULTS_DIR } from './paths.mjs';

const { temporal } = pkg;
const History = temporal.api.history.v1.History;

function fixtureFiles() {
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'provenance.json')
    .sort();
}

export async function replay({ workflowsPath, dist = false } = {}) {
  const entry = workflowsPath ?? (dist ? COMPILED_WORKFLOWS : CANDIDATE_WORKFLOWS);
  const bundle = await bundleCandidate(entry);
  const provenance = JSON.parse(readFileSync(join(FIXTURES_DIR, 'provenance.json'), 'utf8'));

  const cases = [];
  for (const file of fixtureFiles()) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
    for (const entry of fixture.histories) {
      const startedAt = Date.now();
      let error = null;
      try {
        await Worker.runReplayHistory(
          { workflowBundle: { code: bundle.code }, taskQueue: 'main' },
          History.fromObject(entry.history),
          entry.workflowId
        );
      } catch (err) {
        error = {
          name: err?.name ?? 'Error',
          message: String(err?.message ?? err).split('\n').slice(0, 24).join('\n'),
        };
      }

      const result = {
        scenarioId: fixture.scenario.id,
        history: entry.name,
        workflowType: fixture.scenario.workflowType,
        workflowId: entry.workflowId,
        runId: entry.runId,
        events: entry.eventCount,
        lastEventType: entry.lastEventType,
        sourceBundle: fixture.scenario.bundle,
        status: error ? 'FAILED' : 'replayed',
        error,
        wallClockMs: Date.now() - startedAt,
      };
      cases.push(result);

      const label = error ? 'FAIL' : 'ok  ';
      console.log(`${label} ${result.scenarioId}/${entry.name} (${result.workflowType}, ${result.events} events)`);
      if (error) {
        console.error(`     ${error.name}: ${error.message.split('\n')[0]}`);
      }
    }
  }

  const failures = cases.filter((testCase) => testCase.status === 'FAILED');
  const report = {
    replayedAt: new Date().toISOString(),
    candidate: {
      workflowsPath: entry.replace(`${process.cwd()}/`, ''),
      bundleSha256: bundle.sha256,
      revision: provenance.candidate,
    },
    fixtures: {
      generatedAt: provenance.generatedAt,
      legacyCommit: provenance.legacy.commit,
      legacyBundleSha256: provenance.bundles.base.sha256,
      patchedBundleSha256: provenance.bundles.patched.sha256,
      lockfileSha256: provenance.lockfileSha256,
    },
    totals: { histories: cases.length, replayed: cases.length - failures.length, failed: failures.length },
    cases,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const reportPath = join(RESULTS_DIR, 'replay-latest.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

  if (failures.length) {
    console.error(
      `\n${failures.length} of ${cases.length} histories failed to replay with the candidate bundle.` +
        `\nReport: ${reportPath}\n` +
        `A non-determinism error means the workflow code changed its commands against history;` +
        ` keep the contract (patch or keep the old definition), do not delete the fixture.`
    );
    const error = new Error('temporal replay failed');
    error.report = report;
    throw error;
  }

  console.log(`\n${cases.length} histories replayed with the candidate bundle (${bundle.sha256.slice(0, 12)})`);
  console.log(`Report: ${reportPath}`);
  return report;
}
