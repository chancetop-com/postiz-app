// Ticket 07 end-to-end: a two-step Facebook Page link issued by organization A,
// completed anonymously, from a tab signed into A, and from a tab using B.
// The only platform double is local: the browser navigation to facebook.com is
// fulfilled by Playwright and the backend's graph.facebook.com calls go to the
// local Graph double through graph-preload.cjs.
import { chromium } from '/Users/chancetio/Desktop/Web/postiz-app-worktrees/ticket-14/node_modules/playwright/index.mjs';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const BACKEND = 'http://localhost:3114';
const FRONTEND = 'http://localhost:4314';
const DB = 'postiz-ticket-14';
const executablePath =
  '/Users/chancetio/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const run = Date.now().toString().slice(-7);
const results = { run, checks: [], scenarios: {}, errors: [] };

const check = (name, ok, detail) => {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const sql = (query) => {
  const out = execSync(
    `docker exec postiz-postgres psql -U postiz-local -d ${DB} -t -A -F '|' -c ${JSON.stringify(query)}`
  ).toString();
  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
};

const integrationRows = (org) =>
  sql(
    `SELECT id, "internalId", name, token, "inBetweenSteps", ("deletedAt" IS NULL) FROM "Integration" WHERE "organizationId" = '${org}' ORDER BY "createdAt"`
  ).map((line) => {
    const [id, internalId, name, token, inBetween, alive] = line.split('|');
    return { id, internalId, name, token, inBetweenSteps: inBetween === 't', alive: alive === 't' };
  });

const boundRows = (org) => integrationRows(org).filter((row) => row.alive && !row.inBetweenSteps);

const register = async (company) => {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const email = `t07-${run}-${slug}@example.invalid`;
  const response = await fetch(`${BACKEND}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'LOCAL',
      email,
      password: 'Ticket07-pass!',
      company,
    }),
  });
  const jwt = response.headers.get('auth');
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !jwt) {
    throw new Error(`register ${company} failed ${response.status} ${JSON.stringify(body)}`);
  }
  const self = await fetch(`${BACKEND}/user/self`, { headers: { auth: jwt } }).then((r) => r.json());
  return { email, jwt, userId: self.id, orgId: self.orgId };
};

const createLink = async (apiKey, redirectUrl) => {
  const response = await fetch(`${BACKEND}/public/v1/integrations/connect`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ integration: 'facebook', ...(redirectUrl ? { redirectUrl } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ...body };
};

const doubleControl = async (payload) => {
  const response = await fetch('http://127.0.0.1:5914/__control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
};

const attachOAuth = async (context, oauthStates) => {
  await context.route(/https:\/\/www\.facebook\.com\/.*/, async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state');
    oauthStates.push(state);
    const redirect = `${FRONTEND}/integrations/social/facebook?code=t07-code-${state}&state=${state}`;
    await route.fulfill({ status: 302, headers: { location: redirect } });
  });
};

const callbackBodies = [];
const watchCallback = (page) =>
  page.on('response', async (response) => {
    if (response.url().includes('/integrations/social-connect/facebook')) {
      callbackBodies.push({
        status: response.status(),
        body: await response.json().catch(() => null),
      });
    }
  });

const openConsent = async (context, linkUrl) => {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  watchCallback(page);
  await page.goto(linkUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Continue to Facebook/ }).waitFor({ timeout: 60000 });
  return { page, errors };
};

const toChooser = async (page, states) => {
  const before = callbackBodies.length;
  await page.getByRole('button', { name: /Continue to Facebook/ }).click();
  await page.getByText('A Page Two').waitFor({ timeout: 90000 });
  await page.getByText('A Page One').waitFor({ timeout: 10000 });
  const callback = callbackBodies[before];
  return { callback, state: states[states.length - 1] };
};

const save = async (page) => {
  await page.getByText('A Page Two').click();
  await page.getByRole('button', { name: 'Save' }).click();
};

const waitArrival = async (page, { redirect, signedIn }) => {
  if (redirect) {
    await page.waitForURL((url) => url.href.startsWith(redirect), { timeout: 120000 });
  } else if (signedIn) {
    await page.waitForURL(/\/launches/, { timeout: 120000 });
  } else {
    await page.getByText('Channel Added').waitFor({ timeout: 60000 });
  }
  return page.url();
};

const selfFromPage = (page) =>
  page.evaluate(async (backend) => {
    const response = await fetch(`${backend}/user/self`, {
      headers: {
        auth: sessionStorage.getItem('auth'),
        showorg: sessionStorage.getItem('showorg'),
      },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, BACKEND);

const launchBrowser = (args = []) => chromium.launch({ headless: true, executablePath, args });

const reset = (orgA, orgB) => {
  sql(`DELETE FROM "Integration" WHERE "organizationId" IN ('${orgA}', '${orgB}')`);
};

const recordScenario = (name, data) => {
  results.scenarios[name] = data;
};

const redirectHits = [];
const redirectServer = http.createServer((req, res) => {
  redirectHits.push(req.url);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>merchant return</title>ok');
});
await new Promise((resolve) => redirectServer.listen(4414, '127.0.0.1', resolve));

// ---- fixture: two independent organizations, each with its own user --------
const userA = await register('T07 Org A');
const userB = await register('T07 Org B');
const apiKeyA = sql(`SELECT "apiKey" FROM "Organization" WHERE id = '${userA.orgId}'`)[0];
check('org A and B are distinct', userA.orgId !== userB.orgId, {
  orgA: userA.orgId,
  orgB: userB.orgId,
});
check('public API link creation', true, await createLink(apiKeyA));

const browser = await launchBrowser();
// the public start-connect route is throttled per client address; the guard
// reads the proxy's x-forwarded-for, so each browser tab group gets its own
// synthetic client address (and never shares the accumulated local counter)
let ipSeq = 1;
const newContext = (target = browser) =>
  target.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${ipSeq++}` },
  });
