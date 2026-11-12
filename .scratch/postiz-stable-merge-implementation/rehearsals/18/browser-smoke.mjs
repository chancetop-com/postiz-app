#!/usr/bin/env node
// Ticket 18 — real-browser smoke on the final candidate image.
//
// Scope is deliberately narrow and is reported exactly as measured:
//   * the pages that need no external account (login, SSO hand-off, anonymous
//     preview fallback) rendered by a REAL Chromium against the REAL image,
//     real Next server and real proxy;
//   * desktop and mobile viewports;
//   * no real parent application, no real OAuth provider, no Safari.
//
// It does not replace the contract suites for the authenticated flows; it adds
// the one thing they cannot show: a real browser talking to the built product.
//
// Usage: IMAGE=postiz-ticket18:candidate node .../18/browser-smoke.mjs

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, 'evidence', 'browser');
const IMAGE = process.env.IMAGE || 'postiz-ticket18:candidate';
const NET = 't18b-net';
const PG = 't18b-pg';
const REDIS = 't18b-redis';
const APP = 't18b-app';
const VOLUME = 't18b-uploads';
const PG_PORT = process.env.T18B_PG_PORT || '55433';
const TEMPORAL_BIN = process.env.TEMPORAL_BIN || '/tmp/tcli/temporal';
const HOST_PORT = process.env.T18B_HOST_PORT || '5055';
const BASE = `http://localhost:${HOST_PORT}`;
const INTERNAL_BASE = 'http://localhost:5000';

const results = [];
const observations = [];
const observe = (name, value) => observations.push({ name, value });
const record = (ok, name, detail = '') => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const sh = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });

mkdirSync(EVIDENCE, { recursive: true });

function cleanup() {
  for (const c of [APP, REDIS, PG]) {
    try {
      sh(`docker rm -f ${c}`);
    } catch {}
  }
  try {
    sh(`docker network rm ${NET}`);
  } catch {}
  try {
    sh(`docker volume rm ${VOLUME}`);
  } catch {}
}

