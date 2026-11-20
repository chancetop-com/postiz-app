# Postiz v2.26.0 account recovery references

The stable v2.26.0 tag retains the v2.25.3 password-reset issuance and redemption design. The shared authentication helper, session middleware and controller that resolves an administrator's original identity are unchanged between these releases. No replacement for downstream reset-token purpose separation was identified in this source comparison. The release's optional token encryption addresses credentials kept for connected channels. [v2.26.0 account recovery service](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/backend/src/services/auth/auth.service.ts) · [Release commit comparison](https://github.com/gitroomhq/postiz-app/compare/a5affe62c74e39c1e7ac960d50d8418b807d532c...132859f32d854830ce44b509da87409c3ec10a77) · [Official release](https://github.com/gitroomhq/postiz-app/releases/tag/v2.26.0)

The separate proposal to isolate token purposes, add one-use grants and revoke sessions was closed without merging. Its migration design invalidates existing login sessions and outstanding links. [Public proposal and migration notes](https://github.com/gitroomhq/postiz-app/pull/2382)

This note records static observations about the two published tags.