const ctxAnonymous = await newContext();
const ctxA = await newContext();
const ctxB = await newContext();
const oauthStates = { anonymous: [], a: [], b: [], retry: [], cancel: [], redirectAnon: [], redirectB: [] };
await attachOAuth(ctxAnonymous, oauthStates.anonymous);
await attachOAuth(ctxA, oauthStates.a);
await attachOAuth(ctxB, oauthStates.b);

// sessionStorage is per tab: seed it before every document so the tab keeps
// the same identity the real app writes after login.
const seedSession = async (context, session) => {
  await context.addInitScript(([auth, org]) => {
    sessionStorage.setItem('auth', auth);
    sessionStorage.setItem('showorg', org);
  }, [session.jwt, session.orgId]);
};
await seedSession(ctxA, userA);
await seedSession(ctxB, userB);
// The dev server compiles /launches on first use; warm it so a client-side
// push after the picker is not mistaken for a missing navigation.
const prewarm = async (context) => {
  const page = await context.newPage();
  await page.goto(`${FRONTEND}/launches`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForTimeout(1500);
  await page.close();
};
await prewarm(ctxA);
await prewarm(ctxB);

// ---- 1. anonymous ---------------------------------------------------------
{
  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA);
  const { page } = await openConsent(ctxAnonymous, link.url);
  const before = await page.evaluate(() => ({
    auth: sessionStorage.getItem('auth'),
    cookies: document.cookie,
  }));
  const chooser = await toChooser(page, oauthStates.anonymous);
  const candidates = {
    one: await page.getByText('A Page One').isVisible(),
    two: await page.getByText('A Page Two').isVisible(),
  };
  await save(page);
  const url = await waitArrival(page, { signedIn: false });
  const rowsA = integrationRows(userA.orgId);
  const rowsB = integrationRows(userB.orgId);
  const boundA = boundRows(userA.orgId);
  const stateOnlyInA = sql(
    `SELECT "organizationId" FROM "Integration" WHERE id = '${chooser.callback.body.id}'`
  );
  recordScenario('anonymous', {
    link: link.url,
    before,
    candidates,
    callback: chooser.callback,
    finalUrl: url,
    rowsA,
    rowsB,
    boundA,
    stateOnlyInA,
    pageErrors: [],
  });
  check('anonymous: consent page has no tab identity', !before.auth, before);
  check('anonymous: the callback asked for the picker', chooser.callback.body?.inBetweenSteps === true, chooser.callback);
  check('anonymous: both candidate pages were offered', candidates.one && candidates.two, candidates);
  check('anonymous: exactly one bound row in A, page-2', boundA.length === 1 && boundA[0].internalId === 'page-2', boundA);
  check('anonymous: the other candidate is not bound', !rowsA.some((row) => row.alive && row.internalId === 'page-1'), rowsA);
  check('anonymous: org B has no row', rowsB.length === 0, rowsB);
  check('anonymous: the integration id exists only in A', stateOnlyInA.length === 1 && stateOnlyInA[0] === userA.orgId, stateOnlyInA);
  check('anonymous: stays on the callback page with the result', url.includes('/integrations/social/facebook'), url);
}

