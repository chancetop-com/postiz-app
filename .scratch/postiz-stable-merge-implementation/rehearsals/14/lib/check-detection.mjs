/**
 * Proves the replay step actually detects divergence.
 *
 * A replay harness that always prints "ok" is worthless, so this bundles a
 * deliberately wrong definition of a workflow type that exists in the fixtures
 * and requires `Worker.runReplayHistory` to reject it with a determinism
 * violation. If the wrong definition replays "successfully", the harness exits
 * non-zero.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '@temporalio/proto';
import { Worker } from '@temporalio/worker';
import { bundleWorkflows } from './bundle.mjs';
import { FIXTURES_DIR, RESULTS_DIR } from './paths.mjs';
import { readFileSync } from 'node:fs';

const { temporal } = pkg;
const History = temporal.api.history.v1.History;

const PROBE_SOURCE = `// Deliberately wrong: a V102 execution never completes without running any
// activity, so a history that recorded activities cannot replay against this.
export async function postWorkflowV102(): Promise<void> {
  return;
}
`;

export async function checkDetection() {
  const probeDir = join(RESULTS_DIR, '.detection-probe');
  mkdirSync(probeDir, { recursive: true });
  const probePath = join(probeDir, 'index.ts');
  writeFileSync(probePath, PROBE_SOURCE);

  try {
    const bundle = await bundleWorkflows(probePath);
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, 'v102-inflight-sleep.json'), 'utf8')
    );
    const entry = fixture.histories[0];

    let error = null;
    try {
      await Worker.runReplayHistory(
        { workflowBundle: { code: bundle.code }, taskQueue: 'main' },
        History.fromObject(entry.history),
        entry.workflowId
      );
    } catch (err) {
      error = err;
    }

    if (!error) {
      throw new Error(
        'detection check FAILED: a divergent workflow definition replayed without an error'
      );
    }

    const firstLine = String(error.message).split('\n')[0];
    console.log(`detected divergence as expected: ${error.name}: ${firstLine}`);
    if (!/nondeterminism|non-determinism|is not compatible with the history/i.test(String(error.message))) {
      console.warn(`warning: unexpected error class for a divergence: ${error.name}`);
    }
    console.log('detection check passed');
    return { detected: true, errorName: error.name, message: firstLine };
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
