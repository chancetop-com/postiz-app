/**
 * Reads the stub call log (JSON lines written by the preloaded substitutes).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function createCallLog(path) {
  writeFileSync(path, '');
  return {
    path,
    read() {
      if (!existsSync(path)) return [];
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { malformed: line };
          }
        });
    },
    record(entry) {
      writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', {
        flag: 'a',
      });
    },
  };
}

export const providerCalls = (calls, method) =>
  calls.read().filter((call) => call.method === method);

export const publishCalls = (calls) =>
  calls
    .read()
    .filter((call) => call.method === 'post' || call.method === 'postPending');

export const emails = (calls) =>
  calls.read().filter((call) => call.method === 'email');
