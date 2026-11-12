#!/usr/bin/env node
/**
 * Extracts the pre-upgrade orchestrator workflow sources verbatim from the
 * product-behaviour baseline commit (the fork's customisation commit C).
 *
 * Everything written into `base/` is produced by `git show`, never edited by
 * hand, so a reviewer can re-run this script and diff the result:
 *
 *   node .scratch/postiz-stable-merge-implementation/rehearsals/14/legacy/extract.mjs
 *   git -C . diff --stat -- .scratch/postiz-stable-merge-implementation/rehearsals/14/legacy/base
 *
 * Output:
 *   base/index.ts                     workflows entrypoint that the old worker bundled
 *   base/workflows/**                 old workflow definitions
 *   base/signals/**                   old signal + payload definitions
 *   base/MANIFEST.json                commit, per-file blob sha and monorepo import map
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Product-behaviour baseline: `6fdf7cb53543fa28a470ad63e7619e8b98bcee43`. */
export const LEGACY_COMMIT = '6fdf7cb53543fa28a470ad63e7619e8b98bcee43';

/** Repo root (this file lives at .scratch/.../rehearsals/14/legacy/extract.mjs). */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const FILES = [
  // Workflow entrypoint exactly as the old worker resolved it
  'apps/orchestrator/src/workflows/index.ts',
  // Post publishing definitions reachable by old executions
  'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.1.ts',
  'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.2.ts',
  // Long running definitions that exist with the same name in the candidate
  'apps/orchestrator/src/workflows/autopost.workflow.ts',
  'apps/orchestrator/src/workflows/missing.post.workflow.ts',
  'apps/orchestrator/src/workflows/streak.workflow.ts',
  'apps/orchestrator/src/workflows/send.email.workflow.ts',
  'apps/orchestrator/src/workflows/digest.email.workflow.ts',
  'apps/orchestrator/src/workflows/refresh.token.workflow.ts',
  // Signal + payload contracts the old histories reference
  'apps/orchestrator/src/signals/email.signal.ts',
  'apps/orchestrator/src/signals/send.email.signal.ts',
];

const git = (args) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });

export function extract({ commit = LEGACY_COMMIT, outDir = join(dirname(fileURLToPath(import.meta.url)), 'base') } = {}) {
  const entries = FILES.map((path) => {
    const source = git(['show', `${commit}:${path}`]);
    const blob = git(['rev-parse', `${commit}:${path}`]).trim();
    // base/ keeps the old tree shape below apps/orchestrator/src so the import
    // rewriter can mirror `@gitroom/orchestrator/*` onto the old files.
    const rel = path.replace('apps/orchestrator/src/', '');
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
    return { path, blob, target: rel };
  });

  const manifest = {
    legacyCommit: commit,
    extractedWith: 'legacy/extract.mjs (git show, no manual edits)',
    files: entries,
  };
  writeFileSync(join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = extract();
  console.log(`extracted ${manifest.files.length} files from ${manifest.legacyCommit}`);
  for (const file of manifest.files) console.log(`  ${file.blob}  ${file.path}`);
}
