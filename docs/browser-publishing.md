# Scheduled browser publishing

Postiz creates one Temporal workflow per scheduled occurrence. The normal worker on the `main` queue runs `browserPostWorkflow`. The Gateway stores the claim and CLI receipt under that workflow ID. Repeating posts keep their Postiz ID. Each repeat has a new workflow ID and its own due time.

Set `SAU_GATEWAY_URL` on the orchestrator and backend to the internal Gateway base URL. Set `GATEWAY_INTERNAL_TOKEN` on the orchestrator and backend to match the Gateway's internal service token. The Gateway calls the backend at `POST /internal/browser-publishing/authorize-start` immediately before desktop upload. Its `POSTIZ_INTERNAL_URL` must reach the backend directly or use the appropriate reverse-proxy prefix. Apply the Postiz Prisma schema using the existing deployment procedure. Version 1 uses the paired desktop release `0.1.0` by default; `SAU_REQUIRED_RELEASE` selects the required version for new handoffs.

For a field test, enable `BROWSER_PUBLISHING_DEV_TEST_TARGETS=true` on the backend and orchestrator. An operator can assign a `local-chrome` binding with the exact test account alias as `profileId`. The desktop must explicitly advertise that alias in `SAU_DEV_CHROME_ALIASES`. In the composer, select the test channel and choose **Prepare in Chrome and stop before publishing** for a preparation-only occurrence. The equivalent per-channel API setting is `noPublish: true`. A completed preparation appears as **Prepared without publishing** on the original calendar card. A formal test publication requires its own occurrence.

Enable `RUN_CRON=true` on the Postiz service that registers the missing-post workflow. Its startup scan and hourly follow-ups recover eligible due root posts within the existing two-day lookback. The backend saves a pickup deadline with the original occurrence. Set `BROWSER_CLAIM_TIMEOUT_SECONDS` on the backend and orchestrator to configure the window for new schedules (default 1800). A missed workflow start, a handoff retry, or a later configuration change preserves the saved deadline. An unclaimed occurrence expires with **Timed out waiting for an execution node**. An accepted occurrence stays under its original Gateway workflow ID for reconciliation.

## Review an occurrence

When the desktop reports a possible submission or its committed result deadline expires, the calendar shows **Needs review** and the organization receives a notification. Members who enable failure email also receive that notification by email. The reviewer opens the card to check for a late definitive receipt. If the Gateway still has no definitive result, the reviewer checks the account and records the outcome on the same card.

Organization members with posting permission can open `GET /browser-publishing/review/{workflowId}` and submit `PUT` at the same path with `outcome` set to `published` or `failed`. The decision accepts an optional `releaseId`, HTTP(S) `url` and `note`. Postiz records the authenticated user and time. A later receipt remains available to operations while the manual outcome stays on the calendar.

Platform operators can use the same GET and PUT under `/admin/browser-publishing/{organizationId}/occurrences/{workflowId}/review`. GET on the parent occurrence path shows the Postiz decision and Gateway claim and receipt history. GET on the organization's `occurrences` collection lists pickup timeouts and review incidents in pages of up to 100, using the last workflow ID as `cursor`.

## Local tracer

The HTTP suite uses the actual posting and calendar controllers, PostgreSQL, Temporal, the Gateway and the desktop worker. The subprocess fixture supplies controlled paired CLI output and a local provider inventory. It needs a local Temporal test server with namespace registration and search-attribute permissions, two isolated PostgreSQL databases, and Python with the Gateway/desktop runtime dependencies installed. Define the following environment variables for the test process.

| Variable | Fixture value |
| --- | --- |
| `DATABASE_URL` and `BROWSER_CHANNEL_TEST_DATABASE_URL` | Postiz fixture database with this checkout's Prisma schema applied |
| `BROWSER_TRACER_TEMPORAL` | Loopback Temporal address, including port |
| `BROWSER_TRACER_SAU` | Absolute path to the matching social-auto-upload checkout |
| `BROWSER_TRACER_PYTHON` | Absolute Python interpreter with the Gateway and desktop dependencies |
| `BROWSER_TRACER_GATEWAY_DB` | Separate Gateway fixture database |
| `BROWSER_TRACER_GATEWAY_PORT` | Available loopback TCP port for Uvicorn |
| `BROWSER_TRACER_REDIS_URL` | Redis fixture URL when enabled in the Gateway release |

Run `pnpm exec vitest run --maxWorkers=1 tests/browser-publishing-http.test.ts tests/browser-publishing-editor.test.tsx`. The suite registers a separate Temporal namespace by default. To reuse a preconfigured fixture namespace, set `BROWSER_TRACER_NAMESPACE` to its name. It needs text search attributes named `postId` and `organizationId`. The Gateway migrates its own fixture database at startup. Each run uses fresh organization, session, profile and workflow IDs.

## Scheduled media

Postiz snapshots the timing settings when it schedules the browser occurrence. Both the orchestrator and backend use the stored upload instant when deciding whether the desktop can start. A content edit is read again under the upload lock. A rescheduled or cancelled occurrence loses authorization.

| Environment setting | Default | Purpose |
| --- | ---: | --- |
| `BROWSER_PREDOWNLOAD_LEAD_SECONDS` | 0 | Offer the current media for desktop pre-download this far before the due instant. A separate download is useful when this lead exceeds the upload lead. |
| `BROWSER_UPLOAD_LEAD_SECONDS` | 0 | Earliest platform upload relative to the due instant. The first permitted publish click remains at the scheduled UTC second, rounded up. |
| `BROWSER_PUBLISH_ACTIVITY_SECONDS` | 1800 | Temporal publish handoff activity timeout |
| `BROWSER_PUBLISH_HEARTBEAT_SECONDS` | 180 | Publish handoff heartbeat timeout |
| `BROWSER_RESULT_QUERY_SECONDS` | 120 | Timeout for one result-query activity |
| `BROWSER_RESULT_QUERY_ROUNDS` | 90 | Maximum ordinary polls in one workflow run. At the bound, wait for the applicable Gateway deadline and resume querying the stored occurrence. |
| `BROWSER_RESULT_QUERY_WAIT_SECONDS` | 20 | Interval between result queries |

For a 10:00 post, leads of 1800 and 600 make preparation available at 09:30 and upload at 09:50. An offline desktop can miss preparation. At pickup the executing desktop waits for all selected media to be available in its cache. Edits or unbinding during transfer still apply. Postiz compares the prepared manifest inside the transaction that starts the upload. A changed manifest goes back to the same desktop for preparation. The single authorized publish command uses the cached files. Immediate posts start media acquisition at pickup and skip the scheduled click wait.
