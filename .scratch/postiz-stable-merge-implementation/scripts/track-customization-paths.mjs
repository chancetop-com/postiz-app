#!/usr/bin/env node
/**
 * Tracks every customized path from the two customization commits
 * (f042c177, 6fdf7cb5) into the merged candidate.
 *
 * Emits a TSV with one row per path:
 *   path  area  owning_ticket  disposition  changed_since_customization  notes
 *
 * Disposition is derived from git, not from the file inventory: a path is
 * "retained" when the merged tree still carries the customized content,
 * "upstream-replaced" when the merge took an upstream implementation,
 * "absent" when the path no longer exists, and "generated-copy" for the
 * k8s build copy that is now produced by k8s/prepare-build-context.sh.
 *
 * Usage: node track-customization-paths.mjs <out.tsv>
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['-C', join(HERE, '..', '..', '..'), 'rev-parse', '--show-toplevel'])
  .toString()
  .trim();

const INVENTORY = join(REPO, '.scratch/postiz-stable-merge/assets/customization-file-inventory.tsv');
const CUSTOMIZED = '6fdf7cb53543fa28a470ad63e7619e8b98bcee43';
const TARGET = 'a5affe62c74e39c1e7ac960d50d8418b807d532c';

const git = (...args) =>
  execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 64 * 1024 * 1024 }).toString();

/** Owning implementation ticket, by path. First match wins. */
const OWNERS = [
  [/^k8s\//, '13', 'image-runtime', 'generated copy refreshed by k8s/prepare-build-context.sh'],
  [/^k8s\/Dockerfile/, '13', 'image-runtime', 'context-only Dockerfile'],
  [/^var\/docker\//, '13', 'image-runtime', 'nginx/PM2/compose configuration'],
  [/^Dockerfile\.dev$/, '13', 'image-runtime', 'dev dockerfile'],
  [/^docker-compose/, '13', 'image-runtime', 'local compose (dev use)'],
  [/prisma\/schema\.prisma/, '03', 'startup-sync-data-retention', 'merged schema + startup db push'],
  [/prisma\//, '03', 'startup-sync-data-retention', 'data layer'],
  [/^apps\/orchestrator\//, '15', 'scheduled-post-continuity', 'workflow continuity'],
  [/temporal|workflow/i, '14', 'temporal-history-replay', 'workflow compatibility'],
  [/services\/auth\//, '04', 'merchant-sso', 'SSO exchange and merchant account'],
  [/api\/routes\/auth\.controller/, '04', 'merchant-sso', 'SSO entry point'],
  [/api\/routes\/users\.controller/, '05', 'session-organization-login', 'user/org endpoints'],
  [/api\/routes\/copilot\.controller/, '12', 'optional-services', 'optional-service degradation'],
  [/^apps\/backend\/src\/main\.ts$/, '12', 'optional-services', 'MCP non-fatal startup'],
  [/^apps\/backend\/src\/api\/api\.module\.ts$/, '12', 'optional-services', 'module wiring'],
  [/^apps\/frontend\/src\/proxy\.ts$/, '05', 'session-organization-login', 'no cookie gate in proxy'],
  [/sso\/|sso\./, '04', 'merchant-sso', 'SSO page and service'],
  [/layout\/layout\.context|user\.context|logout|activate|login/, '05', 'session-organization-login', 'session and login'],
  [/^apps\/frontend\/src\/components\/new-layout\//, '06', 'brand-theme-navigation', 'brand and navigation'],
  [/^apps\/frontend\/src\/app\/\(app\)\/auth\//, '06', 'brand-theme-navigation', 'auth layout branding'],
  [/layout\/top\.menu|layout\/menu-item/, '06', 'brand-theme-navigation', 'hidden nav entries'],
  [/ui\/icons/, '06', 'brand-theme-navigation', 'icon set'],
  [/analytics\//, '06', 'brand-theme-navigation', 'analytics theme'],
  [/^apps\/frontend\/src\/components\/billing\//, '06', 'brand-theme-navigation', 'billing theme'],
  [/media/, '10', 'media-editing', 'media editor, upload and library'],
  [/launches\/add\.provider|launches\/continue\.integration|channel-relay/, '07', 'channel-oauth-direct', 'six-channel entry and relay'],
  [/launches\//, '07', 'channel-oauth-direct', 'launch screen'],
  [/preview\//, '11', 'public-preview', 'anonymous preview'],
  [/^apps\/frontend\/src\/components\/agents\//, '12', 'optional-services', 'optional AI service'],
  [/^libraries\/nestjs-libraries\/src\/integrations\//, '09', 'existing-channel-credentials', 'provider registration'],
  [/^libraries\//, '02', 'merge-stable-release', 'shared library'],
  [/^apps\/backend\//, '02', 'merge-stable-release', 'backend application'],
  [/^apps\/frontend\//, '02', 'merge-stable-release', 'frontend application'],
];

const ownerFor = (path) => {
  for (const [re, ticket, area, note] of OWNERS) {
    if (re.test(path)) return { ticket, area, note };
  }
  if (/^(\.env|README|AGENTS|CLAUDE|CONTRIBUTING|docker|package|pnpm|tsconfig|eslint|jest|i18n|sonar|railway|\.github|doc|docs)/.test(path)) {
    return { ticket: '02', area: 'merge-stable-release', note: 'root configuration or documentation' };
  }
  return { ticket: '02', area: 'merge-stable-release', note: 'root level' };
};

const readInventory = () => {
  const lines = execFileSync('cat', [INVENTORY]).toString().split('\n').filter(Boolean);
  const header = lines[0].split('\t');
  const idx = (name) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    return {
      path: cols[idx('path')],
      samePathOverlap: cols[idx('same_path_overlap')],
      unmergedStages: cols[idx('unmerged_stages')],
      CBlob: cols[idx('C_blob')],
    };
  });
};

/** blob sha of `path` at `ref`, or null when the path does not exist there */
const blobAt = (ref, path) => {
  try {
    return git('rev-parse', `${ref}:${path}`).trim();
  } catch {
    return null;
  }
};

/** is `path` present in the working tree (the merged candidate) */
const presentInWorktree = (path) => {
  try {
    git('ls-files', '--error-unmatch', '--', path);
    return true;
  } catch {
    return false;
  }
};

const worktreeBlob = (path) => {
  try {
    return git('hash-object', '--', join(REPO, path)).trim();
  } catch {
    return null;
  }
};

const rows = [];
const counts = {};

for (const entry of readInventory()) {
  const owner = ownerFor(entry.path);
  const present = presentInWorktree(entry.path);

  let disposition;
  let notes = owner.note;

  if (!present) {
    disposition = 'absent';
    notes += '; no longer present in the merged tree';
  } else if (entry.path.startsWith('k8s/') && !/^k8s\/(Dockerfile|Dockerfile\.runtime|\.dockerignore|build-|deploy-|prepare-|ecosystem|tests|README|\.core-ai)/.test(entry.path)) {
    disposition = 'generated-copy';
  } else {
    const current = worktreeBlob(entry.path);
    if (current === entry.CBlob) {
      disposition = 'retained';
    } else {
      const upstream = blobAt(TARGET, entry.path);
      disposition = upstream && current === upstream ? 'upstream-replaced' : 'adapted';
      if (disposition === 'upstream-replaced') {
        notes += '; merged content equals the upstream stable version';
      } else {
        notes += '; merged content differs from both the customization and upstream';
      }
    }
  }

  if (entry.path.startsWith('k8s/') && disposition === 'generated-copy') {
    const rootPath = entry.path.slice('k8s/'.length);
    notes = `mirrors ${rootPath} through k8s/prepare-build-context.sh`;
  }

  counts[disposition] = (counts[disposition] || 0) + 1;
  rows.push([entry.path, owner.area, owner.ticket, disposition, present ? 'yes' : 'no', notes]);
}

const out = process.argv[2];
if (!out) {
  console.error('usage: track-customization-paths.mjs <out.tsv>');
  process.exit(2);
}

const header = ['path', 'area', 'owning_ticket', 'disposition', 'present', 'notes'];
writeFileSync(out, [header, ...rows].map((r) => r.join('\t')).join('\n') + '\n');

console.log(`tracked ${rows.length} customized paths -> ${out}`);
for (const [key, value] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key.padEnd(20)} ${value}`);
}

const byTicket = {};
for (const row of rows) byTicket[row[2]] = (byTicket[row[2]] || 0) + 1;
console.log('by owning ticket:');
for (const [ticket, value] of Object.entries(byTicket).sort()) {
  console.log(`  ${ticket.padEnd(4)} ${value}`);
}
