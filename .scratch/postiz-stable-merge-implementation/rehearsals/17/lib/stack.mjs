/**
 * Stack helpers for ticket 17.
 *
 * Boots the same compiled candidate processes as tickets 15/16 (reusing ticket
 * 16's stack verbatim through its optional `preload` seam), and adds the two
 * things fault injection needs: arming/disarming a fault file without a
 * restart, and killing a worker the way a crashed pod does (SIGKILL, no
 * graceful shutdown).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  startBackend as startBackend16,
  startOrchestrator as startOrchestrator16,
  waitForHttp,
} from '../../16/lib/stack.mjs';
import { FAULT_FILE, PRELOAD, WORK_DIR } from './paths.mjs';

mkdirSync(WORK_DIR, { recursive: true });

export { waitForHttp };

export function armFaults(faults) {
  writeFileSync(FAULT_FILE, JSON.stringify(faults, null, 2));
}

export function clearFaults() {
  armFaults({});
}

export async function startOrchestrator(options) {
  return startOrchestrator16({
    ...options,
    preload: PRELOAD,
    extraEnv: { T17_FAULT_FILE: FAULT_FILE, ...(options.extraEnv || {}) },
  });
}

export async function startBackend(options) {
  return startBackend16({
    ...options,
    preload: PRELOAD,
    extraEnv: { T17_FAULT_FILE: FAULT_FILE, ...(options.extraEnv || {}) },
  });
}
/** True when the pid exists, independently of whether its API answers. */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kills the whole process group the way an OOM-kill or a hard pod eviction
 * does: no SIGTERM handler runs, no graceful worker shutdown, no chance to
 * report the activity result.
 */
export async function killProcessGroup(proc) {
  const pid = proc?.process?.child?.pid;
  if (!pid) return false;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return false;
    }
  }
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (!processAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export function docker(container, args, input) {
  return execFileSync('docker', ['exec', ...(input ? ['-i'] : []), container, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}
