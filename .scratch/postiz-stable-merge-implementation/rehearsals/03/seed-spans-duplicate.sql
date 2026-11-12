-- Adds a second row with the same (traceId, spanId) as an existing span.
-- Used to check what the official sync and the Mastra store initialisation
-- really do with a duplicate composite key sample.
INSERT INTO "mastra_ai_spans" ("traceId", "spanId", "parentSpanId", name, "spanType", input, output, "startedAt", "endedAt", "createdAt", "updatedAt", "isEvent")
VALUES
  ('trace-synth-1', 'span-synth-1b', 'span-synth-1a', 'tool call (retried)', 'tool_call', '{"tool":"synthetic","attempt":2}', '{"ok":true}', '2025-06-01 09:00:01', '2025-06-01 09:00:03', '2025-06-01 09:00:01', '2025-06-01 09:00:03', false);
