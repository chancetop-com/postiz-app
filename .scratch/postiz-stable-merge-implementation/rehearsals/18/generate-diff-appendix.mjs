#!/usr/bin/env node
// Ticket 18 — regenerate the complete file appendix of the delivery report.
//
// The appendix lists EVERY path that differs from the locked upstream target
// (a5affe62, v2.25.3) in the delivered tree: committed changes plus the files
// that are still uncommitted when this script runs (the report and this
// appendix themselves). Nothing is filtered out.
//
// Usage: node .scratch/postiz-stable-merge-implementation/rehearsals/18/generate-diff-appendix.mjs
//
// Output: .scratch/postiz-stable-merge/assets/final-diff-file-appendix.tsv

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const UPSTREAM = 'a5affe62c74e39c1e7ac960d50d8418b807d532c';
const CUSTOMIZATION = '6fdf7cb53543fa28a470ad63e7619e8b98bcee43';
const CUSTOMIZATION_1 = 'f042c177c1a378edacd54790614bdd9f709a2480';
const OUT = '.scratch/postiz-stable-merge/assets/final-diff-file-appendix.tsv';

const git = (args) =>
  spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

const inCommit = (commit, path) =>
  git(['cat-file', '-e', `${commit}:${path}`]).status === 0;

const identicalTo = (commit, path) =>
  inCommit(commit, path) &&
  git(['diff', '--quiet', commit, 'HEAD', '--', path]).status === 0;

// ---------------------------------------------------------------- path set
const status = new Map();
for (const line of git(['diff', '--name-status', `${UPSTREAM}...HEAD`])
  .stdout.trim()
  .split('\n')
  .filter(Boolean)) {
  const [st, ...rest] = line.split('\t');
  status.set(rest.join('\t'), st);
}

// Uncommitted deliveries (the report and this appendix) are part of the
// delivered tree too, so they are added when they are not committed yet.
// Do not .trim() the status output: the first line starts with a space
// (" M path") and trimming it would shift the two status columns.
for (const line of git(['status', '--porcelain', '--untracked-files=all'])
  .stdout.replace(/\n+$/, '')
  .split('\n')
  .filter((l) => l.trim())) {
  const st = line.slice(0, 2);
  const path = line.slice(3).replace(/^"|"$/g, '');
  if (status.has(path)) continue;
  status.set(path, st.includes('?') || st.includes('A') ? 'A' : 'M');
}

const numstat = new Map();
for (const line of git(['diff', '--numstat', `${UPSTREAM}...HEAD`])
  .stdout.trim()
  .split('\n')) {
  const [added, deleted, ...rest] = line.split('\t');
  numstat.set(rest.join('\t'), [added, deleted]);
}

// ---------------------------------------------------------------- grouping
function group(path) {
  if (path.startsWith('k8s/apps/')) return 'k8s-generated-apps';
  if (path.startsWith('k8s/libraries/')) return 'k8s-generated-libraries';
  if (path.startsWith('k8s/var/')) return 'k8s-generated-var';
  if (path.startsWith('k8s/tests/')) return 'k8s-contract-tests';
  if (path.startsWith('k8s/')) return 'k8s-deployment-tree';
  if (path.startsWith('.scratch/')) return 'planning-evidence';
  if (path.startsWith('tests/')) return 'regression-tests';
  if (path.startsWith('docs/') || path.startsWith('doc/')) return 'documentation';
  if (path.startsWith('apps/backend/')) return 'source-backend';
  if (path.startsWith('apps/frontend/')) return 'source-frontend';
  if (path.startsWith('apps/orchestrator/')) return 'source-orchestrator';
  if (path.startsWith('libraries/')) return 'source-shared-libraries';
  if (path.startsWith('var/')) return 'local-var-assets';
  if (path.startsWith('docker/')) return 'local-docker-compose';
  return 'root-config-tooling';
}

