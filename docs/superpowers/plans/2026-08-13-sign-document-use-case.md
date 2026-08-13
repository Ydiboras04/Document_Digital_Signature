# SignDocumentUseCase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `SignDocumentUseCase`, which verifies and persists a new signature on an existing document's chain, plus everything it depends on: a domain-layer `findTip()` addition, three new domain errors, three new use-case ports, an extension to the existing `DocumentRepository` port, and fakes for all of it.

**Architecture:** `SignDocumentUseCase` orchestrates two repository lookups, the existing `SignatureChainService` (extended with one new method), the existing `CryptoProvider`, and a new `SignatureRepository` port, following the same Result-based, no-throw pattern as `UploadDocumentUseCase`.

**Tech Stack:** TypeScript (existing), Vitest (existing). No new dependencies.

## Global Constraints

- No concrete infrastructure (real database, real clock) — ports only, per spec `docs/superpowers/specs/2026-08-13-sign-document-use-case-design.md`.
- No wiring into the Hono HTTP layer — explicitly out of scope.
- `execute()` returns `Result<Signature, SignDocumentError>` where `SignDocumentError` is a union of existing and new domain errors — never a generic wrapper type.
- `Result` covers domain/business outcomes only; repository/port I/O failures reject their promise uncaught, same convention as Upload.
- All new files use explicit `.js` extensions on relative imports (e.g. `from '../../domain/entities/Document.js'`), per the lesson from the Hono-skeleton sub-project — `tsconfig.json`'s `"moduleResolution": "Bundler"` allows extensionless imports at the TypeScript level, but plain `node` running `tsc`'s compiled output requires the extension. This applies even to new files inside the existing `src/domain/` tree, even though sibling pre-existing files there don't have it yet.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source, consistent with the existing convention.
- Every task must leave `npm run typecheck` passing — when a task modifies an existing interface (`DocumentRepository`), it must update that interface's existing implementer (`FakeDocumentRepository`) in the same task, not a later one, so the codebase never sits in a broken intermediate state between commits.

---

### Task 1: `SignatureChainService.findTip()` (TDD)

**Files:**
- Modify: `src/domain/services/SignatureChainService.ts`
- Modify: `src/domain/services/SignatureChainService.test.ts`

**Interfaces:**
- Consumes: `Signature` (existing).
- Produces: `SignatureChainService.findTip(signatures: Signature[]): Signature | null` — a new public method on the existing class. Task 6's `SignDocumentUseCase` calls this.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/domain/services/SignatureChainService.test.ts` (after the existing `describe('SignatureChainService.verifyChain', ...)` block, same file, same existing `aSignature` helper already defined near the top of the file):

```ts
describe('SignatureChainService.findTip', () => {
  it('returns null for an empty list', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    expect(service.findTip([])).toBeNull()
  })

  it('returns the only signature when there is exactly one', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const only = aSignature({ id: 'sig-1', previousSignatureId: null })
    expect(service.findTip([only])).toBe(only)
  })

  it('returns the signature that nothing else points to, regardless of array order', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const first = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const second = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const third = aSignature({ id: 'sig-3', userId: 'user-3', previousSignatureId: 'sig-2' })

    expect(service.findTip([third, first, second])).toBe(third)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SignatureChainService.test.ts`
Expected: FAIL — `service.findTip is not a function`.

- [ ] **Step 3: Implement findTip**

In `src/domain/services/SignatureChainService.ts`, add this method to the `SignatureChainService` class, after `verifyChain` and before the closing `}` of the class:

```ts
  findTip(signatures: Signature[]): Signature | null {
    if (signatures.length === 0) {
      return null
    }
    const referencedIds = new Set(
      signatures
        .map((s) => s.previousSignatureId)
        .filter((id): id is string => id !== null)
    )
    return signatures.find((s) => !referencedIds.has(s.id)) ?? null
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- SignatureChainService.test.ts`
Expected: PASS — all tests in the file pass, 3 more than before.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/services/SignatureChainService.ts src/domain/services/SignatureChainService.test.ts
git commit -m "feat: add SignatureChainService.findTip()"
```

---

### Task 2: New domain errors

**Files:**
- Create: `src/domain/errors/DocumentNotFoundError.ts`
- Create: `src/domain/errors/UserNotFoundError.ts`
- Create: `src/domain/errors/SignatureVerificationFailedError.ts`
- Modify: `src/domain/errors/DomainError.test.ts`

**Interfaces:**
- Consumes: `DomainError` (existing base class).
- Produces: `DocumentNotFoundError` (constructor `(documentId: string)`), `UserNotFoundError` (constructor `(userId: string)`), `SignatureVerificationFailedError` (constructor `(userId: string, documentId: string)`) — all extend `DomainError`. Task 6's `SignDocumentUseCase` constructs all three.

- [ ] **Step 1: Create DocumentNotFoundError**

Create `src/domain/errors/DocumentNotFoundError.ts`:

```ts
import { DomainError } from './DomainError.js'

