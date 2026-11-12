# Ticket 18 / review fix — iframe and popup hand-off in a real browser

This rehearsal closes the one local gap in verification-matrix row 5: the
parent → iframe → SSO hand-off and the popup → `/channel-relay` → opener flow
had only been covered at component/proxy level and by an anonymous-surface
Chrome smoke. Both are local scenarios; neither needs a real merchant account.

## What runs

| piece | what it is |
| --- | --- |
| image | `postiz-ticket18:candidate` (the report's final candidate: nginx + PM2 + Next + Nest), unmodified |
| database | throwaway `postgres:15`; the image's own entrypoint runs the official `prisma db push` |
| cache | throwaway `redis:7-alpine` |
| Temporal | the local dev server binary, so the backend boots and the orchestrator can poll |
| SSO provider | a local `node:http` stub at `host.docker.internal:5098/exchange`; it returns a synthetic `merchant_id`/`merchant_name` |
| parent page | a local `node:http` page on `http://127.0.0.1:5099` — a **different origin** from the app |
| browser | Google Chrome via Playwright (`channel: 'chrome'`), desktop 1440×900 and mobile 390×844 |

The parent page embeds `${APP}/auth/sso?token=…` in a cross-origin `<iframe>`
and opens `${APP}/channel-relay?redirect=…#auth&showorg&impersonate` as a real
popup on a trusted click.

## Assertions

1. the app runs inside a cross-origin iframe (`window.self !== window.top`);
2. `/auth/sso?token=` reaches `/sso?auth_code=` inside the iframe (the Next 16
   `searchParams` hand-off in a real browser);
3. the iframe is **never** sent to `/auth/login` — no cookie page gate;
4. with the stub exchange, the iframe lands on `/launches` (the authenticated
   shell), rendering content and no login form;
5. the popup follows the relay redirect and its **own** `sessionStorage` carries
   `auth`, `showorg`, `impersonate` and the `channel_popup_mode` marker;
6. the popup is never sent to `/auth/login` either.

Before the browser phase the runner warms `/api/auth/sso` + `/api/user/self`
over real HTTP and records every attempt: a cold stack answered the first pair
with 400/401 while the entrypoint was still settling, and that transient would
otherwise land the first browser run on `/auth/login` through the documented
“non-2xx → null → login” layout contract. Warming is recorded, not hidden.

The runner then waits 12 s before the browser assertions. While the backend was
booting, nginx's implicit `localhost:3000` upstream received connection
refusals and keeps that server in the `down` state for its passive
`fail_timeout` (10 s, default); a request that lands on such a worker during
that window gets `no live upstreams` → **502**. The wait is recorded in
`evidence/summary.txt`; it measures the product rather than the cold start.
This packaging transient is also listed as a residual risk in the report.

## Run it

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"
node .scratch/postiz-stable-merge-implementation/rehearsals/19/run.mjs
# KEEP=1 leaves the containers for inspection
```

It writes `evidence/summary.txt`, screenshots, the parent-page HTML, the SSO
stub call log, the app log and a copy of this runner, then removes every
container, network and volume. It exits non-zero on the first failed assertion.

## Not covered here

The deployed merchant parent application (`https://merchant.connexup-dev.net`),
the real six-provider OAuth consent screens, Safari and third-party-cookie
restricted browsers. Those stay in report §6.5 as external conditions.
