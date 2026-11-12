-- Documented recovery for the one condition the official sync does not touch:
-- the ignored mastra_ai_spans table with duplicate (traceId, spanId) rows.
--
-- This mirrors PgDB.migrateSpans() in @mastra/pg 1.x, which is what
-- `npx mastra migrate` runs: keep the completed span over an incomplete one,
-- then the most recent updatedAt, then the most recent createdAt, then the
-- lower ctid; remove the rest; add the composite primary key. It is a manual
-- operator decision about trace data, not part of the application's startup
-- sync, and it is never applied automatically by the candidate container.
BEGIN;

DELETE FROM "mastra_ai_spans" t1
USING "mastra_ai_spans" t2
WHERE t1."traceId" = t2."traceId"
  AND t1."spanId" = t2."spanId"
  AND (
    (t1."endedAt" IS NULL AND t2."endedAt" IS NOT NULL)
    OR (
      (t1."endedAt" IS NULL) = (t2."endedAt" IS NULL)
      AND (
        (t1."updatedAt" < t2."updatedAt")
        OR (t1."updatedAt" IS NULL AND t2."updatedAt" IS NOT NULL)
        OR (
          (t1."updatedAt" = t2."updatedAt" OR (t1."updatedAt" IS NULL AND t2."updatedAt" IS NULL))
          AND (
            (t1."createdAt" < t2."createdAt")
            OR (t1."createdAt" IS NULL AND t2."createdAt" IS NOT NULL)
            OR (
              (t1."createdAt" = t2."createdAt" OR (t1."createdAt" IS NULL AND t2."createdAt" IS NULL))
              AND t1.ctid < t2.ctid
            )
          )
        )
      )
    )
  );

ALTER TABLE "mastra_ai_spans"
  ADD CONSTRAINT "public_mastra_ai_spans_traceid_spanid_pk" PRIMARY KEY ("traceId", "spanId");

COMMIT;

-- Why the constraint is named "public_..." instead of Mastra's default
-- "mastra_ai_spans_traceid_spanid_pk": the name above is the one the Prisma
-- schema maps for `@@id(map: ...)`. Prisma 6.5.0 fails to apply its own sync
-- when it has to rename that primary key in the same ALTER TABLE that adds the
-- new span columns — it emits an invalid statement
-- (`ERROR: syntax error at or near ","`, step
-- `AlterTable { changes: [RenamePrimaryKey, AddColumn, ...] }`) and the
-- container never starts. Using the mapped name makes the next sync a plain
-- "add columns" step, which succeeds; the Mastra store accepts the renamed
-- primary key. `npx mastra migrate` uses Mastra's default name, so after
-- running it, rename the constraint to `public_mastra_ai_spans_traceid_spanid_pk`
-- before the next start.
