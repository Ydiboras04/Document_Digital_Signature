--
-- PostgreSQL database dump
--

\restrict kidemheInC40YF8QKdOMuCB7oIGHpajNXO9MN9ueEKi2NGERQU383Z0ab9AMcvq

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.signatures DROP CONSTRAINT IF EXISTS signatures_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.signatures DROP CONSTRAINT IF EXISTS signatures_previous_signature_id_signatures_id_fk;
ALTER TABLE IF EXISTS ONLY public.signatures DROP CONSTRAINT IF EXISTS signatures_document_id_documents_id_fk;
ALTER TABLE IF EXISTS ONLY public.documents DROP CONSTRAINT IF EXISTS documents_uploader_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE IF EXISTS ONLY public.signatures DROP CONSTRAINT IF EXISTS signatures_pkey;
ALTER TABLE IF EXISTS ONLY public.documents DROP CONSTRAINT IF EXISTS documents_pkey;
ALTER TABLE IF EXISTS ONLY drizzle.__drizzle_migrations DROP CONSTRAINT IF EXISTS __drizzle_migrations_pkey;
ALTER TABLE IF EXISTS drizzle.__drizzle_migrations ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.signatures;
DROP TABLE IF EXISTS public.documents;
DROP SEQUENCE IF EXISTS drizzle.__drizzle_migrations_id_seq;
DROP TABLE IF EXISTS drizzle.__drizzle_migrations;
DROP SCHEMA IF EXISTS drizzle;
--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id text NOT NULL,
    title text NOT NULL,
    file_path text NOT NULL,
    original_hash bytea NOT NULL,
    uploader_id text NOT NULL
);


--
-- Name: signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signatures (
    id text NOT NULL,
    document_id text NOT NULL,
    user_id text NOT NULL,
    previous_signature_id text,
    signature_data bytea NOT NULL,
    signed_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    public_key bytea NOT NULL,
    is_admin boolean DEFAULT false NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
1	5a68ee60e3657c0cce687c01f78e417d81acd99c84d7578f3d7cc655dd1a2d87	1787212638765
2	8e4a5379d1bc6c346b1d1727e96d7956910ddfef6bd7faa59d004aa3cb7c22e9	1787304573053
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.documents (id, title, file_path, original_hash, uploader_id) FROM stdin;
a6e5a40b-817b-4984-b91d-f583ac693479	69a515f1-0f6e-4ac2-b2d6-ea6b6e198e1c_image.png	1efa4818-3e3f-4ca0-ad59-0557bb702db6	\\x5559e18f278e91d457003dbe163acee488210bc00e7be89485c6b6d0464a523c	c595db33-b688-48f4-bd74-585ac7725441
41a541f2-5846-4049-83eb-ad03de127578	Selection_Projet.pdf	4ec37f80-72db-4f39-a8c0-284fb8d91480	\\xf13adc1a2063a7854952bff3f5e676856b18143b8f5b342ea096fd4410c4609e	c595db33-b688-48f4-bd74-585ac7725441
\.


--
-- Data for Name: signatures; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.signatures (id, document_id, user_id, previous_signature_id, signature_data, signed_at) FROM stdin;
f28da59e-4aff-47e9-b8dc-2f39c8618482	a6e5a40b-817b-4984-b91d-f583ac693479	c595db33-b688-48f4-bd74-585ac7725441	\N	\\x1af8bf7c5e7590f6ea95aec66cd0f07acdaa8789ac965a8db96e5073a968902df55de349eb835e7f56e4355963127b011e5a4ebe74a66aed81eb395c7f2ed104	2026-08-21 15:31:49.709+03
61c5378b-4401-4886-81a5-b9d8c0e07f69	41a541f2-5846-4049-83eb-ad03de127578	c595db33-b688-48f4-bd74-585ac7725441	\N	\\xa8b63c1f89894a76cb0e1f3b9d8ee17a4850a0bab1877701f288949b0f7cb0f68e3111820b76ffa8773095a6d465fd13da38fd533c67b965cff17506df843f0a	2026-08-21 15:33:36.047+03
ffca962b-c412-4635-9226-5b98ac1c6905	41a541f2-5846-4049-83eb-ad03de127578	c98b1ddf-b337-45ee-aa14-4627f026d6c8	61c5378b-4401-4886-81a5-b9d8c0e07f69	\\xbf538fd2f1b04d7a06291225997057e7dd74d785a48c3b83e2ab8b43d43ef111285520e01085f9ed444b875840a9e78b2c8da6e482734683c3ab036a6008e308	2026-08-21 15:36:23.01+03
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, email, public_key, is_admin) FROM stdin;
c595db33-b688-48f4-bd74-585ac7725441	mikle	nomenymitia.andria@gmail.com	\\x6d028cac56a341b2f349ec19e92dc878818b7e14b2d69fa85c5235d0e4dae140	t
user-bob	bob	bob@example.com	\\x4f99ceb0bd8580663fdc9aa28fe51d06f0b4eeb39ef02afe0a830c3607024829	f
c98b1ddf-b337-45ee-aa14-4627f026d6c8	signer2-782627	signer2.782627@example.com	\\xe96ecade69596cac2f4dd27c7dcc085926102723c4de2818a9d63a8ae597ed18	f
user-carol	carol	carol@example.com	\\x212a7e0d87b15a518be245b125bedd448ea1b6602c82385fb3121e087b3fff68	f
user-alice	alice	alice@example.com	\\x5c70df65b55e51615e94e14f78c8a7ffc2cceeb20fb7223ab6166163f1e14b14	t
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: -
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 2, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: signatures signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT signatures_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: documents documents_uploader_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploader_id_users_id_fk FOREIGN KEY (uploader_id) REFERENCES public.users(id);


--
-- Name: signatures signatures_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT signatures_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: signatures signatures_previous_signature_id_signatures_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT signatures_previous_signature_id_signatures_id_fk FOREIGN KEY (previous_signature_id) REFERENCES public.signatures(id);


--
-- Name: signatures signatures_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT signatures_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict kidemheInC40YF8QKdOMuCB7oIGHpajNXO9MN9ueEKi2NGERQU383Z0ab9AMcvq