let temporal;
async function main() {
  cleanup();
  sh(`docker network create ${NET}`);
  sh(
    `docker run -d --name ${PG} --network ${NET} --network-alias db -p 127.0.0.1:${PG_PORT}:5432 ` +
      `-e POSTGRES_USER=postiz -e POSTGRES_PASSWORD=postiz -e POSTGRES_DB=postiz postgres:15`
  );
  sh(`docker run -d --name ${REDIS} --network ${NET} --network-alias redis redis:7-alpine`);
  sh(`docker volume create ${VOLUME}`);
  sh(
    `docker run --rm -v ${VOLUME}:/uploads busybox:latest sh -c ` +
      `'mkdir -p /uploads/2024/05/06 && printf "legacy-media-bytes" > /uploads/2024/05/06/legacy.png'`
  );

  temporal = spawn(
    TEMPORAL_BIN,
    ['server', 'start-dev', '--ip', '0.0.0.0', '--port', '7233', '--headless', '--log-level', 'error', '--db-filename', join(HERE, '.temporal-browser.db')],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  for (let i = 0; i < 60; i++) {
    try {
      sh('nc -z 127.0.0.1 7233');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const env = [
    'DATABASE_URL=postgresql://postiz:postiz@db:5432/postiz',
    'REDIS_URL=redis://redis:6379',
    'JWT_SECRET=synthetic-browser-smoke-secret',
    `MAIN_URL=${BASE}`,
    `FRONTEND_URL=${BASE}`,
    'BACKEND_INTERNAL_URL=http://localhost:3000',
    'STORAGE_PROVIDER=local',
    'UPLOAD_DIRECTORY=/uploads',
    'IS_GENERAL=true',
    'NODE_ENV=production',
    'TEMPORAL_ADDRESS=host.docker.internal:7233',
  ];
  writeFileSync(join(EVIDENCE, 'env.txt'), env.join('\n') + '\n');

  sh(
    `docker run -d --name ${APP} --network ${NET} ${env.map((e) => `-e "${e}"`).join(' ')} ` +
      `--add-host=host.docker.internal:host-gateway -p ${HOST_PORT}:5000 -v ${VOLUME}:/uploads ${IMAGE}`
  );

  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const code = sh(`docker exec ${APP} curl -s -o /dev/null -w '%{http_code}' ${INTERNAL_BASE}/api/`).trim();
      if (code === '200') {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  record(ready, 'the candidate image answers /api/ 200 before the browser run');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome' });

  const scenarios = [
    { name: 'login page', path: '/auth/login', expectUrl: /\/auth\/login/, expectText: null },
    { name: 'root redirects to login without a session', path: '/', expectUrl: /\/auth\/login/ },
    { name: 'SSO hand-off keeps the token in the URL', path: '/auth/sso?token=smoke-token-18', expectUrl: /\/sso\?auth_code=smoke-token-18/ },
    { name: 'anonymous preview of a missing post falls back', path: '/p/smoke-missing', expectUrl: /\/p\/smoke-missing/, expectText: 'Post not found' },
  ];

  for (const viewport of [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    for (const scenario of scenarios) {
      const page = await context.newPage();
      // Console output is recorded, not asserted: an anonymous visit legitimately
      // logs 401s (/user/self, the Copilot runtime) and the bogus SSO code logs a
      // 400. What must never happen is an uncaught exception in the page.
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text().split('\n')[0]);
      });
      page.on('pageerror', (e) => pageErrors.push(e.message));
      let detail = '';
      let ok = false;
      try {
        const response = await page.goto(`${BASE}${scenario.path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);
        const url = page.url();
        const body = await page.locator('body').innerText().catch(() => '');
        const urlOk = scenario.expectUrl.test(url);
        const textOk = scenario.expectText ? body.includes(scenario.expectText) : true;
        ok = urlOk && textOk;
        detail = `status=${response ? response.status() : 'n/a'} url=${url}`;
        if (!textOk) detail += ' missing expected text';
        await page.screenshot({ path: join(EVIDENCE, `${viewport.label}-${scenario.path.replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`), fullPage: true });
      } catch (error) {
        detail = `error: ${error.message}`;
      }
      record(ok, `${viewport.label}: ${scenario.name}`, detail);
      record(
        pageErrors.length === 0,
        `${viewport.label}: ${scenario.name} raises no uncaught page exception`,
        pageErrors.join(' | ')
      );
      observe(`${viewport.label} ${scenario.name}: console errors`, consoleErrors);
      await page.close();
    }
    await context.close();
  }

  await browser.close();
}

try {
  await main();
} catch (error) {
  record(false, 'browser smoke aborted', error.message);
} finally {
  try {
    temporal?.kill('SIGKILL');
  } catch {}
  try {
    sh(`docker logs ${APP}`).length;
  } catch {}
  try {
    writeFileSync(
      join(EVIDENCE, 'app.log'),
      execSync(`docker logs ${APP}`, { encoding: 'utf8', stdio: 'pipe' })
    );
  } catch {}
  cleanup();
  rmSync(join(HERE, '.temporal-browser.db'), { force: true });
  const passed = results.filter((r) => r.ok).length;
  writeFileSync(
    join(EVIDENCE, 'summary.txt'),
    [
      `image: ${IMAGE}`,
      `browser: Google Chrome (playwright channel=chrome), desktop 1440x900 + mobile 390x844`,
      `passed: ${passed}, failed: ${results.length - passed}`,
      '',
      ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
      '',
      'console output (recorded, expected for anonymous visits: 401 /user/self,',
      '401 Copilot runtime, 400 on the deliberately invalid SSO code):',
      ...observations.map((o) => `- ${o.name}: ${JSON.stringify(o.value)}`),
    ].join('\n') + '\n'
  );
  console.log(`\nbrowser-smoke: ${passed} passed, ${results.length - passed} failed`);
  process.exit(passed === results.length ? 0 : 1);
}
