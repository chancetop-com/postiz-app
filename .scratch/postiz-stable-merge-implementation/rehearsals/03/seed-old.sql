-- Synthetic pre-upgrade data for the ticket 03 rehearsal.
-- Everything here is invented: no production identifiers, credentials or
-- content. Values are fixed so the digests are comparable between runs.
--
-- Covers the records the ticket says must survive the official sync:
-- users/organizations/members/roles/disabled, integrations with their
-- internalId/rootInternalId grouping and credentials, posts with their
-- scheduling fields, media with its files and thumbnails, subscriptions and a
-- static OAuth application.

BEGIN;

INSERT INTO "Organization" (id, name, description, "apiKey", "paymentId", "streakSince", "createdAt", "updatedAt", "allowTrial", "isTrailing", shortlink)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Acme Retail', 'synthetic merchant org', 'synth-api-key-acme', 'cus_synth_acme', '2025-03-01 08:00:00', '2024-11-02 09:00:00', '2025-06-10 12:00:00', true, false, 'ASK'),
  ('22222222-2222-4222-8222-222222222222', 'Beta Studio', 'synthetic second org', NULL, NULL, NULL, '2025-01-15 10:30:00', '2025-05-20 18:45:00', false, false, 'ASK');

INSERT INTO "User" (id, email, password, "providerName", name, "lastName", "isSuperAdmin", bio, audience, "pictureId", "providerId", timezone, "createdAt", "updatedAt", "lastReadNotifications", "inviteId", activated, account, "connectedAccount", "lastOnline", ip, agent, "sendSuccessEmails", "sendFailureEmails", "sendStreakEmails")
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice@example.invalid', '$2b$10$synthetic.hash.not.a.real.credential', 'GENERIC', 'Alice', 'Synthetic', false, 'merchant owner', 12, NULL, 'merchant-1001', 120, '2024-11-02 09:05:00', '2025-06-10 12:05:00', '2025-06-09 07:00:00', NULL, true, 'merchant-1001', true, '2025-06-10 11:59:00', '203.0.113.10', NULL, true, true, true),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'bob@example.invalid', NULL, 'LOCAL', 'Bob', 'Synthetic', false, NULL, 0, NULL, NULL, -300, '2025-01-15 10:35:00', '2025-04-01 09:00:00', '2025-04-01 09:00:00', NULL, true, NULL, false, '2025-04-01 08:59:00', NULL, NULL, true, true, false),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'carol@example.invalid', NULL, 'GENERIC', 'Carol', 'Synthetic', false, NULL, 0, NULL, 'merchant-1002', 60, '2025-02-02 14:00:00', '2025-02-02 14:00:00', '2025-02-02 14:00:00', NULL, false, 'merchant-1002', false, '2025-02-02 14:00:00', NULL, NULL, true, true, true);

INSERT INTO "UserOrganization" (id, "userId", "organizationId", disabled, role, "createdAt", "updatedAt")
VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', false, 'SUPERADMIN', '2024-11-02 09:00:00', '2024-11-02 09:00:00'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', false, 'ADMIN', '2025-01-20 11:00:00', '2025-01-20 11:00:00'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', true, 'USER', '2025-01-15 10:40:00', '2025-01-15 10:40:00'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', false, 'USER', '2025-02-02 14:05:00', '2025-02-02 14:05:00');

INSERT INTO "Media" (id, name, "originalName", path, "organizationId", "createdAt", "updatedAt", "deletedAt", "fileSize", type, thumbnail, alt, "thumbnailTimestamp")
VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'launch.png', 'Launch Banner.PNG', 'uploads/2025/01/launch.png', '11111111-1111-4111-8111-111111111111', '2025-01-10 08:00:00', '2025-01-10 08:00:00', NULL, 84123, 'image', 'uploads/2025/01/launch.thumb.png', 'launch banner', NULL),
  ('cccccccc-0000-4000-8000-000000000002', 'old-logo.jpg', NULL, 'uploads/2024/11/old-logo.jpg', '11111111-1111-4111-8111-111111111111', '2024-11-02 09:30:00', '2024-12-01 10:00:00', NULL, 15234, 'image', NULL, NULL, NULL),
  ('cccccccc-0000-4000-8000-000000000003', 'clip.mp4', 'clip.mp4', 'uploads/2025/01/clip.mp4', '22222222-2222-4222-8222-222222222222', '2025-01-16 09:00:00', '2025-01-16 09:00:00', NULL, 1048576, 'video', 'uploads/2025/01/clip.thumb.jpg', NULL, 1500),
  ('cccccccc-0000-4000-8000-000000000004', 'deleted.png', NULL, 'uploads/2025/02/deleted.png', '11111111-1111-4111-8111-111111111111', '2025-02-01 09:00:00', '2025-02-20 09:00:00', '2025-02-20 09:00:00', 2048, 'image', NULL, NULL, NULL);

