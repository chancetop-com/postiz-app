/**
 * Assertion and evidence recording.
 *
 * Every scenario records named observations (payload contract, database row,
 * Temporal history, stub calls) into one JSON document. A failed assertion
 * aborts the run with the scenario name, so the summary cannot claim a pass
 * that was not measured.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_DIR, REPO_ROOT, RESULTS_DIR } from './paths.mjs';

mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

const document = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  scenarios: [],
  failures: [],
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
    throw new Error(
      `${name}: expected ${format(expected)}, got ${format(actual)}`
    );
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

export function recordFailure(scenarioId, error) {
  document.failures.push({
    scenario: scenarioId,
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  console.error(`  ✗ ${error?.message ?? error}`);
}

export function finish() {
  document.finishedAt = new Date().toISOString();
  document.ok = document.failures.length === 0;
  const path = join(RESULTS_DIR, 'latest.json');
  const serialized = JSON.stringify(document, null, 2)
    .split(REPO_ROOT)
    .join('<repo>');
  writeFileSync(path, serialized);

  const lines = [
    'Ticket 15 — scheduled-post continuity rehearsal',
    `generated: ${document.generatedAt}`,
    `node: ${document.node}`,
    `result: ${document.ok ? 'PASS' : 'FAIL'}`,
    '',
  ];
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
