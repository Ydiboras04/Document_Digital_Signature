# Postgres Repository Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `PostgresDocumentRepository`, `PostgresUserRepository`, and `PostgresSignatureRepository`, wire them into `composition.ts` in place of the in-memory adapters, and update the test suite to run against the real local Postgres database.

**Architecture:** Three new repository classes in `src/infrastructure/db/`, backed by the existing Drizzle schema/connection. A new `vitest.config.ts` + `vitest.setup.ts` load `.env` before any test file runs. A shared `testSupport.ts` provides `cleanDatabase()`/`ensureSeedUsers()` for test isolation without a second test-only database.

**Tech Stack:** `drizzle-orm` (existing), Vitest (existing, gets its first config file). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-20-postgres-repository-adapters-design.md`

## Global Constraints

- Only `DocumentRepository`/`UserRepository`/`SignatureRepository` change — `FileStorage`, `IdGenerator`, `Clock`, `CryptoProvider` stay exactly as they are in `composition.ts`.
- `PostgresUserRepository` has no `save()` — the `UserRepository` port never has, and users are seeded via `seed.ts`/`ensureSeedUsers()`, not written by the application.
- Test cleanup (`cleanDatabase()`) only ever deletes from `signatures` then `documents` (FK order) — never `users`.
- After this plan, `npm test` requires a live local Postgres connection (the same `securedoc_chain` database already set up) — this is an accepted, deliberate change from the fully self-contained in-memory test suite.
- `Hash`/`PublicKey`/`SignatureBytes` all expose `.toBytes()` → `Uint8Array`; the existing `bytea` `customType` in `schema.ts` round-trips this correctly, so repositories pass `.toBytes()` on write and wrap the raw row value with the value object's `.create(...)` on read — no manual encoding.
- All new files use explicit `.js` extensions on relative imports, per the established convention.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source.

---

### Task 1: Vitest config and env-loading setup file

**Files:**
- Create: `vitest.config.ts` (repo root)
- Create: `vitest.setup.ts` (repo root)

**Interfaces:**
- Produces: a Vitest configuration that loads `.env` into `process.env` before any test file's imports are evaluated. Task 2's `testSupport.test.ts` is the first real proof this works — if `DATABASE_URL` isn't set by the time `connection.ts` is imported, its `Pool` fails to connect and that task's tests fail clearly, revealing a Task 1 problem.

- [ ] **Step 1: Write the setup file**

Create `vitest.setup.ts`:

```ts
/// <reference types="node" />
process.loadEnvFile('.env')
```

The `/// <reference types="node" />` directive is needed for the same reason it was needed in `drizzle.config.ts`: this file sits outside `src/`, which is the only directory `tsconfig.json`'s `"include"` covers, so the editor can't otherwise see Node's ambient `process` global for this specific file. It's cosmetic only — `npm run typecheck` and `npm run build` are scoped to `src/` and never touch this file either way.

- [ ] **Step 2: Write the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts']
  }
})
```

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: all 112 previously-passing tests still pass — this config change is additive and harmless to the fully in-memory tests that exist today.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts vitest.setup.ts
git commit -m "chore: add Vitest config to load .env before tests"
```

---

### Task 2: Test support helpers

**Files:**
- Create: `src/infrastructure/db/testSupport.ts`
- Test: `src/infrastructure/db/testSupport.test.ts`

**Interfaces:**
- Consumes: `db` from `connection.ts`; `documents`, `signatures`, `users` from `schema.ts` (all existing).
- Produces: `cleanDatabase(): Promise<void>` and `ensureSeedUsers(): Promise<void>`. Task 3's repository tests and Task 4's `composition.test.ts`/`documents.integration.test.ts` all import both.

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/db/testSupport.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { db } from './connection.js'
import { users, documents, signatures } from './schema.js'

