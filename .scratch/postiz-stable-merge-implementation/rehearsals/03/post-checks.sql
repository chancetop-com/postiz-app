-- Post-sync checks for the newly added columns, defaults, models and indexes.
-- These are the facts that a row-count comparison cannot prove.

\pset format unaligned
\pset tuples_only on

WITH checks AS (
  SELECT 'Media.status.' || status AS label, count(*)::text AS value FROM "Media" GROUP BY status
  UNION ALL SELECT 'Subscription.provider.' || provider, count(*)::text FROM "Subscription" GROUP BY provider
  UNION ALL SELECT 'Post.creationMethod.' || "creationMethod"::text, count(*)::text FROM "Post" GROUP BY "creationMethod"
  UNION ALL SELECT 'OAuthApp.dynamic.' || dynamic::text, count(*)::text FROM "OAuthApp" GROUP BY dynamic
  UNION ALL SELECT 'User.timezoneName.null', count(*) FILTER (WHERE "timezoneName" IS NULL)::text || '/' || count(*)::text FROM "User"
  UNION ALL SELECT 'User.deletedAt.null', count(*) FILTER (WHERE "deletedAt" IS NULL)::text || '/' || count(*)::text FROM "User"
  UNION ALL SELECT 'Organization.deletedAt.null', count(*) FILTER (WHERE "deletedAt" IS NULL)::text || '/' || count(*)::text FROM "Organization"
  UNION ALL SELECT 'Post.batchId.null', count(*) FILTER (WHERE "batchId" IS NULL)::text || '/' || count(*)::text FROM "Post"
  UNION ALL SELECT 'Media.processingError.null', count(*) FILTER (WHERE "processingError" IS NULL)::text || '/' || count(*)::text FROM "Media"
  UNION ALL SELECT 'OAuthApp.nullableOrganizationId', count(*) FILTER (WHERE "organizationId" IS NULL)::text || '/' || count(*)::text FROM "OAuthApp"
  UNION ALL SELECT 'User.timezone.oldOffsets', string_agg(id || '=' || timezone::text, ',' ORDER BY id) FROM "User"

  -- models that did not exist before the merge
  UNION ALL SELECT 'table.Clipping', count(*)::text FROM "Clipping"
  UNION ALL SELECT 'table.ClippingClip', count(*)::text FROM "ClippingClip"
  UNION ALL SELECT 'table.OAuthSelfHostedAuthorization', count(*)::text FROM "OAuthSelfHostedAuthorization"

  -- the ignored spans table must be untouched by db push
  UNION ALL SELECT 'mastra_ai_spans.pkConstraint', coalesce((SELECT conname FROM pg_constraint WHERE conrelid = 'mastra_ai_spans'::regclass AND contype = 'p'), 'none')
  UNION ALL SELECT 'mastra_ai_spans.columnCount', (
    SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mastra_ai_spans'
  )
  UNION ALL SELECT 'mastra_ai_spans.duplicateKeys', (
    SELECT count(*)::text FROM (
      SELECT "traceId", "spanId" FROM "mastra_ai_spans" GROUP BY "traceId", "spanId" HAVING count(*) > 1
    ) duplicates
  )
)
SELECT label || '|' || value FROM checks ORDER BY label;

-- Indexes that the new schema adds to existing tables.
SELECT 'index|' || indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'Organization_deletedAt_idx',
    'User_deletedAt_idx',
    'Post_batchId_idx',
    'Post_creationMethod_idx',
    'OAuthApp_dynamic_idx',
    'UserOrganization_organizationId_idx'
  )
ORDER BY indexname;
