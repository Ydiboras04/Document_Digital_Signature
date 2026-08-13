# UploadDocument Use Case Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `UploadDocumentUseCase`, which turns raw file bytes into a persisted `Document`, plus the three new ports (`FileStorage`, `IdGenerator`, `DocumentRepository`) and their in-memory fakes for testing.

**Architecture:** A new `src/use-cases/` layer, parallel to `src/domain/` and `src/interface-adapters/`. The use case depends on the existing `CryptoProvider` domain port plus three new use-case-layer ports, all injected via constructor. No concrete adapters and no HTTP wiring — this plan produces pure, framework-free, database-free TypeScript, testable the same way the domain layer is.

**Tech Stack:** TypeScript (existing), Vitest (existing). No new dependencies.

## Global Constraints

- No concrete infrastructure (real database, real file storage, real id generation) — ports only, per spec `docs/superpowers/specs/2026-08-13-upload-document-use-case-design.md`.
- No wiring into the Hono HTTP layer (`src/interface-adapters/http/`) — explicitly out of scope.
- `execute()` returns `Result<Document, InvalidDocumentError>` — reuses the existing domain error type, does not invent a new one.
- Infrastructure ports (`FileStorage.store()`, `DocumentRepository.save()`) are `async` and are **not** wrapped in `Result` — they reject on failure like normal promises. Only `Document.create()`'s validation outcome goes through `Result`.
- All new files use explicit `.js` extensions on relative imports (e.g. `from '../../domain/entities/Document.js'`), even though the source files are `.ts`. This is required because `tsconfig.json` uses `"moduleResolution": "Bundler"`, which allows extensionless imports at the TypeScript level, but plain `node` running `tsc`'s compiled output enforces Node's native ESM resolver, which requires the extension — this exact bug was hit and fixed in the Hono-skeleton sub-project. The existing domain layer files don't have this yet (nothing runs their compiled output directly with `node` today), but all **new** files in this plan must.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source, consistent with the domain layer's convention (e.g. `UploadDocumentUseCase.ts` next to `UploadDocumentUseCase.test.ts`).

---

### Task 1: Use-case ports

**Files:**
- Create: `src/use-cases/ports/FileStorage.ts`
- Create: `src/use-cases/ports/IdGenerator.ts`
- Create: `src/use-cases/ports/DocumentRepository.ts`

**Interfaces:**
- Consumes: `Document` from `src/domain/entities/Document.ts` (existing).
- Produces: `FileStorage` (method `store(bytes: Uint8Array): Promise<string>`), `IdGenerator` (method `generate(): string`), `DocumentRepository` (method `save(document: Document): Promise<void>`) — all named interface exports. Task 2's fakes implement these; Task 3's use case depends on them.

- [ ] **Step 1: Create the FileStorage port**

Create `src/use-cases/ports/FileStorage.ts`:

```ts
export interface FileStorage {
  store(bytes: Uint8Array): Promise<string>
}
```

- [ ] **Step 2: Create the IdGenerator port**

Create `src/use-cases/ports/IdGenerator.ts`:

```ts
export interface IdGenerator {
  generate(): string
}
```

- [ ] **Step 3: Create the DocumentRepository port**

Create `src/use-cases/ports/DocumentRepository.ts`:

```ts
import { Document } from '../../domain/entities/Document.js'

export interface DocumentRepository {
  save(document: Document): Promise<void>
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/ports/FileStorage.ts src/use-cases/ports/IdGenerator.ts src/use-cases/ports/DocumentRepository.ts
git commit -m "feat: add use-case ports for file storage, id generation, and document persistence"
```

---

### Task 2: In-memory fakes for testing

**Files:**
- Create: `src/use-cases/testing/FakeFileStorage.ts`
- Create: `src/use-cases/testing/FakeIdGenerator.ts`
- Create: `src/use-cases/testing/FakeDocumentRepository.ts`

**Interfaces:**
- Consumes: `FileStorage`, `IdGenerator`, `DocumentRepository` (produced in Task 1); `Document` from `src/domain/entities/Document.ts`.
- Produces: `FakeFileStorage` (implements `FileStorage`; exposes `stored: Uint8Array[]` — every byte array passed to `store()`, in call order), `FakeIdGenerator` (implements `IdGenerator`; constructor takes an optional `prefix` string, default `'fake-id'`; `generate()` returns `` `${prefix}-${n}` `` starting at 1 and incrementing each call), `FakeDocumentRepository` (implements `DocumentRepository`; exposes `savedDocuments: Document[]` — every document passed to `save()`, in call order). Task 3's test uses all three.

- [ ] **Step 1: Create FakeFileStorage**

Create `src/use-cases/testing/FakeFileStorage.ts`:

```ts
import { FileStorage } from '../ports/FileStorage.js'

export class FakeFileStorage implements FileStorage {
  readonly stored: Uint8Array[] = []

  async store(bytes: Uint8Array): Promise<string> {
    this.stored.push(bytes)
    return `fake-storage/${this.stored.length}`
  }
}
```

- [ ] **Step 2: Create FakeIdGenerator**

Create `src/use-cases/testing/FakeIdGenerator.ts`:

```ts
import { IdGenerator } from '../ports/IdGenerator.js'

export class FakeIdGenerator implements IdGenerator {
  private counter = 0

  constructor(private readonly prefix: string = 'fake-id') {}

  generate(): string {
    this.counter += 1
    return `${this.prefix}-${this.counter}`
  }
}
```

- [ ] **Step 3: Create FakeDocumentRepository**

Create `src/use-cases/testing/FakeDocumentRepository.ts`:

