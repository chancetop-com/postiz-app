--
-- PostgreSQL database dump
--

\restrict Rnh9MFhKVfv2yROOXqSGl0HecKHjldGVpRQIDEfv01AAVAWokHPsY0vznjiR8wD

-- Dumped from database version 15.19 (Debian 15.19-1.pgdg13+2)
-- Dumped by pg_dump version 15.19 (Debian 15.19-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: mastra_ai_spans; Type: TABLE DATA; Schema: public; Owner: postiz
--

COPY public.mastra_ai_spans ("traceId", "spanId", "parentSpanId", name, scope, "spanType", attributes, metadata, links, input, output, error, "startedAt", "endedAt", "createdAt", "updatedAt", "isEvent", "startedAtZ", "endedAtZ", "createdAtZ", "updatedAtZ") FROM stdin;
trace-synth-1	span-synth-1a	\N	agent run	\N	agent_run	\N	\N	\N	{"prompt": "synthetic"}	{"text": "synthetic"}	\N	2025-06-01 09:00:00	2025-06-01 09:00:02	2025-06-01 09:00:00	2025-06-01 09:00:02	f	2026-11-12 00:41:33.905492+00	2026-11-12 00:41:33.905492+00	2026-11-12 00:41:33.905492+00	2026-11-12 00:41:33.905492+00
trace-synth-1	span-synth-1b	span-synth-1a	tool call	\N	tool_call	\N	\N	\N	{"tool": "synthetic"}	{"ok": true}	\N	2025-06-01 09:00:01	2025-06-01 09:00:02	2025-06-01 09:00:01	2025-06-01 09:00:02	f	2026-11-12 00:41:33.905492+00	2026-11-12 00:41:33.905492+00	2026-11-12 00:41:33.905492+00	2026-11-12 00:41:33.905492+00
trace-synth-1	span-synth-1b	span-synth-1a	tool call (retried)	\N	tool_call	\N	\N	\N	{"tool": "synthetic", "attempt": 2}	{"ok": true}	\N	2025-06-01 09:00:01	2025-06-01 09:00:03	2025-06-01 09:00:01	2025-06-01 09:00:03	f	2026-11-12 00:41:33.969267+00	2026-11-12 00:41:33.969267+00	2026-11-12 00:41:33.969267+00	2026-11-12 00:41:33.969267+00
\.


--
-- PostgreSQL database dump complete
--

\unrestrict Rnh9MFhKVfv2yROOXqSGl0HecKHjldGVpRQIDEfv01AAVAWokHPsY0vznjiR8wD

