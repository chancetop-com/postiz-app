#!/usr/bin/env node
// Ticket 18 / review fix — real-browser proof of the iframe and popup
// hand-off (verification-matrix row 5, the local half).
//
// What this exercises, end to end, in real Chrome against the real candidate
// image (`postiz-ticket18:candidate`, nginx + Next + Nest + PM2):
//
//   * an already-built frontend is opened inside a CROSS-ORIGIN <iframe> on a
//     parent page that this script serves itself;
//   * the iframe enters through the parent hand-off `/auth/sso?token=...`,
//     which must reach `/sso?auth_code=...` and the authenticated shell without
//     EVER being redirected to `/auth/login` by a cookie page gate;
//   * `/channel-relay?redirect=...#auth&showorg&impersonate` is opened as a
//     real popup from that parent page, and the three session keys plus the
//     popup marker must land in the POPUP's sessionStorage (not the parent's).
//
// The SSO provider is a local stub (the only external boundary replaced); the
// database is the container's own PostgreSQL. No real account, no real OAuth,
// no deployed parent application, no Safari.
//
// Usage: node .../19/run.mjs        (keeps nothing unless EVIDENCE is set)
//        KEEP=1 node .../19/run.mjs (leave the containers for inspection)

import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, 'evidence');
const IMAGE = process.env.IMAGE || 'postiz-ticket18:candidate';
const NET = 't19-net';
const PG = 't19-pg';
const REDIS = 't19-redis';
const APP = 't19-app';
const VOLUME = 't19-uploads';
const PG_PORT = process.env.T19_PG_PORT || '55435';
const APP_PORT = process.env.T19_APP_PORT || '5066';
const PARENT_PORT = process.env.T19_PARENT_PORT || '5099';
const SSO_PORT = process.env.T19_SSO_PORT || '5098';
const TEMPORAL_BIN = process.env.TEMPORAL_BIN || '/tmp/tcli/temporal';
const BASE = `http://localhost:${APP_PORT}`;
const PARENT = `http://127.0.0.1:${PARENT_PORT}`;
const IFRAME_TOKEN = 'iframe-sso-token-19';
const RELAY_TARGET = `${BASE}/p/relay-landed-19`;
const SESSION = { auth: 'auth-from-parent', showorg: 'org-from-parent', impersonate: 'imp-from-parent' };

const results = [];
const observations = [];
const observe = (name, value) => observations.push({ name, value });
const record = (ok, name, detail = '') => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const sh = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });

// Non-blocking variant: the SSO stub runs in THIS process, so an HTTP call that
// the app makes back to the stub must not block the event loop the way
// execSync does. Anything that talks to the running app uses this.
const ash = (cmd) =>
  new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', () => resolve({ code: 1, out }));
  });

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

