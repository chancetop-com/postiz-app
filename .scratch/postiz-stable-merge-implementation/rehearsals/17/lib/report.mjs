/**
 * Assertions and evidence for ticket 17.
 *
 * Two documents come out of a run:
 *   - the scenario document (assertions/observations, like tickets 15/16);
 *   - the unknown-result registry: for every injected fault, what the platform
 *     substitute actually did, what the local record says, and whether the
 *     result is knowable afterwards.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_DIR, REPO_ROOT, RESULTS_DIR } from './paths.mjs';

mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

const document = {
  ticket: 17,
  generatedAt: new Date().toISOString(),
  node: process.version,
  scenarios: [],
  failures: [],
  faults: [],
  queues: {
    workflows: {},
    activities: {},
  },
};

let current = null;

export function beginScenario(id, description) {
  current = {
    id,
    description,
    startedAt: new Date().toISOString(),
    observations: [],
    assertions: [],
  };
  document.scenarios.push(current);
  console.log(`\n=== ${id} — ${description}`);
}

export function observe(name, value) {
  current.observations.push({ name, value });
  console.log(`  · ${name}: ${format(value)}`);
}

export function expectEqual(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  current.assertions.push({ name, ok, actual, expected });
  if (!ok) {
    throw new Error(`${name}: expected ${format(expected)}, got ${format(actual)}`);
  }
  console.log(`  ✓ ${name}`);
}

export function expectTrue(name, value, detail) {
  const ok = !!value;
  current.assertions.push({ name, ok, actual: value, ...(detail ? { detail } : {}) });
  if (!ok) {
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ✓ ${name}`);
}

/**
 * Records one injected fault.
 *
 * `platform` is what the external substitute observed; `local` is what the
 * database/Temporal says. `knowable` is the ticket's core question: after the
 * fault, can an operator tell "published" from "not published" from the
 * evidence at hand? `classification` is complete | failed | unknown.
 */
export function recordFault({
  id,
  injection,
  platform,
  temporal,
  local,
  knowable,
  classification,
  note,
}) {
  document.faults.push({
    id,
    injection,
    platform,
    temporal,
    local,
    knowable,
    classification,
    ...(note ? { note } : {}),
  });
  console.log(
    `  ⚑ fault ${id}: external=${classification} knowable=${knowable} (${injection})`
  );
}

/** Counts workflow and activity task dispatches per queue into the roll-up. */
export function recordQueues({ workflowTaskQueue, activityScheduled = [] }) {
  if (workflowTaskQueue) {
    document.queues.workflows[workflowTaskQueue] =
      (document.queues.workflows[workflowTaskQueue] || 0) + 1;
  }
  for (const activity of activityScheduled) {
    if (!activity.taskQueue) continue;
    document.queues.activities[activity.taskQueue] =
      (document.queues.activities[activity.taskQueue] || 0) + 1;
  }
}

export function recordFailure(scenarioId, error) {
  document.failures.push({
    scenario: scenarioId,
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  console.error(`  ✗ ${error?.message ?? error}`);
}

export function finish(summaryTitle = 'Ticket 17 — fault injection / recovery rehearsal') {
  document.finishedAt = new Date().toISOString();
  document.ok = document.failures.length === 0;
  const path = join(RESULTS_DIR, 'latest.json');
  const serialized = JSON.stringify(document, null, 2).split(REPO_ROOT).join('<repo>');
  writeFileSync(path, serialized);

  const lines = [
    summaryTitle,
    `generated: ${document.generatedAt}`,
    `node: ${document.node}`,
    `result: ${document.ok ? 'PASS' : 'FAIL'}`,
    '',
    'queue consumption:',
    `  workflow tasks: ${JSON.stringify(document.queues.workflows)}`,
    `  activity tasks: ${JSON.stringify(document.queues.activities)}`,
    '',
    'unknown-result registry:',
  ];
  for (const fault of document.faults) {
    lines.push(
      `  ${fault.id}: ${fault.classification}/${fault.knowable} — ${fault.injection}`
    );
  }
  lines.push('');

  for (const scenario of document.scenarios) {
    lines.push(`## ${scenario.id} — ${scenario.description}`);
    for (const observation of scenario.observations) {
      lines.push(`  · ${observation.name}: ${format(observation.value)}`);
    }
    for (const assertion of scenario.assertions) {
      lines.push(
        `  ${assertion.ok ? 'PASS' : 'FAIL'}  ${assertion.name}` +
          (assertion.ok
            ? ''
            : ` (expected ${format(assertion.expected)}, got ${format(assertion.actual)})`)
      );
    }
    lines.push('');
  }
  for (const failure of document.failures) {
    lines.push(`FAILED ${failure.scenario}: ${failure.message}`);
  }
  const summaryPath = join(EVIDENCE_DIR, 'summary.txt');
  writeFileSync(summaryPath, lines.join('\n'));
  return { document, path, summaryPath };
}

function format(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return 'undefined';
  // Evidence is committed: never embed the machine-specific checkout path.
  return text.split(REPO_ROOT).join('<repo>');
}