const GROUP_REASON = {
  'k8s-generated-apps':
    'generated mirror of apps/ produced by k8s/prepare-build-context.sh; never hand-edited (ticket 01/13)',
  'k8s-generated-libraries':
    'generated mirror of libraries/ produced by k8s/prepare-build-context.sh; never hand-edited (ticket 01/13)',
  'k8s-generated-var':
    'generated mirror of var/docker/ (nginx, PM2 ecosystem, entrypoint) produced by k8s/prepare-build-context.sh',
  'k8s-contract-tests':
    'build-context and runtime-contract shell tests for the local deployment tree (ticket 01/03/13)',
  'k8s-deployment-tree':
    'local build/deploy split, Dockerfiles and mirror configuration; no cluster access is performed by any script (ticket 01)',
  'planning-evidence':
    'tickets, decisions, spec and rehearsal evidence for this upgrade; not a build input (excluded by prepare-build-context.sh)',
  'regression-tests':
    'vitest contract/regression suite added by the implementation tickets; runs under pnpm run test',
  documentation: 'repository documentation kept or added by the fork (agent instructions, SSO notes, tooling docs)',
  'local-var-assets':
    'pre-merge research documents and the PM2/nginx/entrypoint assets that the image really uses',
  'local-docker-compose': 'local Temporal/docker-compose used by the rehearsals',
};

