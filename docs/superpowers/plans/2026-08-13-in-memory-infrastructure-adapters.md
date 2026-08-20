# In-Memory Infrastructure Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build concrete, in-memory implementations of all six use-case-layer ports, plus a composition root (`createDependencies()`) that wires them into ready-to-use `UploadDocumentUseCase`, `SignDocumentUseCase`, and `VerifyDocumentUseCase` instances.

**Architecture:** A new `src/infrastructure/` layer, parallel to `domain/`, `use-cases/`, and `interface-adapters/`. Seven adapter classes, one seed-data file, and one composition function. No HTTP code — that's a separate follow-up sub-project built on top of this one.

**Tech Stack:** TypeScript (existing), Vitest (existing), Node's built-in `crypto` module (`randomUUID`, `createHash`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-in-memory-infrastructure-adapters-design.md`

## Global Constraints

- No HTTP/Hono code in this plan — routes are a separate sub-project.
- `InMemoryCryptoProvider.verify()` is explicitly **not** real cryptography — a documented placeholder (`SHA256(publicKey + message)` compared to the signature). Do not implement or imply real asymmetric signature verification here.
- These are temporary production adapters, not test doubles — they get their own direct unit tests, unlike the `Fake*` classes in `domain/testing`/`use-cases/testing` which stay test-only and are not modified by this plan.
- All new files use explicit `.js` extensions on relative imports, per the established convention from prior sub-projects.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source.
- `crypto.randomUUID()` and `crypto.createHash()` come from Node's built-in `node:crypto` module — import as `import { randomUUID } from 'node:crypto'` / `import { createHash } from 'node:crypto'`.

---

### Task 1: In-memory repositories (Document, User, Signature)

**Files:**
- Create: `src/infrastructure/InMemoryDocumentRepository.ts`
- Test: `src/infrastructure/InMemoryDocumentRepository.test.ts`
- Create: `src/infrastructure/InMemoryUserRepository.ts`
- Test: `src/infrastructure/InMemoryUserRepository.test.ts`
- Create: `src/infrastructure/InMemorySignatureRepository.ts`
- Test: `src/infrastructure/InMemorySignatureRepository.test.ts`

**Interfaces:**
- Consumes: `DocumentRepository`, `UserRepository`, `SignatureRepository` ports (existing, from `src/use-cases/ports/`); `Document`, `User`, `Signature` entities (existing).
- Produces: `InMemoryDocumentRepository` (implements `DocumentRepository`), `InMemoryUserRepository` (implements `UserRepository`; constructor `(users: User[])`), `InMemorySignatureRepository` (implements `SignatureRepository`) — all with public no-extra-args behavior matching their ports exactly. Task 4's `composition.ts` constructs all three.

- [ ] **Step 1: Write the failing tests for InMemoryDocumentRepository**

Create `src/infrastructure/InMemoryDocumentRepository.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemoryDocumentRepository } from './InMemoryDocumentRepository.js'
import { Document } from '../domain/entities/Document.js'
import { Hash } from '../domain/value-objects/Hash.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

describe('InMemoryDocumentRepository', () => {
  it('finds a saved document by id', async () => {
    const repository = new InMemoryDocumentRepository()
    const document = aDocument('doc-1')

    await repository.save(document)
    const found = await repository.findById('doc-1')

    expect(found).toBe(document)
  })

  it('returns null for an unknown id', async () => {
    const repository = new InMemoryDocumentRepository()

    const found = await repository.findById('missing-doc')

    expect(found).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- InMemoryDocumentRepository.test.ts`
Expected: FAIL — `Cannot find module './InMemoryDocumentRepository.js'`.

- [ ] **Step 3: Implement InMemoryDocumentRepository**

Create `src/infrastructure/InMemoryDocumentRepository.ts`:

```ts
import { Document } from '../domain/entities/Document.js'
import { DocumentRepository } from '../use-cases/ports/DocumentRepository.js'

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents: Document[] = []

  async save(document: Document): Promise<void> {
    this.documents.push(document)
  }

  async findById(id: string): Promise<Document | null> {
    return this.documents.find((d) => d.id === id) ?? null
  }
}
```

- [ ] **Step 4: Write the failing tests for InMemoryUserRepository**

Create `src/infrastructure/InMemoryUserRepository.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemoryUserRepository } from './InMemoryUserRepository.js'
import { User } from '../domain/entities/User.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'

function aUser(id: string): User {
  return User.create({
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    publicKey: PublicKey.create(new Uint8Array([1, 2, 3])).value
  }).value
}

describe('InMemoryUserRepository', () => {
  it('finds a seeded user by id', async () => {
    const user = aUser('user-1')
    const repository = new InMemoryUserRepository([user])

    const found = await repository.findById('user-1')

    expect(found).toBe(user)
  })

  it('returns null for an unknown id', async () => {
    const repository = new InMemoryUserRepository([aUser('user-1')])

    const found = await repository.findById('missing-user')

    expect(found).toBeNull()
  })
})
```

