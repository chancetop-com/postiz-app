/**
 * Fault ledger shared by the harness and the preloaded substitute.
 *
 * The file is rewritten between phases and read by the candidate on every
 * provider call, so faults can be armed and disarmed without a restart. The
 * harness never edits product code.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FAULT_FILE, WORK_DIR } from './paths.mjs';

mkdirSync(WORK_DIR, { recursive: true });

export function armFaults(faults) {
  writeFileSync(FAULT_FILE, JSON.stringify(faults, null, 2));
  mkdirSync(dirname(FAULT_FILE), { recursive: true });
}

export function clearFaults() {
  armFaults({});
}

export function readFaults() {
  try {
    return JSON.parse(readFileSync(FAULT_FILE, 'utf8'));
  } catch {
    return {};
  }
}
