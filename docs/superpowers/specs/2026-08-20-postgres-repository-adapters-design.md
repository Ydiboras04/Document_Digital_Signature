# Postgres Repository Adapters — Design Spec

Date: 2026-08-20
Status: Approved

## Purpose

Build the second of two sub-projects needed to move SecureDoc Chain's
backend off in-memory storage and onto Postgres: concrete
`DocumentRepository`/`UserRepository`/`SignatureRepository` implementations
backed by the Drizzle schema and connection module from the prior
sub-project, wired into `composition.ts` in place of the in-memory
adapters.

## Scope Boundary

Only the three repository ports change. `FileStorage`, `IdGenerator`,
`Clock`, and `CryptoProvider` are untouched — `FileStorage` stays
in-memory (uploaded file bytes still aren't persisted anywhere real; that's
its own future sub-project), and the other three are already
real/production-appropriate as they are.

## Project Layout

```
src/
  infrastructure/
    db/
      schema.ts                    # existing, unchanged
      connection.ts                # existing, unchanged
      seed.ts                      # existing, unchanged
      testSupport.ts                # new: cleanDatabase(), ensureSeedUsers()
      PostgresDocumentRepository.ts
      PostgresDocumentRepository.test.ts
      PostgresUserRepository.ts
      PostgresUserRepository.test.ts
      PostgresSignatureRepository.ts
      PostgresSignatureRepository.test.ts
    composition.ts                  # MODIFIED: use Postgres repositories
    composition.test.ts             # MODIFIED: real-DB cleanup/seed pattern
vitest.config.ts                    # new: repo root, first vitest config
vitest.setup.ts                     # new: repo root, loads .env for tests
```

Postgres-specific infrastructure lives in `src/infrastructure/db/`,
alongside the schema/connection/seed files it depends on — distinct from
the generic `InMemory*` adapters that remain directly under
`src/infrastructure/`.

## Repository Implementations

Each maps between the domain entity's value objects and raw column values.
`Hash`/`PublicKey`/`SignatureBytes` all expose `.toBytes()` → `Uint8Array`,
which the existing `bytea` `customType` in `schema.ts` already round-trips
correctly on both write and read — no extra encoding step needed in the
repositories themselves.

**`PostgresDocumentRepository`** (`DocumentRepository`):
- `save(document)`: `db.insert(documents).values({...})`.
- `findById(id)`: `db.select().from(documents).where(eq(documents.id, id))`,
  then `Document.create({...})` from the row, unwrapping `.value` — data
  written by our own use cases has already passed validation once, so this
  reconstruction is expected to always succeed.

**`PostgresUserRepository`** (`UserRepository`):
- `findById(id)`: select + map row → `User.create({...})`. No `save()` —
  the port has never had one; users are seeded via `seed.ts`, not written
  by the application.

**`PostgresSignatureRepository`** (`SignatureRepository`):
- `findByDocumentId(documentId)`: select where `document_id = ...`, map
  each row → `Signature.create({...})`.
- `save(signature)`: insert.

## Test Infrastructure

**`vitest.config.ts`** (the project's first — currently relies entirely on
Vitest defaults): adds a `test.setupFiles: ['./vitest.setup.ts']` entry.

**`vitest.setup.ts`**: calls `process.loadEnvFile('.env')`. This is
necessary because `vitest run` doesn't load `.env` into `process.env` on
its own, and any test file that imports `connection.ts` (directly or
transitively) needs `DATABASE_URL` set before that import evaluates.
`setupFiles` run as their own module load, strictly before test files are
loaded — this sidesteps the same ES-module import-hoisting issue already
solved for `drizzle.config.ts` and the app's own npm scripts.

**`src/infrastructure/db/testSupport.ts`**:
```ts
async function cleanDatabase(): Promise<void>
// deletes from `signatures` then `documents`, in that order (respecting
// the foreign key) — never touches `users`.

async function ensureSeedUsers(): Promise<void>
// the same idempotent insert seed.ts already performs (onConflictDoNothing),
// so the 3 test users exist before any test that needs them, without
// requiring `npm run db:seed` to have been run manually first.
```

## Testing

Each `Postgres*Repository` gets its own test file hitting the real
`securedoc_chain` database directly — no mocks — calling `cleanDatabase()`
(and `ensureSeedUsers()` where relevant) in `beforeEach`. Coverage mirrors
the `InMemory*` adapters' test shape exactly: save-then-find round trips,
not-found-returns-null/empty-array cases.

`composition.test.ts` (from the in-memory sub-project) is updated to use
the same `cleanDatabase()`/`ensureSeedUsers()` pattern in its `beforeEach`,
since `createDependencies()` now constructs real Postgres repositories —
its existing upload→sign→verify round-trip assertions don't change, only
what's backing them.

**Consequence for `npm test`:** the full suite now requires a live local
Postgres connection (the same `securedoc_chain` database already set up) —
this is a real, accepted change from the fully self-contained in-memory
test suite that existed before this sub-project, per the earlier decision
not to introduce a separate test-only database.

## Out of Scope

- `FileStorage` persistence — still in-memory.
- Connection pooling tuning, retry/reconnect logic — not introduced here,
  same as the prior sub-project's scope boundary.
- The Flutter mobile app — still explicitly last per the user's stated
  build order.
