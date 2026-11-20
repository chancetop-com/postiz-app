-- Before/after data inventory for the ticket 10 rehearsal.
--
-- Only digests and counts are printed: credentials and content never leave the
-- database. The query runs before the candidate sync and again after every
-- start/restart; any diff means the official sync or the application changed an
-- existing row.

\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
SET TIME ZONE 'UTC';
\set QUIET off

SELECT 'sample.organizations', count(*) FROM "Organization";
SELECT 'sample.users', count(*) FROM "User";
SELECT 'sample.user_organizations', count(*) FROM "UserOrganization";
SELECT 'sample.integrations', count(*) FROM "Integration";
SELECT 'sample.posts', count(*) FROM "Post";
SELECT 'sample.notifications', count(*) FROM "Notifications";
SELECT 'sample.errors', count(*) FROM "Errors";
SELECT 'sample.media', count(*) FROM "Media";
SELECT 'sample.subscriptions', count(*) FROM "Subscription";
SELECT 'sample.oauth_apps', count(*) FROM "OAuthApp";

-- Primary-key sets: the same ids, no row rebuilt under a different id.
SELECT 'pk.organizations', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Organization";
SELECT 'pk.users', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "User";
SELECT 'pk.user_organizations', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "UserOrganization";
SELECT 'pk.integrations', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Integration";
SELECT 'pk.posts', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Post";
SELECT 'pk.notifications', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Notifications";
SELECT 'pk.errors', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Errors";
SELECT 'pk.media', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Media";
SELECT 'pk.subscriptions', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Subscription";

-- Whole-row digests of every column in the old schema. The candidate schema
-- adds indexes only, so a change here is a real value change, not a new column.
SELECT 'digest.table.organizations', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Organization" t;
SELECT 'digest.table.users', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "User" t;
SELECT 'digest.table.user_organizations', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "UserOrganization" t;
SELECT 'digest.table.integrations', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Integration" t;
SELECT 'digest.table.posts', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Post" t;
SELECT 'digest.table.notifications', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Notifications" t;
SELECT 'digest.table.errors', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Errors" t;
SELECT 'digest.table.media', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Media" t;
SELECT 'digest.table.subscriptions', md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY t.id), '')) FROM "Subscription" t;

-- The fields the ticket calls out, digested separately so a failure names them.
SELECT 'digest.users.timezone',
       md5(coalesce(string_agg(id || '|' || timezone::text || '|' || coalesce("timezoneName", '-'), E'\n' ORDER BY id), ''))
FROM "User";

SELECT 'digest.posts.state_publishdate_parent_deleted',
       md5(coalesce(string_agg(
         id || '|' || state::text || '|' ||
         to_char("publishDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '|' ||
         coalesce("parentPostId", '-') || '|' ||
         coalesce("deletedAt"::text, '-'), E'\n' ORDER BY id), ''))
FROM "Post";

SELECT 'digest.posts.media_references',
       md5(coalesce(string_agg(id || '|' || coalesce(image, '-') || '|' || coalesce(settings, '-'), E'\n' ORDER BY id), ''))
FROM "Post";

SELECT 'digest.media.files',
       md5(coalesce(string_agg(id || '|' || coalesce(path, '-') || '|' || coalesce(thumbnail, '-') || '|' || coalesce(type, '-'), E'\n' ORDER BY id), ''))
FROM "Media";

-- Credentials are compared as a digest only; no plaintext is emitted.
SELECT 'digest.integrations.credentials',
       md5(coalesce(string_agg(
         id || '|' || coalesce(token, '-') || '|' || coalesce("refreshToken", '-') || '|' ||
         coalesce("tokenExpiration"::text, '-'), E'\n' ORDER BY id), ''))
FROM "Integration";

SELECT 'digest.memberships.role_disabled',
       md5(coalesce(string_agg(id || '|' || role::text || '|' || disabled::text, E'\n' ORDER BY id), ''))
FROM "UserOrganization";

SELECT 'count.posts_deleted', count(*) FROM "Post" WHERE "deletedAt" IS NOT NULL;
SELECT 'count.notifications_deleted', count(*) FROM "Notifications" WHERE "deletedAt" IS NOT NULL;
SELECT 'count.users_with_timezone_name', count(*) FROM "User" WHERE "timezoneName" IS NOT NULL;
