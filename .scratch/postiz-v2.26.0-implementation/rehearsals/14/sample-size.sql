-- Sample size and table/index bytes for the ticket 10 rehearsal. This is
-- reported, not compared: creating indexes deliberately changes the totals.

\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
\set QUIET off

SELECT 'size.database_bytes', pg_database_size(current_database());
SELECT 'size.post_table_bytes', pg_total_relation_size('public."Post"'::regclass);
SELECT 'size.post_heap_bytes', pg_relation_size('public."Post"'::regclass);
SELECT 'size.notifications_table_bytes', pg_total_relation_size('public."Notifications"'::regclass);
SELECT 'size.errors_table_bytes', pg_total_relation_size('public."Errors"'::regclass);
SELECT 'size.user_table_bytes', pg_total_relation_size('public."User"'::regclass);
SELECT 'rows.post', count(*) FROM "Post";
SELECT 'rows.notifications', count(*) FROM "Notifications";
SELECT 'rows.errors', count(*) FROM "Errors";
SELECT 'rows.user', count(*) FROM "User";
SELECT 'rows.organization', count(*) FROM "Organization";
SELECT 'rows.user_organization', count(*) FROM "UserOrganization";
SELECT 'rows.integration', count(*) FROM "Integration";
SELECT 'rows.media', count(*) FROM "Media";
SELECT 'server.version', version();