export class DocumentNotFoundError extends DomainError {
  constructor(documentId: string) {
    super(`Document ${documentId} was not found`)
  }
}
```

- [ ] **Step 2: Create UserNotFoundError**

Create `src/domain/errors/UserNotFoundError.ts`:

```ts
import { DomainError } from './DomainError.js'

export class UserNotFoundError extends DomainError {
  constructor(userId: string) {
    super(`User ${userId} was not found`)
  }
}
```

- [ ] **Step 3: Create SignatureVerificationFailedError**

Create `src/domain/errors/SignatureVerificationFailedError.ts`:

```ts
import { DomainError } from './DomainError.js'

export class SignatureVerificationFailedError extends DomainError {
  constructor(userId: string, documentId: string) {
    super(`Signature verification failed for user ${userId} on document ${documentId}`)
  }
}
```

- [ ] **Step 4: Add tests for the three new errors**

Add these imports to the top of `src/domain/errors/DomainError.test.ts`, alongside the existing ones:

```ts
import { DocumentNotFoundError } from './DocumentNotFoundError'
import { UserNotFoundError } from './UserNotFoundError'
import { SignatureVerificationFailedError } from './SignatureVerificationFailedError'
```

Add these `it` blocks inside the existing `describe('DomainError subclasses', ...)` block, after the existing `BrokenChainError` test:

```ts
  it('DocumentNotFoundError carries the missing documentId', () => {
    const error = new DocumentNotFoundError('doc-123')
    expect(error.name).toBe('DocumentNotFoundError')
    expect(error.message).toContain('doc-123')
  })

  it('UserNotFoundError carries the missing userId', () => {
    const error = new UserNotFoundError('user-456')
    expect(error.name).toBe('UserNotFoundError')
    expect(error.message).toContain('user-456')
  })

  it('SignatureVerificationFailedError carries the userId and documentId', () => {
    const error = new SignatureVerificationFailedError('user-456', 'doc-123')
    expect(error.name).toBe('SignatureVerificationFailedError')
    expect(error.message).toContain('user-456')
    expect(error.message).toContain('doc-123')
  })
```

- [ ] **Step 5: Run tests**

Run: `npm test -- DomainError.test.ts`
Expected: PASS — all tests pass, 3 more than before.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/domain/errors/DocumentNotFoundError.ts src/domain/errors/UserNotFoundError.ts src/domain/errors/SignatureVerificationFailedError.ts src/domain/errors/DomainError.test.ts
git commit -m "feat: add DocumentNotFoundError, UserNotFoundError, SignatureVerificationFailedError"
```

---

### Task 3: New use-case ports

**Files:**
- Create: `src/use-cases/ports/UserRepository.ts`
- Create: `src/use-cases/ports/SignatureRepository.ts`
- Create: `src/use-cases/ports/Clock.ts`

**Interfaces:**
- Consumes: `User`, `Signature` from `src/domain/entities/`.
- Produces: `UserRepository` (method `findById(id: string): Promise<User | null>`), `SignatureRepository` (methods `findByDocumentId(documentId: string): Promise<Signature[]>` and `save(signature: Signature): Promise<void>`), `Clock` (method `now(): Date`). Task 4's fakes implement these; Task 6's use case depends on them.

- [ ] **Step 1: Create the UserRepository port**

Create `src/use-cases/ports/UserRepository.ts`:

```ts
import { User } from '../../domain/entities/User.js'

export interface UserRepository {
  findById(id: string): Promise<User | null>
}
```

- [ ] **Step 2: Create the SignatureRepository port**

Create `src/use-cases/ports/SignatureRepository.ts`:

```ts
import { Signature } from '../../domain/entities/Signature.js'

export interface SignatureRepository {
  findByDocumentId(documentId: string): Promise<Signature[]>
  save(signature: Signature): Promise<void>
}
```

- [ ] **Step 3: Create the Clock port**

Create `src/use-cases/ports/Clock.ts`:

```ts
export interface Clock {
  now(): Date
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/ports/UserRepository.ts src/use-cases/ports/SignatureRepository.ts src/use-cases/ports/Clock.ts
git commit -m "feat: add UserRepository, SignatureRepository, and Clock ports"
```

---

### Task 4: New fakes

**Files:**
- Create: `src/use-cases/testing/FakeUserRepository.ts`
- Create: `src/use-cases/testing/FakeSignatureRepository.ts`
- Create: `src/use-cases/testing/FakeClock.ts`

**Interfaces:**
- Consumes: `UserRepository`, `SignatureRepository`, `Clock` (Task 3); `User`, `Signature` from the domain layer.
- Produces: `FakeUserRepository` (implements `UserRepository`; exposes public mutable `users: User[]` array that tests push fixtures into directly — `findById` searches it), `FakeSignatureRepository` (implements `SignatureRepository`; exposes public mutable `savedSignatures: Signature[]` array used both to seed prior signatures in tests and to capture newly saved ones — `findByDocumentId` filters it, `save` pushes to it), `FakeClock` (implements `Clock`; constructor takes an optional `fixedTime: Date`, defaulting to `2026-08-13T00:00:00Z`; `now()` returns a copy of it). Task 6's test uses all three.

- [ ] **Step 1: Create FakeUserRepository**

Create `src/use-cases/testing/FakeUserRepository.ts`:

```ts
import { User } from '../../domain/entities/User.js'
import { UserRepository } from '../ports/UserRepository.js'

export class FakeUserRepository implements UserRepository {
  readonly users: User[] = []

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null
  }
}
```

- [ ] **Step 2: Create FakeSignatureRepository**

Create `src/use-cases/testing/FakeSignatureRepository.ts`:

```ts
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export class FakeSignatureRepository implements SignatureRepository {
  readonly savedSignatures: Signature[] = []

  async findByDocumentId(documentId: string): Promise<Signature[]> {
    return this.savedSignatures.filter((s) => s.documentId === documentId)
  }

  async save(signature: Signature): Promise<void> {
    this.savedSignatures.push(signature)
  }
}
```

- [ ] **Step 3: Create FakeClock**

Create `src/use-cases/testing/FakeClock.ts`:

```ts
import { Clock } from '../ports/Clock.js'

export class FakeClock implements Clock {
  constructor(private readonly fixedTime: Date = new Date('2026-08-13T00:00:00Z')) {}

  now(): Date {
    return new Date(this.fixedTime.getTime())
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/testing/FakeUserRepository.ts src/use-cases/testing/FakeSignatureRepository.ts src/use-cases/testing/FakeClock.ts
git commit -m "test: add fakes for UserRepository, SignatureRepository, and Clock"
```

---

### Task 5: Extend DocumentRepository with findById

**Files:**
- Modify: `src/use-cases/ports/DocumentRepository.ts`
- Modify: `src/use-cases/testing/FakeDocumentRepository.ts`

