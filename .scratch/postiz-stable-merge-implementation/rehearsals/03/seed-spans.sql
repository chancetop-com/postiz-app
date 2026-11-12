-- The spans table is declared with @@ignore in both the pre-merge and the
-- post-merge Prisma schema. @@ignore keeps the model out of the generated
-- client, but the rehearsal confirms `db push` still creates and alters the
-- table, and the post-merge schema adds a composite primary key to it.
-- A real deployment got the pre-merge shape from Mastra itself, which is why
-- the rehearsal creates it here with the pre-merge column set and no primary key.
CREATE TABLE IF NOT EXISTS "mastra_ai_spans" (
  "traceId" text NOT NULL,
  "spanId" text NOT NULL,
  "parentSpanId" text,
  name text NOT NULL,
  scope jsonb,
  "spanType" text NOT NULL,
  attributes jsonb,
  metadata jsonb,
  links jsonb,
  input jsonb,
  output jsonb,
  error jsonb,
  "startedAt" timestamp(6) NOT NULL,
  "endedAt" timestamp(6),
  "createdAt" timestamp(6) NOT NULL,
  "updatedAt" timestamp(6),
  "isEvent" boolean NOT NULL,
  "startedAtZ" timestamptz(6) DEFAULT now(),
  "endedAtZ" timestamptz(6) DEFAULT now(),
  "createdAtZ" timestamptz(6) DEFAULT now(),
  "updatedAtZ" timestamptz(6) DEFAULT now()
);

INSERT INTO "mastra_ai_spans" ("traceId", "spanId", "parentSpanId", name, "spanType", input, output, "startedAt", "endedAt", "createdAt", "updatedAt", "isEvent")
VALUES
  ('trace-synth-1', 'span-synth-1a', NULL, 'agent run', 'agent_run', '{"prompt":"synthetic"}', '{"text":"synthetic"}', '2025-06-01 09:00:00', '2025-06-01 09:00:02', '2025-06-01 09:00:00', '2025-06-01 09:00:02', false),
  ('trace-synth-1', 'span-synth-1b', 'span-synth-1a', 'tool call', 'tool_call', '{"tool":"synthetic"}', '{"ok":true}', '2025-06-01 09:00:01', '2025-06-01 09:00:02', '2025-06-01 09:00:01', '2025-06-01 09:00:02', false);

-- The duplicate sample: the same (traceId, spanId) twice with different
-- payloads and timestamps. It is only inserted by the spans scenario.
-- Included here as a comment so the exact sample is reproducible:
--
-- INSERT INTO "mastra_ai_spans" (...) VALUES
--   ('trace-synth-1', 'span-synth-1b', ..., '2025-06-01 09:00:01', ...);
