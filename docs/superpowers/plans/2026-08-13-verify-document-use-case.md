# VerifyDocumentUseCase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `VerifyDocumentUseCase`, which reconstructs a document's signature chain in causal order and cryptographically verifies every link, plus the domain-layer `SignatureChainService.orderChain()` method it depends on.

**Architecture:** `VerifyDocumentUseCase` orchestrates a document lookup, a signature-chain reconstruction (new domain logic), per-signer public-key lookups, and the existing `SignatureChainService.verifyChain()`. No new ports, no new fakes — `DocumentRepository`, `SignatureRepository`, and `UserRepository` (all already built) cover everything this use case reads.

**Tech Stack:** TypeScript (existing), Vitest (existing). No new dependencies.

## Global Constraints

- No concrete infrastructure and no HTTP wiring — per spec `docs/superpowers/specs/2026-08-13-verify-document-use-case-design.md`.
- `execute()` returns `Result<Signature[], VerifyDocumentError>` where `VerifyDocumentError = DocumentNotFoundError | UserNotFoundError | BrokenChainError` — entirely reused domain errors, no new error class.
- `orderChain()` must fail (never silently drop) on: missing head, multiple heads, a cycle, or an unreachable/orphaned signature. This is a correctness requirement, not a nice-to-have — the whole point of Verify is that "verified" can be trusted.
- All new files use explicit `.js` extensions on relative imports, per the established convention from the Hono-skeleton and Sign sub-projects.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source.

---

### Task 1: `SignatureChainService.orderChain()` (TDD)

**Files:**
- Modify: `src/domain/services/SignatureChainService.ts`
- Modify: `src/domain/services/SignatureChainService.test.ts`

**Interfaces:**
- Consumes: `Signature`, `BrokenChainError`, `Result` (all existing).
- Produces: `SignatureChainService.orderChain(signatures: Signature[]): Result<Signature[], BrokenChainError>` — a new public method on the existing class. Task 2's `VerifyDocumentUseCase` calls this.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/domain/services/SignatureChainService.test.ts` (after the existing `describe('SignatureChainService.findTip', ...)` block, reusing the existing `aSignature` helper and the `BrokenChainError` import already in the file):

```ts
describe('SignatureChainService.orderChain', () => {
  it('returns an empty array for an empty list', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.orderChain([])
    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([])
  })

  it('returns a single signature as-is', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const only = aSignature({ id: 'sig-1', previousSignatureId: null })
    const result = service.orderChain([only])
    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([only])
  })

  it('reconstructs order from a shuffled input', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const first = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const second = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const third = aSignature({ id: 'sig-3', userId: 'user-3', previousSignatureId: 'sig-2' })

    const result = service.orderChain([third, first, second])

    expect(result.isOk()).toBe(true)
    expect(result.value.map((s) => s.id)).toEqual(['sig-1', 'sig-2', 'sig-3'])
  })

  it('fails when no signature has a null previousSignatureId', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const a = aSignature({ id: 'sig-1', previousSignatureId: 'sig-does-not-exist' })

    const result = service.orderChain([a])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })

  it('fails when more than one signature has a null previousSignatureId', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const a = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const b = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: null })

    const result = service.orderChain([a, b])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })

  it('fails when a signature is unreachable from the head', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const first = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const second = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const orphan = aSignature({ id: 'sig-3', userId: 'user-3', previousSignatureId: 'sig-does-not-exist' })

    const result = service.orderChain([first, second, orphan])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
    expect(result.error.message).toContain('sig-3')
  })

  it('fails when a cycle is detected', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const head = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const middle = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const duplicateOfHead = aSignature({ id: 'sig-1', userId: 'user-3', previousSignatureId: 'sig-2' })

    const result = service.orderChain([head, middle, duplicateOfHead])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })
})
```