**Interfaces:**
- Consumes: `Document` (existing).
- Produces: `DocumentRepository` gains `findById(id: string): Promise<Document | null>` alongside its existing `save()`. `FakeDocumentRepository.findById()` searches its existing `savedDocuments` array (populated by `save()`, including by `UploadDocumentUseCase.test.ts`'s existing usage) — no new field needed. Task 6's use case and test depend on this.

This task modifies both the interface and its only existing implementer together, so `npm run typecheck` stays green the whole time — `UploadDocumentUseCase.test.ts` constructs `FakeDocumentRepository` directly and would fail to compile if the fake didn't implement every port method.

- [ ] **Step 1: Add findById to the port**

In `src/use-cases/ports/DocumentRepository.ts`, add the new method to the interface:

```ts
import { Document } from '../../domain/entities/Document.js'

export interface DocumentRepository {
  save(document: Document): Promise<void>
  findById(id: string): Promise<Document | null>
}
```

- [ ] **Step 2: Implement findById on the fake**

In `src/use-cases/testing/FakeDocumentRepository.ts`, add the method to the class:

```ts
import { Document } from '../../domain/entities/Document.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'

export class FakeDocumentRepository implements DocumentRepository {
  readonly savedDocuments: Document[] = []

  async save(document: Document): Promise<void> {
    this.savedDocuments.push(document)
  }

  async findById(id: string): Promise<Document | null> {
    return this.savedDocuments.find((d) => d.id === id) ?? null
  }
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass — `UploadDocumentUseCase.test.ts` is unaffected since it only calls `save()`, and `findById` is additive.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/ports/DocumentRepository.ts src/use-cases/testing/FakeDocumentRepository.ts
git commit -m "feat: add findById to DocumentRepository"
```

---

### Task 6: SignDocumentUseCase (TDD)

**Files:**
- Create: `src/use-cases/sign-document/SignDocumentUseCase.ts`
- Test: `src/use-cases/sign-document/SignDocumentUseCase.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5, plus existing `CryptoProvider`/`FakeCryptoProvider`, `Document`, `User`, `Signature`, `Hash`, `PublicKey`, `SignatureBytes`, `Result`, `InvalidValueError`, `InvalidSignatureError`, `DuplicateSignatureError`, and the Task 3/4 `IdGenerator`/`FakeIdGenerator` (from the Upload sub-project).
- Produces: `SignDocumentInput` (`{ documentId: string; userId: string; signatureBytes: Uint8Array }`), `SignDocumentError` (union type), and `SignDocumentUseCase` — constructor `(crypto: CryptoProvider, idGenerator: IdGenerator, clock: Clock, documentRepository: DocumentRepository, userRepository: UserRepository, signatureRepository: SignatureRepository, signatureChainService: SignatureChainService)`, method `execute(input: SignDocumentInput): Promise<Result<Signature, SignDocumentError>>`. Final deliverable of this plan.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/sign-document/SignDocumentUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SignDocumentUseCase } from './SignDocumentUseCase.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeIdGenerator } from '../testing/FakeIdGenerator.js'
import { FakeClock } from '../testing/FakeClock.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { User } from '../../domain/entities/User.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function aUser(overrides: Partial<{ id: string; publicKey: PublicKey }> = {}): User {
  return User.create({
    id: overrides.id ?? 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: overrides.publicKey ?? PublicKey.create(new Uint8Array([1, 2, 3])).value
  }).value
}

function setup() {
  const crypto = new FakeCryptoProvider()
  const idGenerator = new FakeIdGenerator()
  const clock = new FakeClock()
  const documentRepository = new FakeDocumentRepository()
  const userRepository = new FakeUserRepository()
  const signatureRepository = new FakeSignatureRepository()
  const signatureChainService = new SignatureChainService(crypto)
  const useCase = new SignDocumentUseCase(
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  return {
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService,
    useCase
  }
}

describe('SignDocumentUseCase', () => {
  it('signs successfully as the first signer', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const message = crypto.hash(document.originalHash.toBytes())
    const signatureBytes = crypto.sign(user.publicKey, message).toBytes()

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes
    })

    expect(result.isOk()).toBe(true)
    const signature = result.value
    expect(signature.previousSignatureId).toBeNull()
    expect(signature.documentId).toBe(document.id)
    expect(signature.userId).toBe(user.id)
    expect(signatureRepository.savedSignatures).toEqual([signature])
  })

  it('signs successfully as a subsequent signer, chaining onto the tip', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const firstUser = aUser({ id: 'user-1', publicKey: PublicKey.create(new Uint8Array([1, 2, 3])).value })
    const secondUser = aUser({ id: 'user-2', publicKey: PublicKey.create(new Uint8Array([4, 5, 6])).value })
    await documentRepository.save(document)
    userRepository.users.push(firstUser, secondUser)

    const firstMessage = crypto.hash(document.originalHash.toBytes())
    const firstSignatureData = crypto.sign(firstUser.publicKey, firstMessage)
    const firstSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: firstUser.id,
      previousSignatureId: null,
      signatureData: firstSignatureData,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(firstSignature)

    const combined = new Uint8Array(document.originalHash.toBytes().length + firstSignatureData.toBytes().length)
    combined.set(document.originalHash.toBytes(), 0)
    combined.set(firstSignatureData.toBytes(), document.originalHash.toBytes().length)
    const secondMessage = crypto.hash(combined)
    const secondSignatureBytes = crypto.sign(secondUser.publicKey, secondMessage).toBytes()

    const result = await useCase.execute({
      documentId: document.id,
      userId: secondUser.id,
      signatureBytes: secondSignatureBytes
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.previousSignatureId).toBe(firstSignature.id)
  })

  it('rejects a user who has already signed', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const message = crypto.hash(document.originalHash.toBytes())
    const existingSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user.id,
      previousSignatureId: null,
      signatureData: crypto.sign(user.publicKey, message),
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(existingSignature)

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes: new Uint8Array([9, 9, 9])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DuplicateSignatureError)
  })

  it('fails when the document does not exist', async () => {
    const { userRepository, useCase } = setup()
    userRepository.users.push(aUser())

    const result = await useCase.execute({
      documentId: 'missing-doc',
      userId: 'user-1',
      signatureBytes: new Uint8Array([1, 2, 3])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DocumentNotFoundError)
  })

  it('fails when the user does not exist', async () => {
    const { documentRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const result = await useCase.execute({
      documentId: document.id,
      userId: 'missing-user',
      signatureBytes: new Uint8Array([1, 2, 3])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('fails when signatureBytes is empty', async () => {
    const { documentRepository, userRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes: new Uint8Array(0)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidValueError)
  })

  it('fails when the signature does not verify against the payload', async () => {
    const { documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes: new Uint8Array([9, 9, 9, 9])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(SignatureVerificationFailedError)
    expect(signatureRepository.savedSignatures).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SignDocumentUseCase.test.ts`
Expected: FAIL — `Cannot find module './SignDocumentUseCase.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/sign-document/SignDocumentUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'
import { CryptoProvider } from '../../domain/ports/CryptoProvider.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { IdGenerator } from '../ports/IdGenerator.js'
import { Clock } from '../ports/Clock.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { UserRepository } from '../ports/UserRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface SignDocumentInput {
  documentId: string
  userId: string
  signatureBytes: Uint8Array
}

export type SignDocumentError =
  | DocumentNotFoundError
  | UserNotFoundError
  | DuplicateSignatureError
  | InvalidValueError
  | SignatureVerificationFailedError
  | InvalidSignatureError

export class SignDocumentUseCase {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly documentRepository: DocumentRepository,
    private readonly userRepository: UserRepository,
    private readonly signatureRepository: SignatureRepository,
    private readonly signatureChainService: SignatureChainService
  ) {}

  async execute(input: SignDocumentInput): Promise<Result<Signature, SignDocumentError>> {
    const document = await this.documentRepository.findById(input.documentId)
    if (document === null) {
      return Result.fail(new DocumentNotFoundError(input.documentId))
    }

    const user = await this.userRepository.findById(input.userId)
    if (user === null) {
      return Result.fail(new UserNotFoundError(input.userId))
    }

    const existingSignatures = await this.signatureRepository.findByDocumentId(input.documentId)

    const canSignResult = this.signatureChainService.assertCanSign(document, existingSignatures, input.userId)
    if (canSignResult.isFail()) {
      return Result.fail(canSignResult.error)
    }

    const previousSignature = this.signatureChainService.findTip(existingSignatures)

    const signatureBytesResult = SignatureBytes.create(input.signatureBytes)
    if (signatureBytesResult.isFail()) {
      return Result.fail(signatureBytesResult.error)
    }

    const message = this.signatureChainService.buildSigningPayload(document, previousSignature)
    const isValid = this.crypto.verify(user.publicKey, message, signatureBytesResult.value)
    if (!isValid) {
      return Result.fail(new SignatureVerificationFailedError(input.userId, input.documentId))
    }

    const signatureResult = Signature.create({
      id: this.idGenerator.generate(),
      documentId: document.id,
      userId: user.id,
      previousSignatureId: previousSignature?.id ?? null,
      signatureData: signatureBytesResult.value,
      signedAt: this.clock.now()
    })
    if (signatureResult.isFail()) {
      return Result.fail(signatureResult.error)
    }

    await this.signatureRepository.save(signatureResult.value)

    return Result.ok(signatureResult.value)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- SignDocumentUseCase.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all previously-passing tests still pass, plus the 7 new tests — total test count increases by 7 from wherever Task 5 left it (54 + 3 findTip tests + 3 error tests + 7 = 67).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/use-cases/sign-document/SignDocumentUseCase.ts src/use-cases/sign-document/SignDocumentUseCase.test.ts
git commit -m "feat: add SignDocumentUseCase"
```

---

## Post-plan state

After Task 6, `SignDocumentUseCase` exists, is fully unit-tested with fakes (no real I/O), and `npm test` / `npm run typecheck` both pass. `SignatureChainService` has a new `findTip()` method usable by the future `VerifyDocumentUseCase`. Signing is not yet reachable from any HTTP route, and no concrete adapter exists for any of the six ports now defined across the use-case layer (`FileStorage`, `IdGenerator`, `DocumentRepository`, `UserRepository`, `SignatureRepository`, `Clock`) — those remain follow-up sub-projects, along with `VerifyDocumentUseCase`.