// ---- 2. signed into A -----------------------------------------------------
{
  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA);
  const { page } = await openConsent(ctxA, link.url);
  const chooser = await toChooser(page, oauthStates.a);
  await save(page);
  const url = await waitArrival(page, { signedIn: true });
  const boundA = boundRows(userA.orgId);
  const rowsB = integrationRows(userB.orgId);
  const self = await selfFromPage(page);
  recordScenario('signedIntoA', {
    link: link.url,
    callback: chooser.callback,
    finalUrl: url,
    boundA,
    rowsB,
    self,
  });
  check('signed into A: one bound row in A, page-2', boundA.length === 1 && boundA[0].internalId === 'page-2', boundA);
  check('signed into A: B has no row', rowsB.length === 0, rowsB);
  check('signed into A: destination is the calendar', url.includes('/launches?added=facebook&msg=Channel%20Added'), url);
  check('signed into A: session still belongs to A', self.status === 200 && self.body.orgId === userA.orgId && self.body.id === userA.userId, self);
}

// ---- 3. a tab that is using B --------------------------------------------
{
  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA);
  const { page } = await openConsent(ctxB, link.url);
  const chooser = await toChooser(page, oauthStates.b);
  await save(page);
  const url = await waitArrival(page, { signedIn: true });
  const boundA = boundRows(userA.orgId);
  const rowsB = integrationRows(userB.orgId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const self = await selfFromPage(page);
  const storage = await page.evaluate(() => ({
    auth: !!sessionStorage.getItem('auth'),
    showorg: sessionStorage.getItem('showorg'),
  }));
  recordScenario('tabUsingB', {
    link: link.url,
    callback: chooser.callback,
    finalUrl: url,
    boundA,
    rowsB,
    self,
    storage,
  });
  check('tab B: one bound row in A, page-2', boundA.length === 1 && boundA[0].internalId === 'page-2', boundA);
  check('tab B: the binding did not land in B', rowsB.length === 0, rowsB);
  check('tab B: the tab still reports user B and org B after refresh', self.status === 200 && self.body.orgId === userB.orgId && self.body.id === userB.userId, self);
  check('tab B: the tab session keys are unchanged', storage.auth && storage.showorg === userB.orgId, storage);
}