const PATH_REASON = {
  '.env.example':
    'custom SSO block kept next to upstream reCAPTCHA / HIDDEN_PROVIDERS / MIGRATE_PROVIDERS variables (ticket 02)',
  '.gitignore': 'ignores the generated build manifest and the upstream-generated apps/frontend/public/g.js (ticket 02)',
  '.eslintignore': 'removed: superseded by the flat eslint.config.mjs (ticket 02)',
  'eslint.config.mjs': 'flat ESLint config covering the three apps and the shared libraries (ticket 02)',
  'jest.config.ts': 'removed: the dead Jest entry was replaced by vitest (ticket 02)',
  'jest.preset.js': 'removed: the dead Jest entry was replaced by vitest (ticket 02)',
  'vitest.config.mts': 'working vitest entry with jsdom for tsx suites (ticket 02/04/06/11)',
  'package.json': 'root scripts (typecheck/lint/test/test:replay) and the @temporalio/testing devDependency (ticket 01/14)',
  'pnpm-lock.yaml': 'recomputed by pnpm after the merge and the test toolchain additions; never hand-merged (ticket 02/14)',
  'Dockerfile.dev': 'official startup-sync entrypoint plus nginx+pm2 command (ticket 03/13)',
  'README.md': 'fork notes on the local build/deploy split and the rehearsal entry points (ticket 01/02)',
  'AGENTS.md': 'repository agent instructions (fork tooling, not product behaviour)',
  'CONTEXT.md': 'shared context for the implementation tickets (fork tooling)',
  'CLAUDE.md': 'type change: kept as a symlink to AGENTS.md, discarding the upstream regular file (ticket 02)',
  '.codegraph/.gitignore': 'local code-intelligence index ignore file (fork tooling)',

  'apps/backend/src/api/api.module.ts': 'keeps SsoService registration next to the upstream StripeController (ticket 02/04)',
  'apps/backend/src/api/routes/auth.controller.ts':
    'SSO login/logout entry plus upstream returnUrl/session fixes; the merge had dropped the getCookieUrlFromDomain import, restored in e331b115 (ticket 02/04)',
  'apps/backend/src/api/routes/copilot.controller.ts':
    'keeps both 503 "AI not configured" branches in front of the upstream Node handler (ticket 02/12)',
  'apps/backend/src/api/routes/users.controller.ts': 'change-org endpoint writing the showorg header (ticket 02/05)',
  'apps/backend/src/main.ts': 'non-blocking MCP startup, unhandledRejection logging and the upstream Copilot/CORS wiring (ticket 02/12)',
  'apps/backend/src/services/auth/auth.middleware.ts':
    'default organisation is the first usable membership again, not the upstream subscription-preferred one (ticket 05)',
  'apps/backend/src/services/auth/auth.service.ts': 'keeps signJwt and adopts the upstream sendEmailSync rename (ticket 02)',
  'apps/backend/src/services/auth/sso.service.ts': 'SSO exchange and merchant account creation (ticket 04)',
  'apps/backend/tsconfig.build.json': 'chat/agent build excludes kept from the fork; also proves they are not a feature switch (ticket 02)',
  'apps/frontend/next.config.js': 'fork frontend build configuration (ticket 02)',
  'apps/frontend/public/logo-postiz.png': 'local PNG brand asset used by the 32x32 layout logo (ticket 06)',
  'apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx':
    'preview fetch tolerance extracted to a tested helper; sanitisation, comments and 1346px layout unchanged (ticket 11)',
  'apps/frontend/src/app/(app)/auth/layout.tsx': 'local light theme classes inside the upstream MantineWrapper/Toaster (ticket 02/06)',
  'apps/frontend/src/app/(app)/auth/sso/page.tsx': 'Next 16 Promise searchParams fix so /auth/sso?token really forwards the code (ticket 04)',
  'apps/frontend/src/app/(app)/channel-relay/page.tsx': 'popup relay page copying auth/showorg/impersonate into the popup session (ticket 07)',
  'apps/frontend/src/app/(app)/layout.tsx': 'light theme body classes (ticket 02/06)',
  'apps/frontend/src/app/(app)/sso/layout.tsx': 'light SSO layout (ticket 04/06)',
  'apps/frontend/src/app/(app)/sso/page.tsx': 'colleague-facing SSO landing / code exchange page (ticket 04)',
  'apps/frontend/src/components/agents/agent.chat.tsx':
    'defensive content typing because upstream narrowed it to string while keeping the map() branch (upstream defect at a5affe62, ticket 02)',
  'apps/frontend/src/components/analytics/chart-social.tsx': 'default chart mode light (ticket 02/06)',
  'apps/frontend/src/components/billing/embedded.billing.tsx': 'default light billing surface (ticket 06)',
  'apps/frontend/src/components/billing/faq.component.tsx': 'delete-account FAQ entry removed (ticket 06)',
  'apps/frontend/src/components/launches/add.provider.component.tsx': 'six-entry whitelist and iframe relay via shared modules (ticket 07)',
  'apps/frontend/src/components/launches/allowed.channels.ts': 'single source of the six add-entry identifiers (ticket 07)',
  'apps/frontend/src/components/launches/channel.popup.ts': 'popup relay/session protocol helpers (ticket 07)',
  'apps/frontend/src/components/launches/continue.integration.tsx':
    'two-step selection error stays visible instead of being hidden by the selector (ticket 08)',
  'apps/frontend/src/components/launches/launches.component.tsx': 'default light launches screen and popup update subscription (ticket 02/07)',
  'apps/frontend/src/components/layout/impersonate.tsx': 'permanent switch-user entry not rendered; component and route kept (ticket 06)',
  'apps/frontend/src/components/layout/layout.context.tsx': 'session headers, 402/406 messages and null-safe header writes (ticket 02/05)',
  'apps/frontend/src/components/layout/logout.component.tsx': 'fork logout flow (ticket 05)',
  'apps/frontend/src/components/layout/mode.component.tsx': 'default mode light, dark still selectable (ticket 06)',
  'apps/frontend/src/components/layout/top.menu.tsx': 'Agent and Settings hidden; upstream moves Plugs/Integrations into Settings tabs (ticket 02/06)',
  'apps/frontend/src/components/media/media.component.tsx':
    'Design Media / ThirdPartyMedia / AiImage / AiVideo stay hidden in the upstream responsive toolbar; Editor and upload kept (ticket 02/06/10)',
  'apps/frontend/src/components/new-layout/layout.component.tsx': 'Sentry user context plus null-user redirect to /auth/login (ticket 02/06)',
  'apps/frontend/src/components/new-layout/logo.tsx': 'PNG brand at 32x32 in the upstream centred container (ticket 06)',
  'apps/frontend/src/components/preview/preview.wrapper.tsx': 'anonymous preview: non-2xx tolerated, children always rendered, no login redirect (ticket 11)',
  'apps/frontend/src/components/settings/global.settings.tsx': 'delete-account block not rendered (ticket 06)',
  'apps/frontend/src/components/ui/icons/index.tsx': 'light-mode icon defaults (ticket 02/06)',
  'apps/frontend/src/proxy.ts': 'no cookie page gate; 15-minute host-only showorg cookie (ticket 02/05)',
  'apps/orchestrator/.swcrc':
    'portable workflow bundling: upstream baseUrl pointed at the author machine and broke every other checkout (ticket 14)',
  'apps/orchestrator/src/activities/integrations.activity.ts': 'refreshToken is registered as a Temporal activity via @ActivityMethod() (ticket 16)',
  'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts':
    'a finalize heartbeat timeout with details is treated as unknown instead of being retried (ticket 17)',
  'libraries/helpers/src/utils/custom.fetch.func.ts': 'shared fetch sending the session headers (ticket 05)',
  'libraries/helpers/src/utils/custom.fetch.tsx': 'useFetch wrapper over the session-aware fetch (ticket 04/05)',
  'libraries/helpers/src/utils/public.preview.ts': 'public preview loader with 2xx/JSON/array fallbacks (ticket 11)',
  'libraries/nestjs-libraries/src/database/prisma/autopost/autopost.service.ts': 'data-layer adaptation for the merged schema (ticket 03)',
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts':
    'a revoked channel no longer aborts the whole refresh batch (ticket 09)',
  'libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts':
    'upstream-replaced: the only fork edit was "deletedAt: null as null" (a pre-merge Prisma typing workaround); the filter itself is upstream now (ticket 03)',
  'libraries/nestjs-libraries/src/dtos/auth/sso.create-account.dto.ts': 'SSO account creation DTO (ticket 04)',
  'libraries/nestjs-libraries/src/dtos/auth/sso.login.dto.ts': 'SSO login DTO (ticket 04)',
  'libraries/nestjs-libraries/src/emails/empty.provider.ts': 'no-op mail provider so missing mail config cannot block core flows (fork)',
  'libraries/nestjs-libraries/src/short-linking/providers/empty.ts': 'no-op short-link provider (fork)',
  'libraries/nestjs-libraries/src/temporal/temporal.module.ts': 'registers workflows on explicitly listed compatibility provider queues only (ticket 16)',
  'libraries/nestjs-libraries/src/temporal/worker.queues.ts': 'COMPAT_WORKFLOW_QUEUES parsing, empty by default (ticket 16)',
  'libraries/react-shared-libraries/src/helpers/uppy.upload.ts': 'local upload sends the session headers and reuses the backend record (ticket 10)',
  'libraries/react-shared-libraries/src/helpers/use.is.visible.tsx': '01/02 review fix kept in the merged tree (e331b115)',
  'libraries/react-shared-libraries/src/helpers/use.track.tsx': 'fork tracking guard (ticket 02)',
  'var/docker/ecosystem.config.cjs': 'PM2 definition of the three processes the image runs (ticket 13)',
  'var/docker/entrypoint.sh': 'official prisma db push before the app starts; refuses to start on failure (ticket 03)',
  'var/docker/nginx.conf': 'nginx front door on 5000 with /api proxy, iframe CSP and uploads (ticket 02/13)',
  'doc/Logo.png': 'fork brand asset (ticket 02)',
  'doc/social-platform-comments-api.md': 'fork research document (ticket 02)',
  'doc/sso-test/index.html': 'SSO parent-page test harness (ticket 04)',
  'doc/sso-test/mock-sso-server.js': 'SSO exchange mock used by the parent-page harness (ticket 04)',
  'docker/docker-compose.yaml': 'local Temporal/compose stack for the rehearsals (ticket 02/14)',
  'docker/dynamicconfig/development-sql.yaml': 'Temporal dev dynamic config for the local stack (ticket 02/14)',
  'docs/agents/domain.md': 'fork agent documentation (single-context domain docs)',
  'docs/agents/issue-tracker.md': 'fork agent documentation (issue tracker conventions)',
  'docs/agents/triage-labels.md': 'fork agent documentation (triage labels)',
  'docs/sso-migration-plan.md': 'fork SSO migration notes (ticket 02)',
  'var/social-media-platform-execution-plan.md': 'pre-merge research document (ticket 02)',
  'var/social-media-tools-research.md': 'pre-merge research document (ticket 02)',
  'var/social-media-tools-research.assets/image-20260414143850204.png': 'image referenced by the research document (ticket 02)',
};

