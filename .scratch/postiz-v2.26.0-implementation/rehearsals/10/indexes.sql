-- The five indexes v2.26.0 adds, by the names Prisma 6.5.0 generates.
-- The exact names are also cross-checked against a reference database pushed
-- from the candidate schema, so this file cannot silently drift.

\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
\set QUIET off

WITH expected(name) AS (
  VALUES
    ('Post_organizationId_publishDate_idx'),
    ('Post_publishDate_state_deletedAt_parentPostId_integrationId_idx'),
    ('Notifications_organizationId_createdAt_deletedAt_idx'),
    ('User_providerId_providerName_idx'),
    ('Errors_createdAt_platform_idx')
)
SELECT e.name || E'\t' || coalesce(i.indexdef, 'MISSING')
FROM expected e
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public' AND i.indexname = e.name
ORDER BY e.name;

SELECT 'indexes.total', count(*) FROM pg_indexes WHERE schemaname = 'public';
SELECT 'indexes.on_post', count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Post';