Note on the last test: it constructs two distinct `Signature` objects that share the same `id` ('sig-1') — representing a data-integrity problem (e.g. a repository bug returning a duplicate row). This is the realistic way a cycle can occur despite the "exactly one head" and "each previousSignatureId claimed by only one signature" invariants, which otherwise make a pure logical cycle structurally impossible.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SignatureChainService.test.ts`
Expected: FAIL — `service.orderChain is not a function`.

- [ ] **Step 3: Implement orderChain**

In `src/domain/services/SignatureChainService.ts`, add this method to the `SignatureChainService` class, after `findTip` and before the closing `}` of the class:

```ts
  orderChain(signatures: Signature[]): Result<Signature[], BrokenChainError> {
    if (signatures.length === 0) {
      return Result.ok([])
    }

    const heads = signatures.filter((s) => s.previousSignatureId === null)
    if (heads.length === 0) {
      return Result.fail(
        new BrokenChainError(signatures[0].id, 'no signature found with previousSignatureId null (missing chain head)')
      )
    }
    if (heads.length > 1) {
      return Result.fail(
        new BrokenChainError(heads[1].id, 'multiple signatures found with previousSignatureId null (ambiguous chain head)')
      )
    }

    const nextById = new Map<string, Signature>()
    for (const s of signatures) {
      if (s.previousSignatureId !== null) {
        if (nextById.has(s.previousSignatureId)) {
          return Result.fail(
            new BrokenChainError(s.id, `multiple signatures reference previousSignatureId ${s.previousSignatureId}`)
          )
        }
        nextById.set(s.previousSignatureId, s)
      }
    }

    const ordered: Signature[] = []
    const visited = new Set<string>()
    let current: Signature | undefined = heads[0]
    while (current !== undefined) {
      if (visited.has(current.id)) {
        return Result.fail(new BrokenChainError(current.id, 'cycle detected in signature chain'))
      }
      visited.add(current.id)
      ordered.push(current)
      current = nextById.get(current.id)
    }

    if (ordered.length !== signatures.length) {
      const orphan = signatures.find((s) => !visited.has(s.id))
      return Result.fail(new BrokenChainError(orphan!.id, 'signature is not reachable from the chain head'))
    }

    return Result.ok(ordered)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- SignatureChainService.test.ts`
Expected: PASS — all tests pass, 7 more than before.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/services/SignatureChainService.ts src/domain/services/SignatureChainService.test.ts
git commit -m "feat: add SignatureChainService.orderChain()"
```

---

### Task 2: VerifyDocumentUseCase (TDD)

**Files:**
- Create: `src/use-cases/verify-document/VerifyDocumentUseCase.ts`
- Test: `src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`

**Interfaces:**
- Consumes: `DocumentRepository`, `UserRepository`, `SignatureRepository`, `SignatureChainService` (including the new `orderChain()` from Task 1), plus existing `Document`, `User`, `Signature`, `Hash`, `PublicKey`, `SignatureBytes`, `Result`, `DocumentNotFoundError`, `UserNotFoundError`, `BrokenChainError`, `FakeCryptoProvider`, `FakeDocumentRepository`, `FakeUserRepository`, `FakeSignatureRepository`.
- Produces: `VerifyDocumentInput` (`{ documentId: string }`), `VerifyDocumentError` (union type), and `VerifyDocumentUseCase` — constructor `(documentRepository: DocumentRepository, userRepository: UserRepository, signatureRepository: SignatureRepository, signatureChainService: SignatureChainService)`, method `execute(input: VerifyDocumentInput): Promise<Result<Signature[], VerifyDocumentError>>`. Final deliverable of this plan.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { VerifyDocumentUseCase } from './VerifyDocumentUseCase.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { User } from '../../domain/entities/User.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { BrokenChainError } from '../../domain/errors/BrokenChainError.js'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function aUser(id: string, publicKeyByte: number): User {
  return User.create({
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    publicKey: PublicKey.create(new Uint8Array([publicKeyByte])).value
  }).value
}

function setup() {
  const crypto = new FakeCryptoProvider()
  const documentRepository = new FakeDocumentRepository()
  const userRepository = new FakeUserRepository()
  const signatureRepository = new FakeSignatureRepository()
  const signatureChainService = new SignatureChainService(crypto)
  const useCase = new VerifyDocumentUseCase(
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  return { crypto, documentRepository, userRepository, signatureRepository, signatureChainService, useCase }
}

describe('VerifyDocumentUseCase', () => {
  it('verifies a valid multi-signer chain and returns it in order', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const user1 = aUser('user-1', 1)
    const user2 = aUser('user-2', 2)
    userRepository.users.push(user1, user2)

    const message1 = crypto.hash(document.originalHash.toBytes())
    const sig1Data = crypto.sign(user1.publicKey, message1)
    const sig1 = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user1.id,
      previousSignatureId: null,
      signatureData: sig1Data,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value

    const combined = new Uint8Array(document.originalHash.toBytes().length + sig1Data.toBytes().length)
    combined.set(document.originalHash.toBytes(), 0)
    combined.set(sig1Data.toBytes(), document.originalHash.toBytes().length)
    const message2 = crypto.hash(combined)
    const sig2Data = crypto.sign(user2.publicKey, message2)
    const sig2 = Signature.create({
      id: 'sig-2',
      documentId: document.id,
      userId: user2.id,
      previousSignatureId: sig1.id,
      signatureData: sig2Data,
      signedAt: new Date('2026-08-10T00:01:00Z')
    }).value

    signatureRepository.savedSignatures.push(sig2, sig1)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isOk()).toBe(true)
    expect(result.value.map((s) => s.id)).toEqual(['sig-1', 'sig-2'])
  })

  it('returns an empty array for a document with no signatures yet', async () => {
    const { documentRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([])
  })

  it('fails when the document does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ documentId: 'missing-doc' })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DocumentNotFoundError)
  })

  it('fails when a signer no longer exists', async () => {
    const { crypto, documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const message = crypto.hash(document.originalHash.toBytes())
    const user = aUser('user-1', 1)
    const sig = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user.id,
      previousSignatureId: null,
      signatureData: crypto.sign(user.publicKey, message),
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(sig)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('fails when a signature was tampered with', async () => {
    const { documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)
    const user = aUser('user-1', 1)
    userRepository.users.push(user)

    const tampered = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user.id,
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array([9, 9, 9, 9])).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(tampered)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- VerifyDocumentUseCase.test.ts`
Expected: FAIL — `Cannot find module './VerifyDocumentUseCase.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/verify-document/VerifyDocumentUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { Signature } from '../../domain/entities/Signature.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { BrokenChainError } from '../../domain/errors/BrokenChainError.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { UserRepository } from '../ports/UserRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface VerifyDocumentInput {
  documentId: string
}

export type VerifyDocumentError = DocumentNotFoundError | UserNotFoundError | BrokenChainError

export class VerifyDocumentUseCase {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly userRepository: UserRepository,
    private readonly signatureRepository: SignatureRepository,
    private readonly signatureChainService: SignatureChainService
  ) {}

  async execute(input: VerifyDocumentInput): Promise<Result<Signature[], VerifyDocumentError>> {
    const document = await this.documentRepository.findById(input.documentId)
    if (document === null) {
      return Result.fail(new DocumentNotFoundError(input.documentId))
    }

    const signatures = await this.signatureRepository.findByDocumentId(input.documentId)

    const orderedResult = this.signatureChainService.orderChain(signatures)
    if (orderedResult.isFail()) {
      return Result.fail(orderedResult.error)
    }
    const orderedSignatures = orderedResult.value

    const publicKeysByUserId = new Map<string, PublicKey>()
    const uniqueUserIds = [...new Set(orderedSignatures.map((s) => s.userId))]
    for (const userId of uniqueUserIds) {
      const user = await this.userRepository.findById(userId)
      if (user === null) {
        return Result.fail(new UserNotFoundError(userId))
      }
      publicKeysByUserId.set(userId, user.publicKey)
    }

    const verifyResult = this.signatureChainService.verifyChain(document, orderedSignatures, publicKeysByUserId)
    if (verifyResult.isFail()) {
      return Result.fail(verifyResult.error)
    }

    return Result.ok(orderedSignatures)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- VerifyDocumentUseCase.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all previously-passing tests still pass, plus the 5 new tests — total test count increases by 5 from wherever Task 1 left it (67 + 7 orderChain tests + 5 = 79).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/use-cases/verify-document/VerifyDocumentUseCase.ts src/use-cases/verify-document/VerifyDocumentUseCase.test.ts
git commit -m "feat: add VerifyDocumentUseCase"
```

---

## Post-plan state

After Task 2, `VerifyDocumentUseCase` exists, is fully unit-tested with fakes (no real I/O), and `npm test` / `npm run typecheck` both pass. This completes the Upload → Sign → Verify use-case decomposition. None of the three use cases are reachable from any HTTP route, and no concrete adapter exists for any port (`FileStorage`, `IdGenerator`, `DocumentRepository`, `UserRepository`, `SignatureRepository`, `Clock`) — those remain follow-up sub-projects, along with wiring the use-case layer into `src/interface-adapters/http/`.