```ts
import { Document } from '../../domain/entities/Document.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'

export class FakeDocumentRepository implements DocumentRepository {
  readonly savedDocuments: Document[] = []

  async save(document: Document): Promise<void> {
    this.savedDocuments.push(document)
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/testing/FakeFileStorage.ts src/use-cases/testing/FakeIdGenerator.ts src/use-cases/testing/FakeDocumentRepository.ts
git commit -m "test: add in-memory fakes for use-case ports"
```

---

### Task 3: UploadDocumentUseCase (TDD)

**Files:**
- Create: `src/use-cases/upload-document/UploadDocumentUseCase.ts`
- Test: `src/use-cases/upload-document/UploadDocumentUseCase.test.ts`

**Interfaces:**
- Consumes: `CryptoProvider` from `src/domain/ports/CryptoProvider.ts` and `FakeCryptoProvider` from `src/domain/testing/FakeCryptoProvider.ts` (both existing); `FileStorage`, `IdGenerator`, `DocumentRepository` and their fakes (Tasks 1–2); `Document` and `InvalidDocumentError` from the domain layer; `Result` from `src/domain/result/Result.ts`.
- Produces: `UploadDocumentInput` (`{ title: string; uploaderId: string; fileBytes: Uint8Array }`) and `UploadDocumentUseCase` — constructor `(crypto: CryptoProvider, fileStorage: FileStorage, idGenerator: IdGenerator, documentRepository: DocumentRepository)`, method `execute(input: UploadDocumentInput): Promise<Result<Document, InvalidDocumentError>>`. No later task in this plan depends on this — it's the final deliverable.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/upload-document/UploadDocumentUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { UploadDocumentUseCase } from './UploadDocumentUseCase.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeFileStorage } from '../testing/FakeFileStorage.js'
import { FakeIdGenerator } from '../testing/FakeIdGenerator.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'

function makeUseCase() {
  const crypto = new FakeCryptoProvider()
  const fileStorage = new FakeFileStorage()
  const idGenerator = new FakeIdGenerator()
  const documentRepository = new FakeDocumentRepository()
  const useCase = new UploadDocumentUseCase(crypto, fileStorage, idGenerator, documentRepository)
  return { useCase, crypto, fileStorage, idGenerator, documentRepository }
}

describe('UploadDocumentUseCase', () => {
  it('stores the file, hashes it, and persists a Document', async () => {
    const { useCase, crypto, fileStorage, documentRepository } = makeUseCase()
    const fileBytes = new TextEncoder().encode('hello world')

    const result = await useCase.execute({
      title: 'Contract',
      uploaderId: 'user-1',
      fileBytes
    })

    expect(result.isOk()).toBe(true)
    const document = result.value
    expect(document.title).toBe('Contract')
    expect(document.uploaderId).toBe('user-1')
    expect(document.id).toBe('fake-id-1')
    expect(document.filePath).toBe('fake-storage/1')
    expect(document.originalHash.equals(crypto.hash(fileBytes))).toBe(true)

    expect(fileStorage.stored).toEqual([fileBytes])
    expect(documentRepository.savedDocuments).toEqual([document])
  })

  it('fails validation for an empty title and does not save the document', async () => {
    const { useCase, documentRepository } = makeUseCase()

    const result = await useCase.execute({
      title: '',
      uploaderId: 'user-1',
      fileBytes: new TextEncoder().encode('hello world')
    })

    expect(result.isFail()).toBe(true)
    expect(result.error.message).toBe('Invalid Document: title must not be empty')
    expect(documentRepository.savedDocuments).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- UploadDocumentUseCase.test.ts`
Expected: FAIL — `Cannot find module './UploadDocumentUseCase.js'`, since the use case doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/upload-document/UploadDocumentUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { Document } from '../../domain/entities/Document.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { CryptoProvider } from '../../domain/ports/CryptoProvider.js'
import { FileStorage } from '../ports/FileStorage.js'
import { IdGenerator } from '../ports/IdGenerator.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'

export interface UploadDocumentInput {
  title: string
  uploaderId: string
  fileBytes: Uint8Array
}

export class UploadDocumentUseCase {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly fileStorage: FileStorage,
    private readonly idGenerator: IdGenerator,
    private readonly documentRepository: DocumentRepository
  ) {}

  async execute(input: UploadDocumentInput): Promise<Result<Document, InvalidDocumentError>> {
    const originalHash = this.crypto.hash(input.fileBytes)
    const filePath = await this.fileStorage.store(input.fileBytes)
    const id = this.idGenerator.generate()

    const documentResult = Document.create({
      id,
      title: input.title,
      filePath,
      originalHash,
      uploaderId: input.uploaderId
    })

    if (documentResult.isFail()) {
      return Result.fail(documentResult.error)
    }

    await this.documentRepository.save(documentResult.value)

    return Result.ok(documentResult.value)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- UploadDocumentUseCase.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all previously-passing tests still pass, plus the 2 new tests — total test count increases by 2 (52 → 54).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/use-cases/upload-document/UploadDocumentUseCase.ts src/use-cases/upload-document/UploadDocumentUseCase.test.ts
git commit -m "feat: add UploadDocumentUseCase"
```

---

## Post-plan state

After Task 3, `UploadDocumentUseCase` exists, is fully unit-tested with fakes (no real I/O), and `npm test` / `npm run typecheck` both pass. It is not yet reachable from any HTTP route and no concrete `FileStorage`/`IdGenerator`/`DocumentRepository` adapter exists — both are follow-up sub-projects, along with `SignDocumentUseCase` and `VerifyChainUseCase`.