const VERIFICATION = {
  'source-backend': 'tickets 04/05/09/12',
  'source-frontend': 'tickets 04/05/06/07/08/10/11',
  'source-orchestrator': 'tickets 14/16/17',
  'source-shared-libraries': 'tickets 04/05/09/10/11/16',
  'regression-tests': 'pnpm run test (ticket 18 final gate)',
  'k8s-generated-apps': 'k8s/prepare-build-context.sh --check + runtime-contract tests (ticket 18)',
  'k8s-generated-libraries': 'k8s/prepare-build-context.sh --check + runtime-contract tests (ticket 18)',
  'k8s-generated-var': 'k8s/prepare-build-context.sh --check (ticket 18)',
  'k8s-contract-tests': 'ticket 18 final gate',
  'k8s-deployment-tree': 'ticket 01/13 + ticket 18 final gate',
  'planning-evidence': 'the referenced ticket Answer',
  'local-var-assets': 'tickets 03/13',
  'local-docker-compose': 'tickets 14/15/16/17',
  documentation: 'n/a (documentation)',
  'root-config-tooling': 'ticket 18 final gate (install, typecheck, lint, test, build)',
};

// ---------------------------------------------------------------- classify
function classify(path, upstream, customization) {
  const identical = customization && identicalTo(CUSTOMIZATION, path);
  if (!upstream && customization)
    return identical ? 'customization (inherited)' : 'customization (re-adapted after merge)';
  if (!upstream && !customization && inCommit(CUSTOMIZATION_1, path)) return 'customization (f042c177 only)';
  if (!upstream) return 'added by the merge work';
  if (identical) return 'customization (kept over upstream)';
  return 'upstream file, merged content';
}