// ------------------------------------------------------------
// Parent page + SSO provider stub (the only external boundary).
// ------------------------------------------------------------
function parentPage() {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>merchant parent</title></head>
  <body style="font-family: system-ui; margin: 16px">
    <h1 id="parent-title">Merchant parent (${PARENT})</h1>
    <p id="parent-origin"></p>
    <button id="open-popup" style="padding: 8px 16px">Connect a channel</button>
    <div style="margin-top: 12px">
      <iframe id="app-frame" src="${BASE}/auth/sso?token=${IFRAME_TOKEN}"
              width="900" height="700" style="border: 1px solid #ccc"></iframe>
    </div>
    <script>
      document.getElementById('parent-origin').textContent = 'origin=' + window.location.origin;
      const target = ${JSON.stringify(RELAY_TARGET)};
      const relay = ${JSON.stringify(BASE)} + '/channel-relay?redirect=' + encodeURIComponent(target)
        + '#auth=' + encodeURIComponent(${JSON.stringify(SESSION.auth)})
        + '&showorg=' + encodeURIComponent(${JSON.stringify(SESSION.showorg)})
        + '&impersonate=' + encodeURIComponent(${JSON.stringify(SESSION.impersonate)});
      window.__relayUrl = relay;
      document.getElementById('open-popup').addEventListener('click', () => {
        window.open(relay, 'channel-relay', 'width=560,height=760');
      });
    </script>
  </body>
</html>
`;
}

function startStub() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      writeFileSync(join(EVIDENCE, 'sso-stub-calls.log'), `${req.url} ${body}\n`, { flag: 'a' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ merchant_id: 'merchant-rehearsal-19', merchant_name: 'Rehearsal Merchant 19' }));
    });
  });
  return new Promise((resolve) => server.listen(SSO_PORT, '0.0.0.0', () => resolve(server)));
}

function startParent() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(parentPage());
  });
  return new Promise((resolve) => server.listen(PARENT_PORT, '127.0.0.1', () => resolve(server)));
}

let temporal;
let stub;
let parent;
let browser;

async function main() {
  cleanup();
  rmSync(join(EVIDENCE, 'sso-stub-calls.log'), { force: true });
  sh(`docker network create ${NET}`);
  sh(
    `docker run -d --name ${PG} --network ${NET} --network-alias db -p 127.0.0.1:${PG_PORT}:5432 ` +
      `-e POSTGRES_USER=postiz -e POSTGRES_PASSWORD=postiz -e POSTGRES_DB=postiz postgres:15`
  );
  sh(`docker run -d --name ${REDIS} --network ${NET} --network-alias redis redis:7-alpine`);
  sh(`docker volume create ${VOLUME}`);

  temporal = spawn(
    TEMPORAL_BIN,
    ['server', 'start-dev', '--ip', '0.0.0.0', '--port', '7233', '--headless', '--log-level', 'error', '--db-filename', join(HERE, '.temporal.db')],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  let temporalReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      sh('nc -z 127.0.0.1 7233');
      temporalReady = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  record(temporalReady, 'the local Temporal server answers on 7233');
  if (!temporalReady) throw new Error('temporal server did not start; refusing to boot the app without it');

  stub = await startStub();
  parent = await startParent();

  const env = [
    'DATABASE_URL=postgresql://postiz:postiz@db:5432/postiz',
    'REDIS_URL=redis://redis:6379',
    'JWT_SECRET=synthetic-rehearsal-19-secret',
    `MAIN_URL=${BASE}`,
    `FRONTEND_URL=${BASE}`,
    'BACKEND_INTERNAL_URL=http://localhost:3000',
    'STORAGE_PROVIDER=local',
    'UPLOAD_DIRECTORY=/uploads',
    'IS_GENERAL=true',
    'NODE_ENV=production',
    `SSO_SERVER_URL=http://host.docker.internal:${SSO_PORT}/exchange`,
    'TEMPORAL_ADDRESS=host.docker.internal:7233',
  ];
  writeFileSync(join(EVIDENCE, 'env.txt'), env.join('\n') + '\n');
  writeFileSync(join(EVIDENCE, 'parent-page.html'), parentPage());

  sh(
    `docker run -d --name ${APP} --network ${NET} ${env.map((e) => `-e "${e}"`).join(' ')} ` +
      `--add-host=host.docker.internal:host-gateway -p ${APP_PORT}:5000 -v ${VOLUME}:/uploads ${IMAGE}`
  );

  let ready = false;
  for (let i = 0; i < 120; i++) {
    const { out } = await ash(
      `docker exec ${APP} curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/`
    );
    if (out.trim() === '200') {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  record(ready, 'the candidate image answers /api/ 200 before the browser run');

  // nginx keeps the implicit upstream `localhost:3000` in the "down" state for
  // `fail_timeout` (10s, default) after the connection refusals it saw while
  // the backend was still booting; a request that lands on such a worker during
  // that window gets "no live upstreams" 502. Wait the window out before any
  // assertion so the rehearsal measures the product, not the cold-start state.
  await new Promise((r) => setTimeout(r, 12000));
  observe('cold-start wait before browser phase', '12s (nginx passive fail_timeout is 10s)');

  // Warm the authenticated path over real HTTP. A cold stack answered the very
  // first exchange/self pair with 400/401 (the backend had just finished its
  // entrypoint db push), which would otherwise land the first browser run on
  // /auth/login through the documented "non-2xx → null → login" layout
  // contract. Every attempt is recorded; the rehearsal only continues once the
  // path answers 200, and the attempts are reported as such.
  const warmAttempts = [];
  let warmOk = false;
  for (let attempt = 1; attempt <= 5 && !warmOk; attempt++) {
    let auth = '';
    const exchange = await ash(
      `docker exec ${APP} curl -s -D - -o /dev/null -X POST http://localhost:5000/api/auth/sso ` +
        `-H 'content-type: application/json' --data '{"auth_code":"warmup-19-${attempt}"}'`
    );
    auth = (exchange.out.match(/^auth:\s*(.+)$/im) || [])[1]?.trim() || '';
    let selfCode = 'no-auth';
    if (auth) {
      const self = await ash(
        `docker exec ${APP} curl -s -o /dev/null -w '%{http_code}' -H "auth: ${auth}" ` +
          `http://localhost:5000/api/user/self`
      );
      selfCode = self.out.trim() || 'empty';
    }
    warmAttempts.push(`exchange=${auth ? 'auth-header' : 'none'} self=${selfCode}`);
    warmOk = selfCode === '200';
    if (!warmOk) await new Promise((r) => setTimeout(r, 2000));
  }
  observe('warm-up attempts', warmAttempts);
  record(warmOk, 'the authenticated /api/user/self path answers 200 over real HTTP', warmAttempts.join(' ; '));

  const { chromium } = await import('playwright');
  browser = await chromium.launch({ channel: 'chrome' });

  for (const viewport of [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const navigation = [];
    page.on('framenavigated', (frame) => navigation.push({ url: frame.url(), main: frame === page.mainFrame() }));

    await page.goto(PARENT, { waitUntil: 'domcontentloaded', timeout: 60000 });
    record(page.url().startsWith(PARENT), `${viewport.label}: parent page is a different origin from the app`, page.url());

    const frameHandle = page.locator('#app-frame');
    await frameHandle.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
    // `locator.contentFrame()` returns a FrameLocator in this Playwright
    // version; the frame itself is resolved from the page's frame list.
    let frame = null;
    for (let i = 0; i < 40; i++) {
      frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(BASE));
      if (frame) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!frame) {
      record(false, `${viewport.label}: the iframe is attached`);
      await context.close();
      continue;
    }

    // Give the SSO hand-off time to redirect and the exchange to finish.
    let settled = false;
    for (let i = 0; i < 60; i++) {
      const url = frame.url();
      if (/\/launches|\/analytics|\/sso\?auth_code=/.test(url)) {
        if (/\/launches|\/analytics/.test(url)) {
          settled = true;
          break;
        }
        // It reached /sso; wait a little longer for the exchange+redirect.
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await page.waitForTimeout(2000);

    const frameUrl = frame.url();
    const body = await frame.locator('body').innerText().catch(() => '');
    const hasPassword = await frame.locator('input[type="password"]').count().catch(() => 0);
    const embedded = await frame.evaluate(() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    });

    const frameNavs = navigation.filter((n) => !n.main).map((n) => n.url);
    const loginHits = navigation.filter((n) => /\/auth\/login/.test(n.url)).map((n) => n.url);
    observe(`${viewport.label} iframe navigations`, frameNavs);
    observe(`${viewport.label} /auth/login navigations`, loginHits);

    record(embedded, `${viewport.label}: the app really runs inside a cross-origin iframe`);
    record(
      frameNavs.some((u) => u.includes(`/sso?auth_code=${IFRAME_TOKEN}`)),
      `${viewport.label}: /auth/sso?token reaches /sso?auth_code in the iframe`,
      frameUrl
    );
    record(loginHits.length === 0, `${viewport.label}: the iframe is never sent to /auth/login`, loginHits.join(' | ') || 'none');
    record(
      /\/launches|\/analytics/.test(frameUrl) || /\/sso\?auth_code=/.test(frameUrl),
      `${viewport.label}: the iframe stays in the app instead of the login screen`,
      frameUrl
    );
    record(hasPassword === 0, `${viewport.label}: no login form is rendered in the iframe`);
    record(
      /\/launches|\/analytics/.test(frameUrl),
      `${viewport.label}: the stubbed exchange lands on the authenticated shell`,
      frameUrl
    );
    record(body.trim().length > 0, `${viewport.label}: the iframe renders content`, `${body.trim().length} chars`);
    if (!/\/launches|\/analytics/.test(frameUrl)) {
      // Keep the exact body of whatever the exchange rendered; a non-shell page
      // here is evidence, not something to hide.
      const html = await frame.content().catch(() => '');
      writeFileSync(join(EVIDENCE, `${viewport.label}-iframe-not-authenticated.html`), html);
    }
    await page.screenshot({ path: join(EVIDENCE, `${viewport.label}-parent-iframe.png`), fullPage: true });

    // ------------------------------------------------------------
    // Popup: parent opens /channel-relay, the relay writes the popup's
    // own sessionStorage and continues to the redirect target.
    // ------------------------------------------------------------
    const popupNavigation = [];
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 30000 }).catch(() => null),
      page.click('#open-popup'),
    ]);
    if (popup) {
      popup.on('framenavigated', (frame) => popupNavigation.push(frame.url()));
      for (let i = 0; i < 40; i++) {
        if (popup.url().startsWith(RELAY_TARGET)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await popup.waitForTimeout(1500);
      const popupUrl = popup.url();
      const session = await popup
        .evaluate(() => ({
          auth: window.sessionStorage.getItem('auth'),
          showorg: window.sessionStorage.getItem('showorg'),
          impersonate: window.sessionStorage.getItem('impersonate'),
          channelPopupMode: window.sessionStorage.getItem('channel_popup_mode'),
        }))
        .catch((error) => ({ error: error.message }));
      observe(`${viewport.label} popup navigations`, popupNavigation);
      record(popupUrl.startsWith(RELAY_TARGET), `${viewport.label}: the popup follows the relay redirect`, popupUrl);
      record(session.auth === SESSION.auth, `${viewport.label}: the popup sessionStorage carries auth`, String(session.auth));
      record(session.showorg === SESSION.showorg, `${viewport.label}: the popup sessionStorage carries showorg`, String(session.showorg));
      record(session.impersonate === SESSION.impersonate, `${viewport.label}: the popup sessionStorage carries impersonate`, String(session.impersonate));
      record(session.channelPopupMode === 'true', `${viewport.label}: the popup is marked as a channel popup`, String(session.channelPopupMode));
      record(
        !popupNavigation.some((u) => /\/auth\/login/.test(u)),
        `${viewport.label}: the popup is never sent to /auth/login`,
        popupNavigation.join(' | ') || 'none'
      );
      await popup.screenshot({ path: join(EVIDENCE, `${viewport.label}-popup-relay.png`), fullPage: true });
      await popup.close();
    } else {
      record(false, `${viewport.label}: the parent can open the relay popup`);
    }

    await context.close();
  }

  await browser.close();
}