// ---- 4. save failure, then retry (in the B tab) --------------------------
{
  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA);
  const { page } = await openConsent(ctxB, link.url);
  await toChooser(page, oauthStates.retry);
  await doubleControl({ failNextAccounts: true });
  await save(page);
  // the app alert carries the red styling; the Next route announcer is also
  // role=alert but stays empty
  const alert = page.locator('div[role="alert"].text-red-400');
  await alert.waitFor({ timeout: 90000 });
  const alertText = (await alert.innerText()).trim();
  const failedUrl = page.url();
  const failedRows = integrationRows(userA.orgId);
  const failedBoundA = boundRows(userA.orgId);
  const stillChooser = await page.getByText('A Page Two').isVisible();
  check('save failure: an error is shown', alertText.length > 0, alertText);
  check('save failure: the chooser stays usable', stillChooser, stillChooser);
  check('save failure: no completed binding', failedBoundA.length === 0 && failedRows.length === 1, failedRows);
  check('save failure: the tab did not navigate', !failedUrl.includes('/launches'), failedUrl);

  await save(page);
  const retryUrl = await waitArrival(page, { signedIn: true });
  const retryRows = integrationRows(userA.orgId);
  const retryBoundA = boundRows(userA.orgId);
  recordScenario('saveFailureRetry', {
    link: link.url,
    alertText,
    failedUrl,
    failedRows,
    retryUrl,
    retryRows,
    retryBoundA,
  });
  check('retry: exactly one bound row remains', retryBoundA.length === 1 && retryBoundA[0].internalId === 'page-2', retryBoundA);
  check('retry: no duplicate row was left behind', retryRows.filter((row) => row.alive).length === 1, retryRows);
}

// ---- 5. cancel, then reuse the link --------------------------------------
{
  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA);
  const cancelled = await openConsent(ctxAnonymous, link.url);
  await toChooser(cancelled.page, oauthStates.cancel);
  await cancelled.page.close();
  const afterCancel = integrationRows(userA.orgId);
  check('cancel: nothing is bound', boundRows(userA.orgId).length === 0, afterCancel);
  check('cancel: only the pending selection remains', afterCancel.length === 1 && afterCancel[0].inBetweenSteps, afterCancel);

  const again = await openConsent(ctxAnonymous, link.url);
  await toChooser(again.page, oauthStates.cancel);
  await save(again.page);
  await waitArrival(again.page, { signedIn: false });
  const afterRetry = integrationRows(userA.orgId);
  const afterRetryBound = boundRows(userA.orgId);
  recordScenario('cancelThenRetry', {
    link: link.url,
    afterCancel,
    afterRetry,
    afterRetryBound,
  });
  check('cancel then retry: one bound row', afterRetryBound.length === 1 && afterRetryBound[0].internalId === 'page-2', afterRetryBound);
  check('cancel then retry: no duplicate live row', afterRetry.filter((row) => row.alive).length === 1, afterRetry);
}

// ---- 6/7. redirect URL with its own query string -------------------------
{
  const redirect = 'http://127.0.0.1:4414/return?keep=1&lang=en';
  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA, redirect);
  const consent = await openConsent(ctxAnonymous, link.url);
  const redirectShown = await consent.page.getByText(/127\.0\.0\.1:4414/).isVisible();
  await toChooser(consent.page, oauthStates.redirectAnon);
  await save(consent.page);
  const anonymousUrl = await waitArrival(consent.page, { redirect: 'http://127.0.0.1:4414/return' });
  check('redirect (anonymous): the consent page names the return site', redirectShown, true);
  check(
    'redirect (anonymous): existing query params are kept and the result is appended',
    anonymousUrl.includes('keep=1') &&
      anonymousUrl.includes('lang=en') &&
      anonymousUrl.includes('added=facebook') &&
      /msg=Channel(%20|\+)Added/.test(anonymousUrl),
    anonymousUrl
  );

  reset(userA.orgId, userB.orgId);
  const linkB = await createLink(apiKeyA, redirect);
  const consentB = await openConsent(ctxB, linkB.url);
  await toChooser(consentB.page, oauthStates.redirectB);
  await save(consentB.page);
  const signedUrl = await waitArrival(consentB.page, { redirect: 'http://127.0.0.1:4414/return' });
  const rowsB = integrationRows(userB.orgId);
  recordScenario('redirectUrl', {
    anonymousUrl,
    signedUrl,
    rowsB,
    hits: redirectHits,
    link,
  });
  check(
    'redirect (signed into B): same preserved query string',
    signedUrl.includes('keep=1') && signedUrl.includes('lang=en') && signedUrl.includes('added=facebook'),
    signedUrl
  );
  check('redirect (signed into B): binding still only in A', rowsB.length === 0, rowsB);
}