describe('cleanDatabase and ensureSeedUsers', () => {
  beforeEach(async () => {
    await cleanDatabase()
  })

  it('cleanDatabase removes all documents and signatures', async () => {
    const remainingDocuments = await db.select().from(documents)
    const remainingSignatures = await db.select().from(signatures)

    expect(remainingDocuments).toEqual([])
    expect(remainingSignatures).toEqual([])
  })

  it('ensureSeedUsers inserts the 3 test users idempotently', async () => {
    await ensureSeedUsers()
    await ensureSeedUsers()

    const allUsers = await db.select({ id: users.id }).from(users)
    const ids = allUsers.map((u) => u.id).sort()

    expect(ids).toEqual(['user-alice', 'user-bob', 'user-carol'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- testSupport.test.ts`
Expected: FAIL — `Cannot find module './testSupport.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/infrastructure/db/testSupport.ts`:

```ts
import { db } from './connection.js'
import { documents, signatures, users } from './schema.js'

export async function cleanDatabase(): Promise<void> {
  await db.delete(signatures)
  await db.delete(documents)
}

export async function ensureSeedUsers(): Promise<void> {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: new Uint8Array([1, 2, 3, 4]) },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: new Uint8Array([5, 6, 7, 8]) },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: new Uint8Array([9, 10, 11, 12]) }
    ])
    .onConflictDoNothing()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- testSupport.test.ts`
Expected: PASS — 2 tests passed. This is the first real proof the env-loading from Task 1 works end-to-end (if `DATABASE_URL` weren't set, `db.select()`/`db.delete()` would reject and these tests would fail with a connection error, not an assertion failure).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/db/testSupport.ts src/infrastructure/db/testSupport.test.ts
git commit -m "test: add cleanDatabase and ensureSeedUsers test helpers"
```

---

### Task 3: Postgres repository implementations

**Files:**
- Create: `src/infrastructure/db/PostgresDocumentRepository.ts`
- Test: `src/infrastructure/db/PostgresDocumentRepository.test.ts`
- Create: `src/infrastructure/db/PostgresUserRepository.ts`
- Test: `src/infrastructure/db/PostgresUserRepository.test.ts`
- Create: `src/infrastructure/db/PostgresSignatureRepository.ts`
- Test: `src/infrastructure/db/PostgresSignatureRepository.test.ts`

**Interfaces:**
- Consumes: `DocumentRepository`/`UserRepository`/`SignatureRepository` ports (existing); `Document`/`User`/`Signature` entities and `Hash`/`PublicKey`/`SignatureBytes` value objects (existing); `db` and table definitions from `connection.ts`/`schema.ts`; `eq` from `drizzle-orm`; `cleanDatabase`/`ensureSeedUsers` from Task 2.
- Produces: `PostgresDocumentRepository`, `PostgresUserRepository` (no-arg constructor, unlike `InMemoryUserRepository` which took seed users — this one reads real seeded rows), `PostgresSignatureRepository` — all implementing their respective ports exactly. Task 4's `composition.ts` constructs one instance of each.

- [ ] **Step 1: Write the failing tests for PostgresDocumentRepository**

Create `src/infrastructure/db/PostgresDocumentRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PostgresDocumentRepository } from './PostgresDocumentRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { Document } from '../../domain/entities/Document.js'
import { Hash } from '../../domain/value-objects/Hash.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: 'Contract',
    filePath: 'file-key-1',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-alice'
  }).value
}

describe('PostgresDocumentRepository', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('finds a saved document by id', async () => {
    const repository = new PostgresDocumentRepository()
    const document = aDocument('doc-1')

    await repository.save(document)
    const found = await repository.findById('doc-1')

    expect(found).not.toBeNull()
    expect(found!.id).toBe('doc-1')
    expect(found!.title).toBe('Contract')
    expect(found!.filePath).toBe('file-key-1')
    expect(found!.uploaderId).toBe('user-alice')
    expect(found!.originalHash.equals(document.originalHash)).toBe(true)
  })

  it('returns null for an unknown id', async () => {
    const repository = new PostgresDocumentRepository()

    const found = await repository.findById('missing-doc')

    expect(found).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- PostgresDocumentRepository.test.ts`
Expected: FAIL — `Cannot find module './PostgresDocumentRepository.js'`.

- [ ] **Step 3: Implement PostgresDocumentRepository**

Create `src/infrastructure/db/PostgresDocumentRepository.ts`:

```ts
import { eq } from 'drizzle-orm'
import { Document } from '../../domain/entities/Document.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { DocumentRepository } from '../../use-cases/ports/DocumentRepository.js'
import { db } from './connection.js'
import { documents } from './schema.js'

export class PostgresDocumentRepository implements DocumentRepository {
  async save(document: Document): Promise<void> {
    await db.insert(documents).values({
      id: document.id,
      title: document.title,
      filePath: document.filePath,
      originalHash: document.originalHash.toBytes(),
      uploaderId: document.uploaderId
    })
  }

  async findById(id: string): Promise<Document | null> {
    const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return Document.create({
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      originalHash: Hash.create(row.originalHash).value,
      uploaderId: row.uploaderId
    }).value
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- PostgresDocumentRepository.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Write the failing tests for PostgresUserRepository**

Create `src/infrastructure/db/PostgresUserRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PostgresUserRepository } from './PostgresUserRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'

describe('PostgresUserRepository', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('finds a seeded user by id', async () => {
    const repository = new PostgresUserRepository()

    const found = await repository.findById('user-alice')

    expect(found).not.toBeNull()
    expect(found!.id).toBe('user-alice')
    expect(found!.username).toBe('alice')
    expect(found!.email).toBe('alice@example.com')
    expect(found!.publicKey.toBytes()).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('returns null for an unknown id', async () => {
    const repository = new PostgresUserRepository()

    const found = await repository.findById('missing-user')

    expect(found).toBeNull()
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- PostgresUserRepository.test.ts`
Expected: FAIL — `Cannot find module './PostgresUserRepository.js'`.

- [ ] **Step 7: Implement PostgresUserRepository**

Create `src/infrastructure/db/PostgresUserRepository.ts`:

```ts
import { eq } from 'drizzle-orm'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { UserRepository } from '../../use-cases/ports/UserRepository.js'
import { db } from './connection.js'
import { users } from './schema.js'

export class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return User.create({
      id: row.id,
      username: row.username,
      email: row.email,
      publicKey: PublicKey.create(row.publicKey).value
    }).value
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- PostgresUserRepository.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 9: Write the failing tests for PostgresSignatureRepository**

Create `src/infrastructure/db/PostgresSignatureRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PostgresSignatureRepository } from './PostgresSignatureRepository.js'
import { PostgresDocumentRepository } from './PostgresDocumentRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: 'Contract',
    filePath: 'file-key-1',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-alice'
  }).value
}

function aSignature(
  id: string,
  documentId: string,
  overrides: Partial<{ userId: string; previousSignatureId: string | null }> = {}
): Signature {
  return Signature.create({
    id,
    documentId,
    userId: overrides.userId ?? 'user-alice',
    previousSignatureId: overrides.previousSignatureId ?? null,
    signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('PostgresSignatureRepository', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('finds saved signatures by documentId', async () => {
    const documentRepository = new PostgresDocumentRepository()
    const repository = new PostgresSignatureRepository()
    const document = aDocument('doc-1')
    const otherDocument = aDocument('doc-2')
    await documentRepository.save(document)
    await documentRepository.save(otherDocument)

    const signature = aSignature('sig-1', 'doc-1')
    const otherDocSignature = aSignature('sig-2', 'doc-2')
    await repository.save(signature)
    await repository.save(otherDocSignature)

    const found = await repository.findByDocumentId('doc-1')

    expect(found).toHaveLength(1)
    expect(found[0].id).toBe('sig-1')
    expect(found[0].documentId).toBe('doc-1')
    expect(found[0].userId).toBe('user-alice')
    expect(found[0].previousSignatureId).toBeNull()
  })

  it('returns an empty array for an unknown documentId', async () => {
    const repository = new PostgresSignatureRepository()

    const found = await repository.findByDocumentId('missing-doc')

    expect(found).toEqual([])
  })
})
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npm test -- PostgresSignatureRepository.test.ts`
Expected: FAIL — `Cannot find module './PostgresSignatureRepository.js'`.

- [ ] **Step 11: Implement PostgresSignatureRepository**

Create `src/infrastructure/db/PostgresSignatureRepository.ts`:

```ts
import { eq } from 'drizzle-orm'
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { SignatureRepository } from '../../use-cases/ports/SignatureRepository.js'
import { db } from './connection.js'
import { signatures } from './schema.js'

export class PostgresSignatureRepository implements SignatureRepository {
  async findByDocumentId(documentId: string): Promise<Signature[]> {
    const rows = await db.select().from(signatures).where(eq(signatures.documentId, documentId))
    return rows.map(
      (row) =>
        Signature.create({
          id: row.id,
          documentId: row.documentId,
          userId: row.userId,
          previousSignatureId: row.previousSignatureId,
          signatureData: SignatureBytes.create(row.signatureData).value,
          signedAt: row.signedAt
        }).value
    )
  }

  async save(signature: Signature): Promise<void> {
    await db.insert(signatures).values({
      id: signature.id,
      documentId: signature.documentId,
      userId: signature.userId,
      previousSignatureId: signature.previousSignatureId,
      signatureData: signature.signatureData.toBytes(),
      signedAt: signature.signedAt
    })
  }
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npm test -- PostgresSignatureRepository.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 13: Run all three test files together, then typecheck**

Run: `npm test -- PostgresDocumentRepository.test.ts PostgresUserRepository.test.ts PostgresSignatureRepository.test.ts`
Expected: PASS — 6 tests passed total.

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 14: Commit**

```bash
git add src/infrastructure/db/PostgresDocumentRepository.ts src/infrastructure/db/PostgresDocumentRepository.test.ts src/infrastructure/db/PostgresUserRepository.ts src/infrastructure/db/PostgresUserRepository.test.ts src/infrastructure/db/PostgresSignatureRepository.ts src/infrastructure/db/PostgresSignatureRepository.test.ts
git commit -m "feat: add Postgres-backed Document, User, and Signature repositories"
```

---

### Task 4: Wire composition.ts, update existing tests, remove dead code

**Files:**
- Modify: `src/infrastructure/composition.ts`
- Modify: `src/infrastructure/composition.test.ts`
- Modify: `src/interface-adapters/http/documents.integration.test.ts`
- Delete: `src/infrastructure/seedUsers.ts`

**Interfaces:**
- Consumes: `PostgresDocumentRepository`/`PostgresUserRepository`/`PostgresSignatureRepository` (Task 3); `cleanDatabase`/`ensureSeedUsers` (Task 2).
- Produces: `createDependencies()` now returns use cases backed by real Postgres repositories. Nothing later in this plan depends on this — it's the final deliverable.

`seedUsers.ts` (the in-memory fixed-user-list file from the earlier sub-project) is deleted because after this task it has zero remaining references anywhere in the codebase — `composition.ts` was its only consumer, and `PostgresUserRepository` takes no constructor arguments (unlike `InMemoryUserRepository`, which needed the seed list injected). Confirmed via `grep -rl "seedUsers" src/` before writing this plan: only `composition.ts` and `seedUsers.ts` itself referenced it.

- [ ] **Step 1: Update composition.ts**

Replace the contents of `src/infrastructure/composition.ts` with:

```ts
import { InMemoryFileStorage } from './InMemoryFileStorage.js'
import { RandomIdGenerator } from './RandomIdGenerator.js'
import { SystemClock } from './SystemClock.js'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PostgresDocumentRepository } from './db/PostgresDocumentRepository.js'
import { PostgresUserRepository } from './db/PostgresUserRepository.js'
import { PostgresSignatureRepository } from './db/PostgresSignatureRepository.js'
import { SignatureChainService } from '../domain/services/SignatureChainService.js'
import { UploadDocumentUseCase } from '../use-cases/upload-document/UploadDocumentUseCase.js'
import { SignDocumentUseCase } from '../use-cases/sign-document/SignDocumentUseCase.js'
import { VerifyDocumentUseCase } from '../use-cases/verify-document/VerifyDocumentUseCase.js'

export interface Dependencies {
  uploadDocumentUseCase: UploadDocumentUseCase
  signDocumentUseCase: SignDocumentUseCase
  verifyDocumentUseCase: VerifyDocumentUseCase
}

export function createDependencies(): Dependencies {
  const documentRepository = new PostgresDocumentRepository()
  const userRepository = new PostgresUserRepository()
  const signatureRepository = new PostgresSignatureRepository()
  const fileStorage = new InMemoryFileStorage()
  const idGenerator = new RandomIdGenerator()
  const clock = new SystemClock()
  const crypto = new InMemoryCryptoProvider()
  const signatureChainService = new SignatureChainService(crypto)

  const uploadDocumentUseCase = new UploadDocumentUseCase(crypto, fileStorage, idGenerator, documentRepository)
  const signDocumentUseCase = new SignDocumentUseCase(
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  const verifyDocumentUseCase = new VerifyDocumentUseCase(
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )

  return { uploadDocumentUseCase, signDocumentUseCase, verifyDocumentUseCase }
}
```

- [ ] **Step 2: Delete seedUsers.ts**

```bash
rm src/infrastructure/seedUsers.ts
```

- [ ] **Step 3: Update composition.test.ts**

Replace the contents of `src/infrastructure/composition.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDependencies } from './composition.js'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { cleanDatabase, ensureSeedUsers } from './db/testSupport.js'

describe('createDependencies', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('wires a working UploadDocumentUseCase', async () => {
    const { uploadDocumentUseCase } = createDependencies()

    const result = await uploadDocumentUseCase.execute({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: new TextEncoder().encode('hello world')
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.title).toBe('Contract')
    expect(result.value.uploaderId).toBe('user-alice')
  })

  it('supports a full upload -> sign -> verify round trip through the composed dependencies', async () => {
    const { uploadDocumentUseCase, signDocumentUseCase, verifyDocumentUseCase } = createDependencies()
    const crypto = new InMemoryCryptoProvider()

    const uploadResult = await uploadDocumentUseCase.execute({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: new TextEncoder().encode('hello world')
    })
    expect(uploadResult.isOk()).toBe(true)
    const document = uploadResult.value

    const message = crypto.hash(document.originalHash.toBytes())
    const alicePublicKey = PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
    const combined = new Uint8Array(alicePublicKey.toBytes().length + message.toBytes().length)
    combined.set(alicePublicKey.toBytes(), 0)
    combined.set(message.toBytes(), alicePublicKey.toBytes().length)
    const signatureBytes = crypto.hash(combined).toBytes()

    const signResult = await signDocumentUseCase.execute({
      documentId: document.id,
      userId: 'user-alice',
      signatureBytes
    })
    expect(signResult.isOk()).toBe(true)

    const verifyResult = await verifyDocumentUseCase.execute({ documentId: document.id })
    expect(verifyResult.isOk()).toBe(true)
    expect(verifyResult.value).toHaveLength(1)
  })
})
```

The assertions are unchanged from before — only the `beforeEach` (real-DB cleanup/seed instead of relying on fresh in-memory state per module load) is new.

- [ ] **Step 4: Update documents.integration.test.ts**

`documents.integration.test.ts` signs as `user-alice` in several tests but never seeded that user itself — it previously worked only because `composition.ts`'s in-memory `InMemoryUserRepository` was constructed with the fixed seed list every time. Now that `PostgresUserRepository` reads from the real database, this file needs to guarantee `user-alice` exists itself, rather than silently depending on some other test file (or a manual `npm run db:seed` run) having done it first.

Add this import near the top of `src/interface-adapters/http/documents.integration.test.ts`, alongside the existing ones:

```ts
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
```

And add this hook at the top of the file, right after the imports and before the first `describe` block:

```ts
beforeAll(async () => {
  await ensureSeedUsers()
})
```

This requires adding `beforeAll` to the existing `import { describe, it, expect } from 'vitest'` line — change it to:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
```

This file's tests don't need `cleanDatabase()` — they never depended on document/signature isolation between runs before (they already used random UUID document ids to avoid collisions), so that behavior is unchanged.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass — total count is 120: the 112 pre-existing tests (unchanged in count — `composition.test.ts` and `documents.integration.test.ts` are modified in this task, not added to, and Task 1 added no tests, just config) plus 2 new from `testSupport.test.ts` (Task 2) plus 6 new from the three Postgres repositories (Task 3).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Manually verify with the running dev server**

Run: `npm run dev`

In a separate terminal, upload a document and confirm it's actually in Postgres now (not just in-memory):
```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Real DB Test","uploaderId":"user-alice","fileBytes":"aGVsbG8gd29ybGQ="}'
```
Expected: `201` with a serialized document, same as before.

Then check pgAdmin (`securedoc_chain → Schemas → public → Tables → documents → View/Edit Data → All Rows`, refreshing first) — the document you just uploaded via curl should be visible as a real row, with a title of "Real DB Test."

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/composition.ts src/infrastructure/composition.test.ts src/interface-adapters/http/documents.integration.test.ts
git add -u src/infrastructure/seedUsers.ts
git commit -m "feat: wire Postgres repositories into composition root"
```

(`git add -u` stages the deletion of `seedUsers.ts` — `git add` alone doesn't pick up removed files.)

---

## Post-plan state

After Task 4, SecureDoc Chain's backend genuinely persists to Postgres: uploading a document, signing it, and verifying it all read from and write to the real `securedoc_chain` database via `POST /documents`, `POST /documents/:documentId/signatures`, and `GET /documents/:documentId/verify`. `FileStorage` remains in-memory (uploaded file bytes still aren't durably stored anywhere) — that, a real `CryptoProvider` (Ed25519 or similar), and the Flutter mobile app (explicitly last) are the remaining follow-up sub-projects per the user's stated build order.