const rows = [
  ['path', 'status_vs_upstream', 'origin', 'group', 'in_upstream', 'in_customization_C', 'identical_to_C', 'added_lines', 'deleted_lines', 'reason', 'verified_by'],
];

for (const [path, st] of [...status.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const upstream = inCommit(UPSTREAM, path);
  const customization = inCommit(CUSTOMIZATION, path);
  const g = group(path);
  let [added, deleted] = numstat.get(path) || ['', ''];
  if (status.get(path) === '?') {
    try {
      added = readFileSync(path, 'utf8').split('\n').length - 1;
      deleted = 0;
    } catch {
      added = statSync(path).size ? 'binary' : '';
      deleted = 0;
    }
  }
  if (path === OUT) added = 'self';
  const reason =
    PATH_REASON[path] ||
    GROUP_REASON[g] ||
    'no per-path note; see the group reason in the report';
  rows.push([
    path,
    st,
    classify(path, upstream, customization),
    g,
    upstream ? 'yes' : 'no',
    customization ? 'yes' : 'no',
    customization && identicalTo(CUSTOMIZATION, path) ? 'yes' : 'no',
    added,
    deleted,
    reason,
    VERIFICATION[g] || 'ticket 18',
  ]);
}

// This file did not exist when `git status` ran, so it is added explicitly:
// the appendix must cover the delivered tree including itself.
if (!status.has(OUT)) {
  rows.push([
    OUT,
    'A',
    'added by the merge work',
    group(OUT),
    'no',
    'no',
    'no',
    'self',
    '0',
    PATH_REASON[OUT] || GROUP_REASON[group(OUT)],
    VERIFICATION[group(OUT)] || 'ticket 18',
  ]);
}

writeFileSync(OUT, rows.map((r) => r.join('\t')).join('\n') + '\n');
console.log(`wrote ${OUT}: ${rows.length - 1} paths`);
const byGroup = {};
const byOrigin = {};
for (const r of rows.slice(1)) {
  byGroup[r[3]] = (byGroup[r[3]] || 0) + 1;
  byOrigin[r[2]] = (byOrigin[r[2]] || 0) + 1;
}
console.log('by group ', byGroup);
console.log('by origin', byOrigin);