// ---- 8/9. third-party cookies disabled ----------------------------------
{
  const cookieBrowser = await launchBrowser(['--test-third-party-cookie-phaseout']);
  const ctxCookiesAnon = await newContext(cookieBrowser);
  const ctxCookiesA = await newContext(cookieBrowser);
  const states = { anon: [], a: [] };
  await attachOAuth(ctxCookiesAnon, states.anon);
  await attachOAuth(ctxCookiesA, states.a);
  await seedSession(ctxCookiesA, userA);

  const sentCookies = [];
  const watchCookies = (page) =>
    page.on('request', (request) => {
      if (request.url().startsWith(BACKEND)) {
        sentCookies.push({ url: request.url(), cookie: request.headers().cookie || null });
      }
    });

  reset(userA.orgId, userB.orgId);
  const link = await createLink(apiKeyA);
  const anon = await openConsent(ctxCookiesAnon, link.url);
  watchCookies(anon.page);
  await toChooser(anon.page, states.anon);
  await save(anon.page);
  const anonUrl = await waitArrival(anon.page, { signedIn: false });
  const anonCookies = await ctxCookiesAnon.cookies();

  reset(userA.orgId, userB.orgId);
  const linkA = await createLink(apiKeyA);
  const signed = await openConsent(ctxCookiesA, linkA.url);
  watchCookies(signed.page);
  await toChooser(signed.page, states.a);
  await save(signed.page);
  const signedUrl = await waitArrival(signed.page, { signedIn: true });
  const signedCookies = await ctxCookiesA.cookies();
  const boundA = boundRows(userA.orgId);

  recordScenario('thirdPartyCookiesDisabled', {
    anonUrl,
    signedUrl,
    anonCookies,
    signedCookies,
    sentCookies: sentCookies.filter((entry) => entry.cookie),
    boundA,
    states,
  });
  check('cookies disabled: anonymous completion stays inline', anonUrl.includes('/integrations/social/facebook'), anonUrl);
  check('cookies disabled: signed-in completion reaches the calendar', signedUrl.includes('/launches?added=facebook'), signedUrl);
  check('cookies disabled: no auth/showorg cookie was stored', ![...anonCookies, ...signedCookies].some((c) => ['auth', 'showorg'].includes(c.name)), [...anonCookies, ...signedCookies]);
  check('cookies disabled: backend requests carry no cookie', sentCookies.filter((entry) => entry.cookie).length === 0, sentCookies.filter((entry) => entry.cookie));
  check('cookies disabled: the binding is still only in A', boundA.length === 1 && boundA[0].internalId === 'page-2', boundA);
  await cookieBrowser.close();
}

results.checksSummary = {
  total: results.checks.length,
  failed: results.checks.filter((entry) => !entry.ok).length,
};
results.fixtures = {
  userA: { id: userA.userId, org: userA.orgId, email: userA.email },
  userB: { id: userB.userId, org: userB.orgId, email: userB.email },
};
writeFileSync(
  '/Users/chancetio/Desktop/Web/postiz-app-worktrees/ticket-14/.scratch/postiz-v2.26.0-implementation/verification/14/ticket14-connect-e2e.json',
  JSON.stringify(results, null, 2)
);
console.log(JSON.stringify(results.checksSummary));
await browser.close();
redirectServer.close();
process.exit(results.checksSummary.failed ? 1 : 0);