try {
  await main();
} catch (error) {
  record(false, 'rehearsal aborted', error.message);
} finally {
  try {
    browser?.close();
  } catch {}
  try {
    temporal?.kill('SIGKILL');
  } catch {}
  try {
    stub?.close();
    parent?.close();
  } catch {}
  try {
    writeFileSync(join(EVIDENCE, 'app.log'), execSync(`docker logs ${APP}`, { encoding: 'utf8', stdio: 'pipe' }));
  } catch {}
  try {
    cpSync(join(HERE, 'run.mjs'), join(EVIDENCE, 'run.mjs'));
  } catch {}
  if (process.env.KEEP !== '1') cleanup();
  rmSync(join(HERE, '.temporal.db'), { force: true });

  const passed = results.filter((r) => r.ok).length;
  writeFileSync(
    join(EVIDENCE, 'summary.txt'),
    [
      `image: ${IMAGE}`,
      `image id: ${(() => { try { return sh(`docker image inspect --format '{{.Id}}' ${IMAGE}`).trim(); } catch { return 'n/a'; } })()}`,
      `browser: Google Chrome (playwright channel=chrome), desktop 1440x900 + mobile 390x844`,
      `parent origin: ${PARENT}; app origin: ${BASE}`,
      `sso provider: local stub at http://host.docker.internal:${SSO_PORT}/exchange`,
      `passed: ${passed}, failed: ${results.length - passed}`,
      '',
      ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
      '',
      'observed navigations:',
      ...observations.map((o) => `- ${o.name}: ${JSON.stringify(o.value)}`),
      '',
      'not covered here (still external / not local): the deployed merchant parent page,',
      'the real six-provider OAuth consent screens, Safari and third-party-cookie-restricted browsers.',
    ].join('\n') + '\n'
  );
  console.log(`\nrehearsal 19: ${passed} passed, ${results.length - passed} failed`);
  process.exit(passed === results.length ? 0 : 1);
}