- [ ] **Step 5: Implement InMemoryUserRepository**

Create `src/infrastructure/InMemoryUserRepository.ts`:

```ts
import { User } from '../domain/entities/User.js'
import { UserRepository } from '../use-cases/ports/UserRepository.js'

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly users: User[]) {}

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null
  }
}
```

- [ ] **Step 6: Write the failing tests for InMemorySignatureRepository**

Create `src/infrastructure/InMemorySignatureRepository.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemorySignatureRepository } from './InMemorySignatureRepository.js'
import { Signature } from '../domain/entities/Signature.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'

function aSignature(id: string, documentId: string): Signature {
  return Signature.create({
    id,
    documentId,
    userId: 'user-1',
    previousSignatureId: null,
    signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('InMemorySignatureRepository', () => {
  it('finds saved signatures by documentId', async () => {
    const repository = new InMemorySignatureRepository()
    const signature = aSignature('sig-1', 'doc-1')
    const otherDocSignature = aSignature('sig-2', 'doc-2')

    await repository.save(signature)
    await repository.save(otherDocSignature)
    const found = await repository.findByDocumentId('doc-1')

    expect(found).toEqual([signature])
  })

  it('returns an empty array for an unknown documentId', async () => {
    const repository = new InMemorySignatureRepository()

    const found = await repository.findByDocumentId('missing-doc')

    expect(found).toEqual([])
  })
})
```

- [ ] **Step 7: Implement InMemorySignatureRepository**

Create `src/infrastructure/InMemorySignatureRepository.ts`:

```ts
import { Signature } from '../domain/entities/Signature.js'
import { SignatureRepository } from '../use-cases/ports/SignatureRepository.js'

export class InMemorySignatureRepository implements SignatureRepository {
  private readonly signatures: Signature[] = []

  async findByDocumentId(documentId: string): Promise<Signature[]> {
    return this.signatures.filter((s) => s.documentId === documentId)
  }

  async save(signature: Signature): Promise<void> {
    this.signatures.push(signature)
  }
}
```

- [ ] **Step 8: Run all three test files to verify everything passes**

Run: `npm test -- InMemoryDocumentRepository.test.ts InMemoryUserRepository.test.ts InMemorySignatureRepository.test.ts`
Expected: PASS — 6 tests passed total (2 per file).

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 10: Commit**

```bash
git add src/infrastructure/InMemoryDocumentRepository.ts src/infrastructure/InMemoryDocumentRepository.test.ts src/infrastructure/InMemoryUserRepository.ts src/infrastructure/InMemoryUserRepository.test.ts src/infrastructure/InMemorySignatureRepository.ts src/infrastructure/InMemorySignatureRepository.test.ts
git commit -m "feat: add in-memory Document, User, and Signature repositories"
```

---

### Task 2: FileStorage, IdGenerator, and Clock adapters

**Files:**
- Create: `src/infrastructure/InMemoryFileStorage.ts`
- Test: `src/infrastructure/InMemoryFileStorage.test.ts`
- Create: `src/infrastructure/RandomIdGenerator.ts`
- Test: `src/infrastructure/RandomIdGenerator.test.ts`
- Create: `src/infrastructure/SystemClock.ts`
- Test: `src/infrastructure/SystemClock.test.ts`

**Interfaces:**
- Consumes: `FileStorage`, `IdGenerator`, `Clock` ports (existing).
- Produces: `InMemoryFileStorage` (implements `FileStorage`), `RandomIdGenerator` (implements `IdGenerator`), `SystemClock` (implements `Clock`). Task 4's `composition.ts` constructs all three.

- [ ] **Step 1: Write the failing tests for InMemoryFileStorage**

Create `src/infrastructure/InMemoryFileStorage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemoryFileStorage } from './InMemoryFileStorage.js'

describe('InMemoryFileStorage', () => {
  it('returns a non-empty string key when storing bytes', async () => {
    const storage = new InMemoryFileStorage()

    const key = await storage.store(new Uint8Array([1, 2, 3]))

    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('returns different keys for different store calls', async () => {
    const storage = new InMemoryFileStorage()

    const key1 = await storage.store(new Uint8Array([1, 2, 3]))
    const key2 = await storage.store(new Uint8Array([4, 5, 6]))

    expect(key1).not.toBe(key2)
  })
})
```

- [ ] **Step 2: Implement InMemoryFileStorage**

