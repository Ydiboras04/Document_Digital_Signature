# Postgres Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Drizzle ORM + a dedicated local Postgres database for SecureDoc Chain: schema, migrations, a connection module, and a seed script — no repository/application code yet.

**Architecture:** `drizzle-orm` (via `drizzle-orm/node-postgres`) talks to a dedicated `securedoc_chain` database/role on the already-running local Postgres 18 instance. `drizzle-kit` generates and applies SQL migrations from a TypeScript schema that mirrors the domain entities exactly.

**Tech Stack:** `drizzle-orm`, `pg` (runtime); `drizzle-kit`, `@types/pg` (dev). Node's built-in `--env-file` flag for `.env` loading — no `dotenv` dependency.

**Spec:** `docs/superpowers/specs/2026-08-14-postgres-setup-design.md`

## Global Constraints

- No repository/application code in this plan — `PostgresDocumentRepository` etc. and wiring them into `composition.ts` are a separate, follow-up sub-project.
- `id` columns are `text`, not native Postgres `uuid` — the domain layer treats ids as opaque strings, not a UUID-typed value object.
- Binary columns (`public_key`, `original_hash`, `signature_data`) are native `bytea` via Drizzle's `customType` helper.
- `.env` (real credentials) is gitignored; `.env.example` (placeholder) is committed.
- `--env-file=.env` goes on the `dev`, `start`, and `db:seed` npm scripts — NOT a `process.loadEnvFile()` call inside `connection.ts` or `server.ts`, because ES module imports are hoisted above same-file code regardless of source order, so an in-code call wouldn't reliably run before `DATABASE_URL` is read. `drizzle.config.ts` is the one exception: it calls `process.loadEnvFile('.env')` directly at its own top, since it has no problematic imports ahead of its own env read and `drizzle-kit` doesn't go through the npm scripts that already carry the flag.
- This plan has no automated test suite to run — verification is procedural, via `psql` against the real local database, since there's no application code yet to unit test.
- All new files use explicit `.js` extensions on relative imports, per the established convention (except `drizzle.config.ts` at the repo root, which isn't part of `src/` and follows `drizzle-kit`'s own convention of a plain `.ts` config file).

---

### Task 1: Database, role, dependencies, and env files

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `.env` (gitignored, not committed)

**Interfaces:**
- Produces: a `securedoc_chain_app`-owned `securedoc_chain` database reachable via `DATABASE_URL`; `drizzle-orm`, `pg`, `drizzle-kit`, `@types/pg` installed; `db:generate`, `db:migrate`, `db:seed` npm scripts (implemented in later tasks — this task only adds the script entries, Task 3/4 add the files they invoke). Task 2's `schema.ts` and Task 3's `connection.ts`/`drizzle.config.ts` both depend on `DATABASE_URL` being set.

- [ ] **Step 1: Create the database and role**

Postgres 18 is already installed and running as a Windows service (`postgresql-x64-18`). Run this yourself — it needs the `postgres` superuser password, which stays with you:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE ROLE securedoc_chain_app WITH LOGIN PASSWORD 'CHANGE_ME';"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE securedoc_chain OWNER securedoc_chain_app;"
```

Replace `CHANGE_ME` with a real password of your choosing (used only locally). Each command prompts for the `postgres` password interactively.

- [ ] **Step 2: Verify the new role can connect**

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "SELECT current_database();"
```

Expected: prompts for the password you set in Step 1, then prints `securedoc_chain` as the current database.

- [ ] **Step 3: Install dependencies**

```bash
npm install drizzle-orm@^0.45.2 pg@^8.23.0
npm install -D drizzle-kit@^0.31.10 @types/pg@^8.23.1
```

- [ ] **Step 4: Add npm scripts**

Update `package.json`'s `"scripts"` block to:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "dev": "tsx --env-file=.env watch src/interface-adapters/http/server.ts",
  "build": "tsc",
  "start": "node --env-file=.env dist/interface-adapters/http/server.js",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:seed": "tsx --env-file=.env src/infrastructure/db/seed.ts"
}
```

- [ ] **Step 5: Add .env and .env.example**

Create `.env.example` (committed):
```
DATABASE_URL=postgresql://securedoc_chain_app:CHANGE_ME@localhost:5432/securedoc_chain
```

Create `.env` (NOT committed — put your real password in here):
```
DATABASE_URL=postgresql://securedoc_chain_app:<your real password from Step 1>@localhost:5432/securedoc_chain
```

Update `.gitignore` to add:
```
.env
```

(Leave the existing `.claude/` and `node_modules/` entries as they are.)

- [ ] **Step 6: Verify nothing broke**

Run: `npm run typecheck`
Expected: passes with no errors (nothing new imports the new dependencies yet).

- [ ] **Step 7: Commit**

`.env` must NOT be committed — only stage the specific files below:

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: add Drizzle/pg dependencies and env file setup"
```

---

### Task 2: Schema

**Files:**
- Create: `src/infrastructure/db/schema.ts`

**Interfaces:**
- Consumes: `pgTable`, `text`, `timestamp`, `customType`, `AnyPgColumn` from `drizzle-orm/pg-core`.
- Produces: `users`, `documents`, `signatures` — Drizzle table definitions. Task 3's `drizzle.config.ts`/`connection.ts` and Task 4's `seed.ts` all import from this file.

- [ ] **Step 1: Write the schema**

Create `src/infrastructure/db/schema.ts`:

```ts
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value)
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value)
  }
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email').notNull().unique(),
  publicKey: bytea('public_key').notNull()
})

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  originalHash: bytea('original_hash').notNull(),
  uploaderId: text('uploader_id').notNull().references(() => users.id)
})

export const signatures = pgTable('signatures', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  userId: text('user_id').notNull().references(() => users.id),
  previousSignatureId: text('previous_signature_id').references((): AnyPgColumn => signatures.id),
  signatureData: bytea('signature_data').notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull()
})
```

Note: `previousSignatureId`'s self-referential foreign key requires the
`(): AnyPgColumn => signatures.id` typed-callback form — a plain arrow
function without the explicit `AnyPgColumn` return type annotation fails
to typecheck here, because TypeScript can't resolve the circular
reference (`signatures` referring to itself) without it.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors. This is the only automated check
available for this task — there's no application logic here to unit test,
just table definitions.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/db/schema.ts
git commit -m "feat: add Drizzle schema for users, documents, and signatures"
```

---

### Task 3: Drizzle config, connection module, and migration

**Files:**
- Create: `drizzle.config.ts` (repo root)
- Create: `src/infrastructure/db/connection.ts`

**Interfaces:**
- Consumes: `defineConfig` from `drizzle-kit`; `drizzle` from `drizzle-orm/node-postgres`; `Pool` from `pg`; `users`/`documents`/`signatures` from Task 2's `schema.ts`.
- Produces: `db` — the exported Drizzle client from `connection.ts`, and a real `securedoc_chain` database with all three tables created via a generated-and-applied migration. Task 4's `seed.ts` imports `db` and the schema tables.

- [ ] **Step 1: Write the Drizzle config**

Create `drizzle.config.ts` at the repo root (same level as `package.json`):

```ts
import { defineConfig } from 'drizzle-kit'

process.loadEnvFile('.env')

export default defineConfig({
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
})
```

- [ ] **Step 2: Write the connection module**

Create `src/infrastructure/db/connection.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = drizzle(pool, { schema })
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: creates a new SQL file under `drizzle/` (e.g.
`drizzle/0000_<generated-name>.sql`) containing `CREATE TABLE` statements
for `users`, `documents`, and `signatures`.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: completes with no errors — this actually creates the tables in
your local `securedoc_chain` database.

- [ ] **Step 5: Verify the tables via psql**

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "\d users"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "\d documents"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "\d signatures"
```

Expected: each command prints the table's columns, confirming `bytea`
columns (`public_key`, `original_hash`, `signature_data`), the `text`
primary/foreign keys, and (for `signatures`) the self-referential foreign
key on `previous_signature_id`.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Commit**

Migration files ARE committed (they're the source of truth for schema
history, not build output):

```bash
git add drizzle.config.ts src/infrastructure/db/connection.ts drizzle/
git commit -m "feat: add Drizzle config, connection module, and initial migration"
```

---

### Task 4: Seed script

**Files:**
- Create: `src/infrastructure/db/seed.ts`

**Interfaces:**
- Consumes: `db` from Task 3's `connection.ts`; `users` from Task 2's `schema.ts`.
- Produces: 3 rows in the real `users` table, matching `seedUsers.ts`'s in-memory data exactly (same ids, same fixed public-key bytes) — carrying forward the same manual/curl testing walkthrough once the follow-up sub-project wires in real repository adapters. Nothing later in this plan depends on this file's exports (it's a standalone script, not a module other code imports).

- [ ] **Step 1: Write the seed script**

Create `src/infrastructure/db/seed.ts`:

```ts
import { db } from './connection.js'
import { users } from './schema.js'

async function seed() {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: new Uint8Array([1, 2, 3, 4]) },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: new Uint8Array([5, 6, 7, 8]) },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: new Uint8Array([9, 10, 11, 12]) }
    ])
    .onConflictDoNothing()

  console.log('Seeded 3 test users.')
  process.exit(0)
}

seed()
```

- [ ] **Step 2: Run it**

Run: `npm run db:seed`
Expected: prints `Seeded 3 test users.` and exits cleanly.

- [ ] **Step 3: Verify via psql**

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "SELECT id, username, email FROM users;"
```

Expected: 3 rows — `user-alice`/`alice`/`alice@example.com`,
`user-bob`/`bob`/`bob@example.com`, `user-carol`/`carol`/`carol@example.com`.

- [ ] **Step 4: Re-run to confirm idempotency**

Run: `npm run db:seed` again.
Expected: still prints `Seeded 3 test users.` and exits cleanly — no
duplicate-key error, no duplicate rows (verify again with the same
`SELECT` from Step 3 if you want to double check the row count stays 3).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/db/seed.ts
git commit -m "feat: add database seed script for test users"
```

---

## Post-plan state

After Task 4, a real Postgres database (`securedoc_chain`, owned by a
dedicated `securedoc_chain_app` role) exists locally with `users`,
`documents`, and `signatures` tables matching the domain entities exactly,
migrated via `drizzle-kit`, and seeded with the same 3 test users the
in-memory `seedUsers.ts` already provides. No application code reads from
or writes to this database yet — `composition.ts` still wires the
in-memory adapters. The follow-up sub-project builds
`PostgresDocumentRepository`/`PostgresUserRepository`/
`PostgresSignatureRepository` against this exact schema and swaps them
into `composition.ts`, at which point the HTTP layer starts actually
persisting to Postgres.
