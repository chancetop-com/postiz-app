#!/usr/bin/env node
/**
 * Temporal history replay rehearsal (implementation ticket 14).
 *
 *   node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs generate
 *       Build the two pre-upgrade bundles, run every scenario on an ephemeral
 *       time-skipping Temporal test server and store the event histories under
 *       fixtures/. Downloads the test server binary on first use.
 *
 *   node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs replay
 *       Bundle the candidate orchestrator workflows and replay every fixture
 *       through `Worker.runReplayHistory`. Offline, no server needed. Exits
 *       non-zero and prints the failing history on a determinism error.
 *       Add `--dist` to replay against the compiled worker entrypoint
 *       (`apps/orchestrator/dist/.../workflows/index.js`) instead, which is
 *       what the running worker resolves after `pnpm run build`.
 *
 *   node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs all
 *       generate, then replay.
 *
 *   node .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs check-detection
 *       Replay a fixture against a deliberately divergent workflow definition
 *       and require the determinism check to reject it.
 */
import { checkDetection } from './lib/check-detection.mjs';
import { generate } from './lib/generate.mjs';
import { replay } from './lib/replay.mjs';

const [, , command = 'replay', ...flags] = process.argv;

const hasFlag = (name) => flags.includes(name);
const flagValue = (name) => {
  const index = flags.indexOf(name);
  return index === -1 ? undefined : flags[index + 1];
};

try {
  if (command === 'generate') {
    await generate({ refreshLegacy: hasFlag('--refresh-legacy') });
  } else if (command === 'replay') {
    await replay({
      workflowsPath: flagValue('--workflows'),
      dist: hasFlag('--dist'),
    });
  } else if (command === 'all') {
    await generate({ refreshLegacy: hasFlag('--refresh-legacy') });
    await replay();
  } else if (command === 'check-detection') {
    await checkDetection();
  } else {
    console.error(`unknown command "${command}" (expected generate | replay | all | check-detection)`);
    process.exit(2);
  }
} catch (err) {
  console.error(`\nrehearsal failed: ${err?.message ?? err}`);
  process.exit(1);
}