Create `src/infrastructure/InMemoryFileStorage.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { FileStorage } from '../use-cases/ports/FileStorage.js'

export class InMemoryFileStorage implements FileStorage {
  private readonly files = new Map<string, Uint8Array>()

  async store(bytes: Uint8Array): Promise<string> {
    const key = randomUUID()
    this.files.set(key, bytes)
    return key
  }
}
```

- [ ] **Step 3: Write the failing tests for RandomIdGenerator**

Create `src/infrastructure/RandomIdGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RandomIdGenerator } from './RandomIdGenerator.js'

describe('RandomIdGenerator', () => {
  it('generates a non-empty string', () => {
    const generator = new RandomIdGenerator()

    const id = generator.generate()

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('generates different values on consecutive calls', () => {
    const generator = new RandomIdGenerator()

    const first = generator.generate()
    const second = generator.generate()

    expect(first).not.toBe(second)
  })
})
```

- [ ] **Step 4: Implement RandomIdGenerator**

Create `src/infrastructure/RandomIdGenerator.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { IdGenerator } from '../use-cases/ports/IdGenerator.js'

export class RandomIdGenerator implements IdGenerator {
  generate(): string {
    return randomUUID()
  }
}
```

- [ ] **Step 5: Write the failing test for SystemClock**

Create `src/infrastructure/SystemClock.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SystemClock } from './SystemClock.js'

describe('SystemClock', () => {
  it('returns a Date close to the actual current time', () => {
    const clock = new SystemClock()
    const before = Date.now()

    const now = clock.now()

    const after = Date.now()
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(after + 1000)
  })
})
```

- [ ] **Step 6: Implement SystemClock**

Create `src/infrastructure/SystemClock.ts`:

```ts
import { Clock } from '../use-cases/ports/Clock.js'

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
```

- [ ] **Step 7: Run all three test files to verify everything passes**

Run: `npm test -- InMemoryFileStorage.test.ts RandomIdGenerator.test.ts SystemClock.test.ts`
Expected: PASS — 5 tests passed total.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/infrastructure/InMemoryFileStorage.ts src/infrastructure/InMemoryFileStorage.test.ts src/infrastructure/RandomIdGenerator.ts src/infrastructure/RandomIdGenerator.test.ts src/infrastructure/SystemClock.ts src/infrastructure/SystemClock.test.ts
git commit -m "feat: add in-memory FileStorage, RandomIdGenerator, and SystemClock"
```

---

### Task 3: InMemoryCryptoProvider

**Files:**
- Create: `src/infrastructure/InMemoryCryptoProvider.ts`
- Test: `src/infrastructure/InMemoryCryptoProvider.test.ts`

**Interfaces:**
- Consumes: `CryptoProvider` port (existing, `src/domain/ports/CryptoProvider.ts`); `Hash`, `PublicKey`, `SignatureBytes` value objects (existing).
- Produces: `InMemoryCryptoProvider` (implements `CryptoProvider`). Task 4's `composition.ts` constructs one instance; the follow-up HTTP-wiring sub-project's manual/curl testing will need to replicate its documented `verify()` algorithm to produce valid test signatures.

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/InMemoryCryptoProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'

describe('InMemoryCryptoProvider.hash', () => {
  it('matches a known SHA-256 digest', () => {
    const crypto = new InMemoryCryptoProvider()
    const data = new TextEncoder().encode('hello world')

    const result = crypto.hash(data)

    const expectedDigest = createHash('sha256').update(data).digest()
    expect(result.toBytes()).toEqual(new Uint8Array(expectedDigest))
  })
})

describe('InMemoryCryptoProvider.verify', () => {
  it('returns true for a signature computed via the documented placeholder scheme', () => {
    const crypto = new InMemoryCryptoProvider()
    const publicKey = PublicKey.create(new Uint8Array([1, 2, 3])).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))

    const combined = new Uint8Array(publicKey.toBytes().length + message.toBytes().length)
    combined.set(publicKey.toBytes(), 0)
    combined.set(message.toBytes(), publicKey.toBytes().length)
    const signature = SignatureBytes.create(crypto.hash(combined).toBytes()).value

    expect(crypto.verify(publicKey, message, signature)).toBe(true)
  })

  it('returns false for a mismatched signature', () => {
    const crypto = new InMemoryCryptoProvider()
    const publicKey = PublicKey.create(new Uint8Array([1, 2, 3])).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))
    const wrongSignature = SignatureBytes.create(new Uint8Array(32).fill(9)).value

    expect(crypto.verify(publicKey, message, wrongSignature)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- InMemoryCryptoProvider.test.ts`
Expected: FAIL — `Cannot find module './InMemoryCryptoProvider.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/infrastructure/InMemoryCryptoProvider.ts`:

```ts
import { createHash } from 'node:crypto'
import { Hash } from '../domain/value-objects/Hash.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'
import { CryptoProvider } from '../domain/ports/CryptoProvider.js'

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

// hash() is real SHA-256. verify() is NOT real cryptography -- it's a
// deterministic placeholder (SHA256(publicKey + message) compared to the
// given signature) until a real signature scheme (e.g. Ed25519) is built,
// once there's an actual mobile client producing real signatures.
export class InMemoryCryptoProvider implements CryptoProvider {
  hash(data: Uint8Array): Hash {
    const digest = createHash('sha256').update(data).digest()
    return Hash.create(new Uint8Array(digest)).value
  }

  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean {
    const combined = concatBytes(publicKey.toBytes(), message.toBytes())
    const expected = SignatureBytes.create(this.hash(combined).toBytes()).value
    return expected.equals(signature)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- InMemoryCryptoProvider.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/InMemoryCryptoProvider.ts src/infrastructure/InMemoryCryptoProvider.test.ts
git commit -m "feat: add InMemoryCryptoProvider (real SHA-256 hash, placeholder verify)"
```

---

### Task 4: Seed users and composition root

**Files:**
- Create: `src/infrastructure/seedUsers.ts`
- Create: `src/infrastructure/composition.ts`
- Test: `src/infrastructure/composition.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3, plus existing `SignatureChainService`, `UploadDocumentUseCase`, `SignDocumentUseCase`, `VerifyDocumentUseCase`, `User`, `PublicKey`.
- Produces: `seedUsers: User[]` (3 fixed users: `user-alice` with public key bytes `[1,2,3,4]`, `user-bob` with `[5,6,7,8]`, `user-carol` with `[9,10,11,12]`); `Dependencies` interface and `createDependencies(): Dependencies` where `Dependencies = { uploadDocumentUseCase: UploadDocumentUseCase; signDocumentUseCase: SignDocumentUseCase; verifyDocumentUseCase: VerifyDocumentUseCase }`. This is the final deliverable of this plan — the follow-up HTTP-wiring sub-project calls `createDependencies()` once and uses the three returned use-case instances in its route handlers.

- [ ] **Step 1: Create seedUsers**

Create `src/infrastructure/seedUsers.ts`:

```ts
import { User } from '../domain/entities/User.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'

export const seedUsers: User[] = [
  User.create({
    id: 'user-alice',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
  }).value,
  User.create({
    id: 'user-bob',
    username: 'bob',
    email: 'bob@example.com',
    publicKey: PublicKey.create(new Uint8Array([5, 6, 7, 8])).value
  }).value,
  User.create({
    id: 'user-carol',
    username: 'carol',
    email: 'carol@example.com',
    publicKey: PublicKey.create(new Uint8Array([9, 10, 11, 12])).value
  }).value
]
```

- [ ] **Step 2: Write the failing tests for the composition root**

Create `src/infrastructure/composition.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDependencies } from './composition.js'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'

describe('createDependencies', () => {
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

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- composition.test.ts`
Expected: FAIL — `Cannot find module './composition.js'`.

- [ ] **Step 4: Write the composition root**

Create `src/infrastructure/composition.ts`:

```ts
import { InMemoryDocumentRepository } from './InMemoryDocumentRepository.js'
import { InMemoryUserRepository } from './InMemoryUserRepository.js'
import { InMemorySignatureRepository } from './InMemorySignatureRepository.js'
import { InMemoryFileStorage } from './InMemoryFileStorage.js'
import { RandomIdGenerator } from './RandomIdGenerator.js'
import { SystemClock } from './SystemClock.js'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { seedUsers } from './seedUsers.js'
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
  const documentRepository = new InMemoryDocumentRepository()
  const userRepository = new InMemoryUserRepository(seedUsers)
  const signatureRepository = new InMemorySignatureRepository()
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- composition.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all previously-passing tests still pass, plus this plan's new tests — total test count increases by 16 from wherever it started (79 + 6 repositories + 5 storage/id/clock + 3 crypto + 2 composition = 95).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/seedUsers.ts src/infrastructure/composition.ts src/infrastructure/composition.test.ts
git commit -m "feat: add seed users and composition root"
```

---

## Post-plan state

After Task 4, `src/infrastructure/` contains everything needed to run the three use cases without a real database: `createDependencies()` returns fully-wired `UploadDocumentUseCase`, `SignDocumentUseCase`, and `VerifyDocumentUseCase` instances backed by in-memory storage, 3 seeded test users, real SHA-256 hashing, and a documented placeholder signature-verification scheme. `npm test` / `npm run typecheck` both pass. Nothing here is reachable over HTTP yet — that's the next sub-project (error-to-status mapping, the 3 routes, integration tests), which will call `createDependencies()` once and wire its result into route handlers.