INSERT INTO "Subscription" (id, "organizationId", "subscriptionTier", identifier, "cancelAt", period, "totalChannels", "isLifetime", "createdAt", "updatedAt", "deletedAt")
VALUES
  ('dddddddd-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'PRO', 'sub_synth_acme', NULL, 'MONTHLY', 5, false, '2024-11-02 09:10:00', '2025-06-01 00:00:00', NULL),
  ('dddddddd-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'STANDARD', NULL, '2026-01-01 00:00:00', 'YEARLY', 1, false, '2025-01-15 10:45:00', '2025-05-20 18:45:00', NULL);

-- Two pages of the same LinkedIn account share rootInternalId, plus an X
-- account, an Instagram account that only has a single token, and a second X
-- account in the other organization. No unique root rewrite may happen.
INSERT INTO "Integration" (id, "internalId", "organizationId", name, picture, "providerIdentifier", type, token, disabled, "tokenExpiration", "refreshToken", profile, "deletedAt", "createdAt", "updatedAt", "inBetweenSteps", "refreshNeeded", "postingTimes", "customInstanceDetails", "customerId", "rootInternalId", "additionalSettings")
VALUES
  ('eeeeeeee-0000-4000-8000-000000000001', 'x:1001', '11111111-1111-4111-8111-111111111111', 'Acme on X', 'https://cdn.example.invalid/x.png', 'x', 'social', 'synthetic-token-x-acme', false, '2026-12-01 00:00:00', 'synthetic-refresh-x-acme', '{"id":"1001","name":"Acme"}', NULL, '2024-11-03 09:00:00', '2025-06-01 09:00:00', false, false, '[{"time":120}, {"time":400}, {"time":700}]', NULL, NULL, NULL, '[]'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'linkedin|12345', '11111111-1111-4111-8111-111111111111', 'Acme Corp page', NULL, 'linkedin-page', 'social', 'synthetic-token-li-acme', false, '2026-10-01 00:00:00', 'synthetic-refresh-li-acme', '{"id":"12345","name":"Acme Corp"}', NULL, '2024-11-03 09:10:00', '2025-05-30 09:00:00', false, true, '[{"time":120}, {"time":400}]', NULL, NULL, 'linkedin|12345', '[]'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'linkedin|12345|67890', '11111111-1111-4111-8111-111111111111', 'Acme Careers page', NULL, 'linkedin-page', 'social', 'synthetic-token-li-careers', false, '2026-10-01 00:00:00', 'synthetic-refresh-li-careers', '{"id":"67890","name":"Acme Careers"}', NULL, '2024-11-03 09:12:00', '2025-05-30 09:05:00', false, false, '[{"time":120}, {"time":400}]', NULL, NULL, 'linkedin|12345', '[]'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'x:2002', '22222222-2222-4222-8222-222222222222', 'Beta on X', NULL, 'x', 'social', 'synthetic-token-x-beta', false, NULL, NULL, '{"id":"2002","name":"Beta"}', NULL, '2025-01-16 09:00:00', '2025-01-16 09:00:00', false, false, '[{"time":120}]', NULL, NULL, NULL, '[]'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'instagram:ig-1', '11111111-1111-4111-8111-111111111111', 'Acme Instagram', NULL, 'instagram-standalone', 'social', 'synthetic-single-token-instagram', false, NULL, NULL, '{"id":"ig-1","name":"acme.ig"}', NULL, '2025-02-10 09:00:00', '2025-02-10 09:00:00', false, false, '[{"time":120}]', NULL, NULL, NULL, '[]');

-- Published, queued, drafts, an error, a parent/child group and a soft-deleted
-- post. publishDate, state, releaseId/releaseURL, settings and image must keep
-- their exact values; the old rows have no batchId and no creation source.
INSERT INTO "Post" (id, state, "publishDate", "organizationId", "integrationId", content, delay, "group", title, description, "parentPostId", "releaseId", "releaseURL", settings, image, "submittedForOrderId", "submittedForOrganizationId", "approvedSubmitForOrder", "lastMessageId", "intervalInDays", error, "createdAt", "updatedAt", "deletedAt")
VALUES
  ('ffffffff-0000-4000-8000-000000000001', 'PUBLISHED', '2025-03-14 09:30:00', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001', 'Synthetic spring launch', 0, 'grp-launch', 'Spring launch', 'first post of the group', NULL, 'rel-synth-1001', 'https://x.example.invalid/acme/status/1', '{"imageId":"cccccccc-0000-4000-8000-000000000001","thumb":"uploads/2025/01/launch.thumb.png"}', 'uploads/2025/01/launch.png', NULL, NULL, 'NO', NULL, NULL, NULL, '2025-02-10 10:00:00', '2025-03-14 09:30:05', NULL),
  ('ffffffff-0000-4000-8000-000000000002', 'QUEUE', '2026-04-01 15:45:00', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001', 'Synthetic follow-up', 0, 'grp-launch', 'Follow-up', NULL, 'ffffffff-0000-4000-8000-000000000001', NULL, NULL, '{"imageId":"cccccccc-0000-4000-8000-000000000001"}', 'uploads/2025/01/launch.png', NULL, NULL, 'NO', NULL, NULL, NULL, '2025-02-10 10:05:00', '2025-02-10 10:05:00', NULL),
  ('ffffffff-0000-4000-8000-000000000003', 'QUEUE', '2026-04-01 15:45:00', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000002', 'Synthetic LinkedIn page post', 0, 'grp-launch', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'NO', NULL, NULL, NULL, '2025-02-10 10:06:00', '2025-02-10 10:06:00', NULL),
  ('ffffffff-0000-4000-8000-000000000004', 'DRAFT', '2026-05-05 08:00:00', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000003', 'Synthetic careers draft', 5, 'grp-draft', 'Careers', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'NO', NULL, 3, NULL, '2025-02-11 08:00:00', '2025-02-11 08:00:00', NULL),
  ('ffffffff-0000-4000-8000-000000000005', 'ERROR', '2025-12-24 07:15:00', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000004', 'Synthetic failed post', 0, 'grp-error', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'NO', NULL, NULL, 'synthetic provider timeout', '2025-12-24 07:10:00', '2025-12-24 07:16:00', NULL),
  ('ffffffff-0000-4000-8000-000000000006', 'PUBLISHED', '2025-04-02 12:00:00', '22222222-2222-4222-8222-222222222222', 'eeeeeeee-0000-4000-8000-000000000004', 'Synthetic beta announcement', 0, 'grp-beta', NULL, NULL, NULL, 'rel-synth-2002', 'https://x.example.invalid/beta/status/2', '{"imageId":"cccccccc-0000-4000-8000-000000000003"}', 'uploads/2025/01/clip.mp4', NULL, NULL, 'NO', NULL, NULL, NULL, '2025-04-01 09:00:00', '2025-04-02 12:00:03', NULL),
  ('ffffffff-0000-4000-8000-000000000007', 'PUBLISHED', '2025-05-01 10:00:00', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001', 'Synthetic removed post', 0, 'grp-removed', NULL, NULL, NULL, 'rel-synth-1002', 'https://x.example.invalid/acme/status/3', NULL, 'uploads/2024/11/old-logo.jpg', NULL, NULL, 'NO', NULL, NULL, NULL, '2025-05-01 09:55:00', '2025-05-02 09:00:00', '2025-05-02 09:00:00');

INSERT INTO "OAuthApp" (id, "organizationId", name, description, "pictureId", "redirectUrl", "clientId", "clientSecret", "createdAt", "updatedAt", "deletedAt")
VALUES
  ('99999999-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Acme static app', 'synthetic static OAuth app', 'cccccccc-0000-4000-8000-000000000001', 'https://acme.example.invalid/oauth/callback', 'synth-static-client', 'synthetic-client-secret', '2025-01-05 09:00:00', '2025-01-05 09:00:00', NULL);

COMMIT;
