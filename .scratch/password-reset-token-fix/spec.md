# Password reset token authentication fix

Status: verified and independently reviewed

## Request and compatibility baseline

User request (2026-11-13): reference upstream PR #2382 to fix expired password-reset tokens being accepted as login credentials; preserve the behavior of f042c177, 6fdf7cb5 and `/Users/chancetio/Desktop/Postiz 项目改造交接文档.md`; run code review afterward. User explicitly reiterated sessionStorage must remain.

Baseline: branch `postiz-stable-merge`, HEAD `8055cc2ce7232d2e6ab2c266c8edb5a132f24352`, plus the sessionStorage/OAuth work already present. That pre-existing work was captured in `/private/tmp/postiz-before-reset-fix.patch`.

## Requirements

1. Newly issued and historical password-reset tokens must not authenticate protected API requests, either through `auth` headers or the legacy cookie fallback, regardless of expiry.
2. New reset links expire after 20 minutes using standard JWT `exp`, with purpose, audience, issuer and signing-key separation. Invalid/expired/wrong-purpose reset submissions return `reset: false` without updating a password.
3. Unexpired historical reset links keep working until their original expiry. Reject malformed or non-reset legacy JWTs at the reset endpoint.
4. Preserve the historical full-User login JWT format and existing sessions. Resolve activation, administrator privileges and organization membership from the database. Preserve first usable organization selection, explicit `showorg`, and administrator impersonation.
5. Preserve merchant SSO exchange, parent-app contract, iframe/postMessage/channel relay, normal OAuth login, sessionStorage + auth/showorg/impersonate/logout headers, existing logout behavior, and the completed OAuth state-proof adaptation. No additional authentication cookies or parent-app changes.
6. Keep unrelated product/UI, channel credentials and integration tokens unchanged. Synchronize the generated k8s build context.

## Approach and upstream reference

Reference: https://github.com/gitroomhq/postiz-app/pull/2382, patch commit `37a4c129012d2baa62dd74d0ff55462d67508d40`.

Adopt the PR's HMAC-derived password-reset key, pinned HS256, issuer/audience/purpose and standard expiry checks. Keep login issuance unchanged; accept only the historical User payload shape at session verification, rejecting reset/invitation/other-purpose claims. The super-admin original-user lookup uses the same session verifier.

The PR also adds a database grant table, one-use reset/activation grants, session revocation and forced invalidation of old logins. Those independent changes are outside this focused fix and would alter the existing session contract. No database migration, new session expiry or forced logout is introduced here. Reset-link reuse within its original lifetime remains the existing behavior; this change does not claim to add one-use reset tokens or session revocation.

## Verification

- Regression test before the fix: `tests/password-reset-token.test.ts` had 20 failures / 14 passes, including the reported reset-token authentication bypass.
- New regression coverage: issued/expired/historical reset tokens via headers and cookies; strict reset-purpose and expiry boundaries; legacy valid link compatibility; historic login provider formats; DB authorization; organization selection; impersonation; actual SSO/OAuth service issuance to middleware.
- Existing session fixture payloads must reflect historical production JWTs (full User shape, not an artificial `{id}` token). Retain their behavioral assertions.
- Run targeted tests, full suite, typecheck, root lint, build-context consistency and diff checks; independent Standards and Spec review.

Completed: 64 focused tests; full suite 57 files / 542 tests passed with `--maxWorkers=2`; all three application typechecks; lint 0 errors (709 pre-existing warnings); k8s consistency and diff checks passed. Standards review 0 findings; Spec review 0 findings. See `review.md` for evidence and verification limits.
