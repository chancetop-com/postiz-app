--
-- PostgreSQL database dump
--

\restrict CpwfQSxa0WGGSgMDkGYoalRrseLimOFdcPfUj8qCSUxFELhRLFBOl1avXSi5kN2

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
-- Data for Name: legacy_unmanaged_archive; Type: TABLE DATA; Schema: public; Owner: postiz
--

COPY public.legacy_unmanaged_archive (id, note) FROM stdin;
1	synthetic legacy row 1
2	synthetic legacy row 2
\.


--
-- Name: legacy_unmanaged_archive_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postiz
--

SELECT pg_catalog.setval('public.legacy_unmanaged_archive_id_seq', 2, true);


--
-- PostgreSQL database dump complete
--

\unrestrict CpwfQSxa0WGGSgMDkGYoalRrseLimOFdcPfUj8qCSUxFELhRLFBOl1avXSi5kN2

