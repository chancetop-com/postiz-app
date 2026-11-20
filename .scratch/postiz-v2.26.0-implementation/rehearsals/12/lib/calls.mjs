/**
 * Reader/writer for the boundary call log produced by `stub-provider.cjs`.
 * Every entry is synthetic and stays inside the rehearsal work directory.
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
      writeFileSync(
        path,
        JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n',
        { flag: 'a' }
      );
    },
  };
}

const read = (calls) => (Array.isArray(calls) ? calls : calls.read());

export const providerCalls = (calls, method) =>
  read(calls).filter((call) => call.method === method);

export const publishCalls = (calls) =>
  read(calls).filter(
    (call) => call.method === 'post' || call.method === 'postPending'
  );

export const emails = (calls) =>
  read(calls).filter((call) => call.method === 'email');

export const comments = (calls) =>
  read(calls).filter((call) => call.method === 'postComment');

export const refreshCalls = (calls) =>
  read(calls).filter((call) => call.method === 'providerRefreshToken');
