# Postgres Setup — Design Spec

Date: 2026-08-14
Status: Approved

## Purpose

Build the first of two sub-projects needed to move SecureDoc Chain's
backend off in-memory storage and onto a real Postgres database: tooling,
schema, migrations, a connection module, and a seed script. This
sub-project produces no repository/application code — swapping the
in-memory adapters (`InMemoryDocumentRepository` etc.) for real
Postgres-backed ones in `composition.ts` is a separate, follow-up
sub-project, built on top of this one.

Per the user's stated build order, this is step 2 of 3 (Hono wiring with
in-memory adapters → real database → Flutter app last).

## Environment

Postgres 18 is already installed locally (Windows service
`postgresql-x64-18`, already running) — no Docker, no hosted service. A
dedicated database and role are created for this project rather than
reusing the `postgres` superuser, isolating it from anything else on the
existing instance.

## Tooling

- **Drizzle ORM** (`drizzle-orm`) via the `drizzle-orm/node-postgres`
  driver, backed by `pg` (node-postgres).
- **`drizzle-kit`** for migrations (generates SQL from the TypeScript
  schema; `generate`/`migrate` commands).
- New dependencies: `drizzle-orm@^0.45.2`, `pg@^8.23.0` (runtime);
  `drizzle-kit@^0.31.10`, `@types/pg@^8.23.1` (dev).

## Project Layout

```
drizzle.config.ts                      # drizzle-kit config (repo root, its convention)
drizzle/                               # generated SQL migrations (drizzle-kit output)
.env.example                           # placeholder DATABASE_URL, committed
.env                                   # real DATABASE_URL, gitignored
src/
  infrastructure/
    db/
      schema.ts                        # users, documents, signatures tables
      connection.ts                    # exports `db` (Drizzle client)
      seed.ts                          # inserts the 3 test users
```

## Database + Role Setup

Run manually against the local instance (not automated — the user chose
to run this themselves rather than share the `postgres` password):

```sql
CREATE ROLE securedoc_chain_app WITH LOGIN PASSWORD '<pick a password>';
CREATE DATABASE securedoc_chain OWNER securedoc_chain_app;
```

## Schema (`schema.ts`)

Matches the domain entities exactly — not the README's original draft
schema, which included fields (like `createdAt`) the actual `Document`/
`User`/`Signature` entities don't have.

```
users:
  id                text, primary key
  username          text, not null
  email             text, not null, unique
  public_key        bytea, not null

documents:
  id                text, primary key
  title             text, not null
  file_path         text, not null
  original_hash     bytea, not null
  uploader_id       text, not null, references users(id)

signatures:
  id                     text, primary key
  document_id            text, not null, references documents(id)
  user_id                text, not null, references users(id)
  previous_signature_id  text, nullable, references signatures(id)  -- self-referential
  signature_data         bytea, not null
  signed_at              timestamptz, not null
```

`id` columns are `text`, not native Postgres `uuid` — the domain layer
treats ids as opaque non-empty strings (`Document.create` etc. only check
`!props.id`), not a UUID-typed value object. A `text` column doesn't
silently assume a format the domain doesn't actually enforce, even though
`RandomIdGenerator` happens to produce UUIDs today.

Binary fields (`public_key`, `original_hash`, `signature_data`) are native
`bytea`, via Drizzle's `customType` helper — round-tripping `Uint8Array` on
the way in and out, since Drizzle has no built-in `bytea` column type.

## Environment Variable Loading

A `DATABASE_URL` env var, read from a `.env` file via Node's built-in
`--env-file=.env` CLI flag (Node 20.6+; this project targets Node 24) —
no `dotenv` dependency needed. This is a CLI flag on the relevant npm
scripts (`dev`, `start`, `db:seed`), not a `process.loadEnvFile()` call
inside application code — calling it inside `connection.ts` or `server.ts`
would not reliably run before `DATABASE_URL` is read, because ES module
`import` statements are hoisted above any code in the same file,
regardless of source order. The one exception is `drizzle.config.ts`
itself: it has no problematic imports ahead of its own env read, so it
calls `process.loadEnvFile('.env')` directly at its top — `drizzle-kit`
invokes this file as a plain config script, not through the npm scripts
that already carry `--env-file`.

`.env` is added to `.gitignore`. `.env.example` (committed) contains a
placeholder connection string documenting the expected shape.

## Seed Script (`seed.ts`)

Inserts the same 3 test users `seedUsers.ts` already provides in-memory —
same ids, same fixed public-key bytes (`user-alice`/`[1,2,3,4]`,
`user-bob`/`[5,6,7,8]`, `user-carol`/`[9,10,11,12]`) — so the manual/curl
testing walkthrough already established carries over unchanged once the
follow-up sub-project swaps in real repository adapters. Idempotent via
`onConflictDoNothing()`, so re-running it is harmless.

## Testing / Verification

No application code exists yet to unit test — verification here is
procedural: run the migration against the real local Postgres instance and
inspect the result directly via `psql` (`\d users`, `\d documents`,
`\d signatures` to confirm columns/types/constraints; `SELECT * FROM
users;` after seeding to confirm the 3 rows). Automated tests for real
repository behavior begin in the follow-up sub-project, once
`PostgresDocumentRepository` etc. exist to test against this schema.

## Out of Scope (this sub-project)

- `PostgresDocumentRepository`, `PostgresUserRepository`,
  `PostgresSignatureRepository` (or any other real repository adapter) and
  wiring them into `composition.ts` — the follow-up sub-project.
- Connection pooling tuning, retry/reconnect logic, graceful shutdown —
  none of this exists for the in-memory adapters either; not introduced
  here just because a real network resource is now involved.
- Any change to `FileStorage`, `IdGenerator`, or `Clock` — those stay
  in-memory/Node-builtin-backed; only the three repository ports and their
  backing tables are affected by moving to a real database.
- The Flutter mobile app — still explicitly last per the user's stated
  build order.
