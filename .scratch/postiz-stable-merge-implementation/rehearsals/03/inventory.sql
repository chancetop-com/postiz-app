-- Retention inventory: one line per checked fact, `label|digest`.
--
-- Only columns that exist in both the pre-merge and the post-merge schema are
-- referenced, so the same file runs before and after the official sync. Primary
-- key sets and per-column values are digested separately, ordered by id, so a
-- changed row count alone cannot hide a changed value.
--
-- Sensitive synthetic credentials (password, token, refreshToken,
-- clientSecret) are only ever emitted as digests.

\pset format unaligned
\pset tuples_only on

WITH facts AS (
  -- primary key sets
  SELECT 'Organization.pk' AS label, md5(coalesce(string_agg(id, ',' ORDER BY id), '')) AS digest FROM "Organization"
  UNION ALL SELECT 'User.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'UserOrganization.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "UserOrganization"
  UNION ALL SELECT 'Media.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Media"
  UNION ALL SELECT 'Subscription.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Subscription"
  UNION ALL SELECT 'Integration.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Post.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'OAuthApp.pk', md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM "OAuthApp"
  UNION ALL SELECT 'mastra_ai_spans.pk', md5(coalesce(string_agg(coalesce("traceId", '') || ':' || coalesce("spanId", ''), ',' ORDER BY "traceId", "spanId"), '')) FROM "mastra_ai_spans"

  -- row counts
  UNION ALL SELECT 'Organization.count', count(*)::text FROM "Organization"
  UNION ALL SELECT 'User.count', count(*)::text FROM "User"
  UNION ALL SELECT 'UserOrganization.count', count(*)::text FROM "UserOrganization"
  UNION ALL SELECT 'Media.count', count(*)::text FROM "Media"
  UNION ALL SELECT 'Subscription.count', count(*)::text FROM "Subscription"
  UNION ALL SELECT 'Integration.count', count(*)::text FROM "Integration"
  UNION ALL SELECT 'Post.count', count(*)::text FROM "Post"
  UNION ALL SELECT 'OAuthApp.count', count(*)::text FROM "OAuthApp"
  UNION ALL SELECT 'mastra_ai_spans.count', count(*)::text FROM "mastra_ai_spans"

  -- identity and organization membership
  UNION ALL SELECT 'Organization.name', md5(coalesce(string_agg(id || '=' || name, '|' ORDER BY id), '')) FROM "Organization"
  UNION ALL SELECT 'Organization.apiKey', md5(coalesce(string_agg(id || '=' || coalesce("apiKey", '<null>'), '|' ORDER BY id), '')) FROM "Organization"
  UNION ALL SELECT 'Organization.paymentId', md5(coalesce(string_agg(id || '=' || coalesce("paymentId", '<null>'), '|' ORDER BY id), '')) FROM "Organization"
  UNION ALL SELECT 'Organization.streakSince', md5(coalesce(string_agg(id || '=' || coalesce("streakSince"::text, '<null>'), '|' ORDER BY id), '')) FROM "Organization"
  UNION ALL SELECT 'Organization.createdAt', md5(coalesce(string_agg(id || '=' || "createdAt"::text, '|' ORDER BY id), '')) FROM "Organization"
  UNION ALL SELECT 'User.email', md5(coalesce(string_agg(id || '=' || email, '|' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'User.password', md5(coalesce(string_agg(id || '=' || coalesce(password, '<null>'), '|' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'User.provider', md5(coalesce(string_agg(id || '=' || "providerName"::text, '|' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'User.providerId', md5(coalesce(string_agg(id || '=' || coalesce("providerId", '<null>'), '|' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'User.account', md5(coalesce(string_agg(id || '=' || coalesce(account, '<null>'), '|' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'User.timezone', md5(coalesce(string_agg(id || '=' || timezone::text || ':' || activated::text || ':' || "connectedAccount"::text, '|' ORDER BY id), '')) FROM "User"
  UNION ALL SELECT 'User.createdAt', md5(coalesce(string_agg(id || '=' || "createdAt"::text, '|' ORDER BY id), '')) FROM "User"

  -- members, roles and disabled flags
  UNION ALL SELECT 'UserOrganization.membership', md5(coalesce(string_agg(id || '=' || "userId" || '>' || "organizationId" || ':' || role::text || ':' || disabled::text || ':' || "createdAt"::text, '|' ORDER BY id), '')) FROM "UserOrganization"

  -- channels and their credentials
  UNION ALL SELECT 'Integration.relation', md5(coalesce(string_agg(id || '=' || "organizationId" || ':' || "internalId" || ':' || coalesce("rootInternalId", '<null>') || ':' || "providerIdentifier" || ':' || type, '|' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Integration.token', md5(coalesce(string_agg(id || '=' || token, '|' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Integration.refreshToken', md5(coalesce(string_agg(id || '=' || coalesce("refreshToken", '<null>'), '|' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Integration.tokenExpiration', md5(coalesce(string_agg(id || '=' || coalesce("tokenExpiration"::text, '<null>'), '|' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Integration.flags', md5(coalesce(string_agg(id || '=' || disabled::text || ':' || "refreshNeeded"::text || ':' || "inBetweenSteps"::text || ':' || "postingTimes", '|' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Integration.profile', md5(coalesce(string_agg(id || '=' || coalesce(profile, '<null>'), '|' ORDER BY id), '')) FROM "Integration"
  UNION ALL SELECT 'Integration.updatedAt', md5(coalesce(string_agg(id || '=' || coalesce("updatedAt"::text, '<null>'), '|' ORDER BY id), '')) FROM "Integration"

  -- subscriptions
  UNION ALL SELECT 'Subscription.plan', md5(coalesce(string_agg(id || '=' || "organizationId" || ':' || "subscriptionTier"::text || ':' || period::text || ':' || "totalChannels"::text || ':' || "isLifetime"::text || ':' || coalesce(identifier, '<null>') || ':' || coalesce("cancelAt"::text, '<null>'), '|' ORDER BY id), '')) FROM "Subscription"
  UNION ALL SELECT 'Subscription.deletedAt', md5(coalesce(string_agg(id || '=' || coalesce("deletedAt"::text, '<null>'), '|' ORDER BY id), '')) FROM "Subscription"

  -- posts: ids, channel, group/parent, schedule, state, release and payload
  UNION ALL SELECT 'Post.relation', md5(coalesce(string_agg(id || '=' || "organizationId" || ':' || "integrationId" || ':' || "group" || ':' || coalesce("parentPostId", '<null>'), '|' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'Post.publishDate', md5(coalesce(string_agg(id || '=' || "publishDate"::text, '|' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'Post.state', md5(coalesce(string_agg(id || '=' || state::text, '|' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'Post.release', md5(coalesce(string_agg(id || '=' || coalesce("releaseId", '<null>') || ':' || coalesce("releaseURL", '<null>'), '|' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'Post.payload', md5(coalesce(string_agg(id || '=' || coalesce(settings, '<null>') || ':' || coalesce(image, '<null>'), '|' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'Post.content', md5(coalesce(string_agg(id || '=' || content, '|' ORDER BY id), '')) FROM "Post"
  UNION ALL SELECT 'Post.timestamps', md5(coalesce(string_agg(id || '=' || "createdAt"::text || ':' || "updatedAt"::text || ':' || coalesce("deletedAt"::text, '<null>') || ':' || coalesce("intervalInDays"::text, '<null>') || ':' || coalesce(error, '<null>'), '|' ORDER BY id), '')) FROM "Post"

  -- media: ids, files, URLs, thumbnails and soft delete
  UNION ALL SELECT 'Media.relation', md5(coalesce(string_agg(id || '=' || "organizationId" || ':' || name || ':' || coalesce("originalName", '<null>') || ':' || type || ':' || "fileSize"::text, '|' ORDER BY id), '')) FROM "Media"
  UNION ALL SELECT 'Media.path', md5(coalesce(string_agg(id || '=' || path, '|' ORDER BY id), '')) FROM "Media"
  UNION ALL SELECT 'Media.thumbnail', md5(coalesce(string_agg(id || '=' || coalesce(thumbnail, '<null>') || ':' || coalesce(alt, '<null>') || ':' || coalesce("thumbnailTimestamp"::text, '<null>'), '|' ORDER BY id), '')) FROM "Media"
  UNION ALL SELECT 'Media.deletedAt', md5(coalesce(string_agg(id || '=' || coalesce("deletedAt"::text, '<null>'), '|' ORDER BY id), '')) FROM "Media"

  -- static OAuth application
  UNION ALL SELECT 'OAuthApp.relation', md5(coalesce(string_agg(id || '=' || "organizationId" || ':' || "clientId" || ':' || "redirectUrl" || ':' || coalesce("deletedAt"::text, '<null>'), '|' ORDER BY id), '')) FROM "OAuthApp"
  UNION ALL SELECT 'OAuthApp.clientSecret', md5(coalesce(string_agg(id || '=' || coalesce("clientSecret", '<null>'), '|' ORDER BY id), '')) FROM "OAuthApp"

  -- ignored Mastra spans: composite key duplicates must not be deleted
  UNION ALL SELECT 'mastra_ai_spans.rows', md5(coalesce(string_agg("traceId" || ':' || "spanId" || ':' || name || ':' || "createdAt"::text, '|' ORDER BY "createdAt", name), '')) FROM "mastra_ai_spans"
)
SELECT label || '|' || digest FROM facts ORDER BY label;
