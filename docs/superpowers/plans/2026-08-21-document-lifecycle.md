# Real Document Lifecycle (Upload, List, Sign, Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Flutter app's static document-list/details/signing mockups with a real end-to-end flow: upload a real file, list real documents from Postgres with per-user "already signed" state, sign with the user's on-device Ed25519 private key against the backend's existing signature-chain logic, and fix the post-sign "back to documents" navigation bug.

**Architecture:** Two new backend read endpoints (`GET /documents`, `GET /documents/:documentId`) built on the existing clean-architecture use-case pattern, reusing `SignatureChainService.buildSigningPayload` server-side so the exact chain-hashing logic is never duplicated in Dart. A new `DocumentApi` port on the Flutter side (mirroring the existing `UserApi` pattern) backs real `NextPage`/`DocumentDetailsPage` screens; `SigningConfirmationPage` gets a one-line navigation fix.

**Tech Stack:** Existing backend stack (Hono, Drizzle/Postgres, Node `crypto` via `Ed25519CryptoProvider`) — no new backend dependencies. Flutter side adds `file_picker` (already added to `pubspec.yaml`/`pubspec.lock` — verified working with `flutter pub add file_picker`, resolved to `file_picker: ^12.0.0`) for the upload flow; all other packages (`cryptography`, `http`, `flutter_secure_storage`) already exist from the registration sub-project.

**Spec:** `docs/superpowers/specs/2026-08-21-document-lifecycle-design.md`

## Global Constraints

- No password/auth mechanism anywhere — this plan does not add one. Identity remains "whatever private key is stored in `IdentityStorage` on this device."
- The Flutter client never reimplements the SHA-256 chain-hashing logic (`SignatureChainService.buildSigningPayload`) — it only ever signs bytes the server hands it via the new `GET /documents/:documentId` endpoint's `signingPayload` field.
- Windows desktop is the target platform (`flutter run -d windows`, or `flutter run -d chrome` for verification in this environment, which lacks the Visual Studio C++ workload); `file_picker` supports both.
- Exact package APIs used below (`FilePicker.pickFile()`, `PlatformFile.readAsBytes()`, `Ed25519().newKeyPairFromSeed()`, `Ed25519().sign()`, `Signature.bytes`) were verified against the installed `file_picker` 12.0.0 and `cryptography` 2.9.0 package source before this plan was written, not guessed.
- Backend `DomainError` → HTTP status mapping (`mapDomainErrorToResponse` in `src/interface-adapters/http/errorMapping.ts`) already maps `DocumentNotFoundError` to 404 — reused as-is, no changes needed there.
- Note on scope vs. the approved spec: the spec described routing `DocumentDetailsPage`/`SigningConfirmationPage` through `app_routes.dart`'s named routes with a `documentId` argument. While implementing, a simpler equivalent was found: `NextPage`'s own entry is already reached via `Navigator.pushNamed`/`pushReplacementNamed` (from Welcome and from `RegisterForm`), which is the only route `ModalRoute.withName(AppRoutes.next)` needs to find on the stack for the "Back to Documents" fix to work — deeper pushes (to `DocumentDetailsPage`, `SigningConfirmationPage`) can stay as direct `Navigator.push`/`MaterialPageRoute`, exactly as the mockup already does, which keeps constructor-based dependency injection for tests simple (matching the `RegisterForm`/`FakeUserApi` testing pattern) without forcing `DocumentApi`/`IdentityStorage` through `app_routes.dart`'s string-only argument map. This produces identical user-visible behavior with less code. `app_routes.dart` itself needs no changes in this plan.

---

### Task 1: `DocumentRepository.findAll()`

**Files:**
- Modify: `src/use-cases/ports/DocumentRepository.ts`
- Modify: `src/use-cases/testing/FakeDocumentRepository.ts`
- Modify: `src/infrastructure/db/PostgresDocumentRepository.ts`
- Test: `src/infrastructure/db/PostgresDocumentRepository.test.ts` (add a test to the existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DocumentRepository.findAll(): Promise<Document[]>`, implemented by both `FakeDocumentRepository` and `PostgresDocumentRepository`. Task 2's `ListDocumentsUseCase` depends on this.

- [ ] **Step 1: Write the failing test**

Add to `src/infrastructure/db/PostgresDocumentRepository.test.ts` (existing file — add this `it` inside the existing `describe('PostgresDocumentRepository', ...)` block, after the existing tests):

```ts
  it('finds all saved documents', async () => {
    const repository = new PostgresDocumentRepository()
    await repository.save(aDocument('doc-1'))
    await repository.save(aDocument('doc-2'))

    const found = await repository.findAll()

    expect(found.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-2'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/infrastructure/db/PostgresDocumentRepository.test.ts`
Expected: FAIL with a TypeScript error — `Property 'findAll' does not exist on type 'PostgresDocumentRepository'`.

- [ ] **Step 3: Add `findAll` to the port**

In `src/use-cases/ports/DocumentRepository.ts`, change the interface to:

```ts
import { Document } from '../../domain/entities/Document.js'

export interface DocumentRepository {
  save(document: Document): Promise<void>
  findById(id: string): Promise<Document | null>
  findAll(): Promise<Document[]>
}
```

- [ ] **Step 4: Implement in `FakeDocumentRepository`**

In `src/use-cases/testing/FakeDocumentRepository.ts`, add this method to the class (after `findById`):

```ts
  async findAll(): Promise<Document[]> {
    return [...this.savedDocuments]
  }
```

- [ ] **Step 5: Implement in `PostgresDocumentRepository`**

In `src/infrastructure/db/PostgresDocumentRepository.ts`, add this method to the class (after `findById`):

```ts
  async findAll(): Promise<Document[]> {
    const rows = await db.select().from(documents)
    return rows.map((row) =>
      Document.create({
        id: row.id,
        title: row.title,
        filePath: row.filePath,
        originalHash: Hash.create(row.originalHash).value,
        uploaderId: row.uploaderId
      }).value
    )
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/infrastructure/db/PostgresDocumentRepository.test.ts`
Expected: PASS — 3 tests passed (2 existing + 1 new).

- [ ] **Step 7: Commit**

```bash
git add src/use-cases/ports/DocumentRepository.ts src/use-cases/testing/FakeDocumentRepository.ts src/infrastructure/db/PostgresDocumentRepository.ts src/infrastructure/db/PostgresDocumentRepository.test.ts
git commit -m "feat: add DocumentRepository.findAll()"
```

---

### Task 2: `ListDocumentsUseCase`

**Files:**
- Create: `src/use-cases/list-documents/ListDocumentsUseCase.ts`
- Test: `src/use-cases/list-documents/ListDocumentsUseCase.test.ts`

**Interfaces:**
- Consumes: `DocumentRepository.findAll()` (Task 1), `SignatureRepository.findByDocumentId(documentId): Promise<Signature[]>` (existing).
- Produces: `ListDocumentsUseCase` with `execute(input: {userId: string}): Promise<DocumentSummaryDto[]>` where `DocumentSummaryDto = {id: string, title: string, uploaderId: string, signedByUser: boolean}`. Task 4's HTTP route depends on this exact shape.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/list-documents/ListDocumentsUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ListDocumentsUseCase } from './ListDocumentsUseCase.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: `Document ${id}`,
    filePath: `/files/${id}.pdf`,
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function setup() {
  const documentRepository = new FakeDocumentRepository()
  const signatureRepository = new FakeSignatureRepository()
  const useCase = new ListDocumentsUseCase(documentRepository, signatureRepository)
  return { documentRepository, signatureRepository, useCase }
}

describe('ListDocumentsUseCase', () => {
  it('returns an empty list when there are no documents', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result).toEqual([])
  })

  it('marks signedByUser true only for documents the given user has signed', async () => {
    const { documentRepository, signatureRepository, useCase } = setup()
    const signedDoc = aDocument('doc-1')
    const unsignedDoc = aDocument('doc-2')
    await documentRepository.save(signedDoc)
    await documentRepository.save(unsignedDoc)
    const signature = Signature.create({
      id: 'sig-1',
      documentId: signedDoc.id,
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(signature)

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result).toEqual([
      { id: 'doc-1', title: 'Document doc-1', uploaderId: 'user-1', signedByUser: true },
      { id: 'doc-2', title: 'Document doc-2', uploaderId: 'user-1', signedByUser: false }
    ])
  })

  it('does not mark a document as signed for a different user', async () => {
    const { documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument('doc-1')
    await documentRepository.save(document)
    const signature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: 'user-2',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(signature)

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result).toEqual([{ id: 'doc-1', title: 'Document doc-1', uploaderId: 'user-1', signedByUser: false }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/use-cases/list-documents/ListDocumentsUseCase.test.ts`
Expected: FAIL — `ListDocumentsUseCase.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/list-documents/ListDocumentsUseCase.ts`:

```ts
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface ListDocumentsInput {
  userId: string
}

export interface DocumentSummaryDto {
  id: string
  title: string
  uploaderId: string
  signedByUser: boolean
}

export class ListDocumentsUseCase {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly signatureRepository: SignatureRepository
  ) {}

  async execute(input: ListDocumentsInput): Promise<DocumentSummaryDto[]> {
    const documents = await this.documentRepository.findAll()
    const summaries: DocumentSummaryDto[] = []
    for (const document of documents) {
      const signatures = await this.signatureRepository.findByDocumentId(document.id)
      const signedByUser = signatures.some((s) => s.userId === input.userId)
      summaries.push({
        id: document.id,
        title: document.title,
        uploaderId: document.uploaderId,
        signedByUser
      })
    }
    return summaries
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/use-cases/list-documents/ListDocumentsUseCase.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/list-documents/
git commit -m "feat: add ListDocumentsUseCase"
```

---

### Task 3: `GetDocumentUseCase`

**Files:**
- Create: `src/use-cases/get-document/GetDocumentUseCase.ts`
- Test: `src/use-cases/get-document/GetDocumentUseCase.test.ts`

**Interfaces:**
- Consumes: `DocumentRepository.findById`/`findAll` (existing/Task 1), `SignatureRepository.findByDocumentId` (existing), `SignatureChainService.findTip`/`buildSigningPayload` (existing, already used by `SignDocumentUseCase`).
- Produces: `GetDocumentUseCase` with `execute(input: {documentId: string, userId: string}): Promise<Result<DocumentDetailDto, DocumentNotFoundError>>` where `DocumentDetailDto = {id: string, title: string, uploaderId: string, signatures: Array<{userId: string, signedAt: Date}>, signedByUser: boolean, signingPayload: Uint8Array | null}`. Task 4's HTTP route depends on this exact shape.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/get-document/GetDocumentUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GetDocumentUseCase } from './GetDocumentUseCase.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function setup() {
  const crypto = new FakeCryptoProvider()
  const documentRepository = new FakeDocumentRepository()
  const signatureRepository = new FakeSignatureRepository()
  const signatureChainService = new SignatureChainService(crypto)
  const useCase = new GetDocumentUseCase(documentRepository, signatureRepository, signatureChainService)
  return { crypto, documentRepository, signatureRepository, signatureChainService, useCase }
}

describe('GetDocumentUseCase', () => {
  it('fails when the document does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ documentId: 'missing-doc', userId: 'user-1' })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DocumentNotFoundError)
  })

  it('returns signedByUser: false and a signing payload for a document with no signatures', async () => {
    const { crypto, documentRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const result = await useCase.execute({ documentId: document.id, userId: 'user-1' })

    expect(result.isOk()).toBe(true)
    expect(result.value.signedByUser).toBe(false)
    expect(result.value.signatures).toEqual([])
    const expectedPayload = crypto.hash(document.originalHash.toBytes()).toBytes()
    expect(result.value.signingPayload).toEqual(expectedPayload)
  })

  it('returns signedByUser: true and a null signing payload once the user has signed', async () => {
    const { crypto, documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)
    const message = crypto.hash(document.originalHash.toBytes())
    const publicKey = PublicKey.create(new Uint8Array(32).fill(1)).value
    const existingSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: crypto.sign(publicKey, message),
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(existingSignature)

    const result = await useCase.execute({ documentId: document.id, userId: 'user-1' })

    expect(result.isOk()).toBe(true)
    expect(result.value.signedByUser).toBe(true)
    expect(result.value.signingPayload).toBeNull()
    expect(result.value.signatures).toEqual([{ userId: 'user-1', signedAt: existingSignature.signedAt }])
  })

  it('computes the signing payload from the chain tip when a different user has already signed', async () => {
    const { crypto, documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)
    const firstMessage = crypto.hash(document.originalHash.toBytes())
    const firstPublicKey = PublicKey.create(new Uint8Array(32).fill(1)).value
    const firstSignatureData = crypto.sign(firstPublicKey, firstMessage)
    const firstSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: firstSignatureData,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(firstSignature)

    const result = await useCase.execute({ documentId: document.id, userId: 'user-2' })

    expect(result.isOk()).toBe(true)
    expect(result.value.signedByUser).toBe(false)
    const combined = new Uint8Array(document.originalHash.toBytes().length + firstSignatureData.toBytes().length)
    combined.set(document.originalHash.toBytes(), 0)
    combined.set(firstSignatureData.toBytes(), document.originalHash.toBytes().length)
    const expectedPayload = crypto.hash(combined).toBytes()
    expect(result.value.signingPayload).toEqual(expectedPayload)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/use-cases/get-document/GetDocumentUseCase.test.ts`
Expected: FAIL — `GetDocumentUseCase.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/get-document/GetDocumentUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface GetDocumentInput {
  documentId: string
  userId: string
}

export interface DocumentDetailDto {
  id: string
  title: string
  uploaderId: string
  signatures: Array<{ userId: string; signedAt: Date }>
  signedByUser: boolean
  signingPayload: Uint8Array | null
}

export type GetDocumentError = DocumentNotFoundError

export class GetDocumentUseCase {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly signatureRepository: SignatureRepository,
    private readonly signatureChainService: SignatureChainService
  ) {}

  async execute(input: GetDocumentInput): Promise<Result<DocumentDetailDto, GetDocumentError>> {
    const document = await this.documentRepository.findById(input.documentId)
    if (document === null) {
      return Result.fail(new DocumentNotFoundError(input.documentId))
    }

    const signatures = await this.signatureRepository.findByDocumentId(input.documentId)
    const signedByUser = signatures.some((s) => s.userId === input.userId)

    let signingPayload: Uint8Array | null = null
    if (!signedByUser) {
      const tip = this.signatureChainService.findTip(signatures)
      signingPayload = this.signatureChainService.buildSigningPayload(document, tip).toBytes()
    }

    return Result.ok({
      id: document.id,
      title: document.title,
      uploaderId: document.uploaderId,
      signatures: signatures.map((s) => ({ userId: s.userId, signedAt: s.signedAt })),
      signedByUser,
      signingPayload
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/use-cases/get-document/GetDocumentUseCase.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/get-document/
git commit -m "feat: add GetDocumentUseCase"
```

---

### Task 4: HTTP routes, serialization, composition wiring

**Files:**
- Modify: `src/interface-adapters/http/serialization.ts`
- Modify: `src/interface-adapters/http/routes/documents.ts`
- Modify: `src/infrastructure/composition.ts`
- Test: `src/interface-adapters/http/documents.integration.test.ts` (add to the existing file)

**Interfaces:**
- Consumes: `ListDocumentsUseCase` (Task 2), `GetDocumentUseCase` + `DocumentDetailDto` (Task 3).
- Produces: `GET /documents?userId=<id>` → `200` with `DocumentSummaryDto[]` JSON, `400` if `userId` missing. `GET /documents/:documentId?userId=<id>` → `200` with `DocumentDetailJson` (`signingPayload` base64-encoded, `signedAt` ISO strings), `400` if `userId` missing, `404` via `mapDomainErrorToResponse` if not found. Task 5's `HttpDocumentApi` (Flutter) depends on both response shapes exactly.

- [ ] **Step 1: Write the failing tests**

Add to `src/interface-adapters/http/documents.integration.test.ts` (existing file — append these two `describe` blocks after the existing `GET /documents/:documentId/verify` block):

```ts
describe('GET /documents', () => {
  it('lists documents with signedByUser computed for the given user', async () => {
    const document = await uploadADocument()

    const res = await app.request('/documents?userId=user-alice')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toContainEqual({
      id: document.id,
      title: 'Contract',
      uploaderId: 'user-alice',
      signedByUser: false
    })
  })

  it('returns 400 when userId is missing', async () => {
    const res = await app.request('/documents')

    expect(res.status).toBe(400)
  })
})

describe('GET /documents/:documentId', () => {
  it('returns document detail with a signing payload for an unsigned document', async () => {
    const document = await uploadADocument()

    const res = await app.request(`/documents/${document.id}?userId=user-alice`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(document.id)
    expect(body.signedByUser).toBe(false)
    expect(typeof body.signingPayload).toBe('string')
  })

  it('returns signedByUser: true and a null signing payload after the user signs', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signatureBytes: Buffer.from(signatureBytes).toString('base64')
      })
    })

    const res = await app.request(`/documents/${document.id}?userId=user-alice`)

    const body = await res.json()
    expect(body.signedByUser).toBe(true)
    expect(body.signingPayload).toBeNull()
  })

  it('returns 404 for a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc?userId=user-alice')

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interface-adapters/http/documents.integration.test.ts`
Expected: FAIL — routes don't exist yet, requests 404 or the composition root is missing the use cases.

- [ ] **Step 3: Add serialization helper**

In `src/interface-adapters/http/serialization.ts`, add this import at the top (alongside the existing entity imports):

```ts
import { DocumentDetailDto } from '../../use-cases/get-document/GetDocumentUseCase.js'
```

Then add this interface and function anywhere after the existing `toDocumentJson` function:

```ts
export interface DocumentDetailJson {
  id: string
  title: string
  uploaderId: string
  signatures: Array<{ userId: string; signedAt: string }>
  signedByUser: boolean
  signingPayload: string | null
}

export function toDocumentDetailJson(detail: DocumentDetailDto): DocumentDetailJson {
  return {
    id: detail.id,
    title: detail.title,
    uploaderId: detail.uploaderId,
    signatures: detail.signatures.map((s) => ({ userId: s.userId, signedAt: s.signedAt.toISOString() })),
    signedByUser: detail.signedByUser,
    signingPayload: detail.signingPayload === null ? null : Buffer.from(detail.signingPayload).toString('base64')
  }
}
```

(`DocumentSummaryDto`, Task 2's list shape, needs no serialization function — its fields are already JSON-safe primitives, so the route returns it directly.)

- [ ] **Step 4: Add the routes**

In `src/interface-adapters/http/routes/documents.ts`, add `toDocumentDetailJson` to the existing import from `'../serialization.js'` (alongside `toDocumentJson`, `toSignatureJson`, `decodeBase64`), then add these two routes inside `createDocumentsRoutes`, after the existing `documents.get('/documents/:documentId/verify', ...)` block and before `return documents`:

```ts
  documents.get('/documents', async (c) => {
    const userId = c.req.query('userId')
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: { type: 'ValidationError', message: 'userId query parameter is required' } }, 400)
    }

    const summaries = await dependencies.listDocumentsUseCase.execute({ userId })
    return c.json(summaries, 200)
  })

  documents.get('/documents/:documentId', async (c) => {
    const documentId = c.req.param('documentId')
    const userId = c.req.query('userId')
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: { type: 'ValidationError', message: 'userId query parameter is required' } }, 400)
    }

    const result = await dependencies.getDocumentUseCase.execute({ documentId, userId })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentDetailJson(result.value), 200)
  })
```

- [ ] **Step 5: Wire into the composition root**

In `src/infrastructure/composition.ts`, add these imports:

```ts
import { ListDocumentsUseCase } from '../use-cases/list-documents/ListDocumentsUseCase.js'
import { GetDocumentUseCase } from '../use-cases/get-document/GetDocumentUseCase.js'
```

Add both to the `Dependencies` interface:

```ts
export interface Dependencies {
  createUserUseCase: CreateUserUseCase
  uploadDocumentUseCase: UploadDocumentUseCase
  signDocumentUseCase: SignDocumentUseCase
  verifyDocumentUseCase: VerifyDocumentUseCase
  listDocumentsUseCase: ListDocumentsUseCase
  getDocumentUseCase: GetDocumentUseCase
}
```

Construct them in `createDependencies()` (after `verifyDocumentUseCase` is constructed) and add them to the returned object:

```ts
  const listDocumentsUseCase = new ListDocumentsUseCase(documentRepository, signatureRepository)
  const getDocumentUseCase = new GetDocumentUseCase(documentRepository, signatureRepository, signatureChainService)

  return {
    createUserUseCase,
    uploadDocumentUseCase,
    signDocumentUseCase,
    verifyDocumentUseCase,
    listDocumentsUseCase,
    getDocumentUseCase
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/interface-adapters/http/documents.integration.test.ts`
Expected: PASS — 7 tests passed (3 existing groups + 4 new tests).

- [ ] **Step 7: Run the full backend test suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/interface-adapters/http/serialization.ts src/interface-adapters/http/routes/documents.ts src/infrastructure/composition.ts src/interface-adapters/http/documents.integration.test.ts
git commit -m "feat: add GET /documents and GET /documents/:documentId endpoints"
```

---

### Task 5: Flutter `DocumentApi`, `HttpDocumentApi`, `FakeDocumentApi`

**Files:**
- Create: `flutter_digital_sign/lib/core/network/document_api.dart`
- Test: `flutter_digital_sign/test/core/network/http_document_api_test.dart`
- Create: `flutter_digital_sign/test/core/network/fake_document_api.dart` (test helper, no tests of its own)

**Interfaces:**
- Consumes: `http.Client`/`http.Response` (existing), `MockClient` (test only).
- Produces: `DocumentSummary` (`{id, title, uploaderId, signedByUser}`), `DocumentSignature` (`{userId, signedAt}`), `DocumentDetail` (`{id, title, uploaderId, signatures: List<DocumentSignature>, signedByUser, signingPayload: List<int>?}`), `UploadResult` (sealed: `UploadSuccess(documentId)` / `UploadFailure(message)`), `SignResult` (sealed: `SignSuccess()` / `SignFailure(message)`), `DocumentApi` (abstract: `listDocuments(userId)`, `getDocument(documentId, userId)`, `uploadDocument(title, uploaderId, fileBytes)`, `submitSignature(documentId, userId, signatureBytes)`), `HttpDocumentApi`, `FakeDocumentApi`. Tasks 6 and 7 depend on all of these exact names/types.

- [ ] **Step 1: Write the failing tests**

Create `flutter_digital_sign/test/core/network/http_document_api_test.dart`:

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';

void main() {
  group('HttpDocumentApi.listDocuments', () {
    test('returns the decoded list of document summaries', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), 'http://localhost:3000/documents?userId=user-1');
        return http.Response(
          jsonEncode([
            {'id': 'doc-1', 'title': 'Contract', 'uploaderId': 'user-1', 'signedByUser': false}
          ]),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.listDocuments('user-1');

      expect(result, hasLength(1));
      expect(result.first.id, 'doc-1');
      expect(result.first.title, 'Contract');
      expect(result.first.signedByUser, false);
    });
  });

  group('HttpDocumentApi.getDocument', () {
    test('decodes a detail response with a base64 signing payload', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1?userId=user-1');
        return http.Response(
          jsonEncode({
            'id': 'doc-1',
            'title': 'Contract',
            'uploaderId': 'user-1',
            'signatures': [],
            'signedByUser': false,
            'signingPayload': base64Encode([1, 2, 3]),
          }),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.getDocument('doc-1', 'user-1');

      expect(result.id, 'doc-1');
      expect(result.signedByUser, false);
      expect(result.signingPayload, [1, 2, 3]);
    });

    test('decodes signatures and a null signing payload once signed', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'id': 'doc-1',
            'title': 'Contract',
            'uploaderId': 'user-1',
            'signatures': [
              {'userId': 'user-1', 'signedAt': '2026-08-20T00:00:00.000Z'}
            ],
            'signedByUser': true,
            'signingPayload': null,
          }),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.getDocument('doc-1', 'user-1');

      expect(result.signedByUser, true);
      expect(result.signingPayload, isNull);
      expect(result.signatures, hasLength(1));
      expect(result.signatures.first.userId, 'user-1');
    });
  });

  group('HttpDocumentApi.uploadDocument', () {
    test('returns UploadSuccess with the document id on 201', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/documents');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['title'], 'Contract.pdf');
        expect(body['uploaderId'], 'user-1');
        expect(body['fileBytes'], base64Encode([1, 2, 3]));
        return http.Response(jsonEncode({'id': 'doc-1', 'title': 'Contract.pdf'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.uploadDocument('Contract.pdf', 'user-1', [1, 2, 3]);

      expect(result, isA<UploadSuccess>());
      expect((result as UploadSuccess).documentId, 'doc-1');
    });

    test('returns UploadFailure with the server message on a validation error', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'ValidationError', 'message': 'title, uploaderId, and fileBytes are required strings'}
          }),
          400,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.uploadDocument('', 'user-1', [1, 2, 3]);

      expect(result, isA<UploadFailure>());
      expect((result as UploadFailure).message, 'title, uploaderId, and fileBytes are required strings');
    });
  });

  group('HttpDocumentApi.submitSignature', () {
    test('returns SignSuccess on 201', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1/signatures');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-1');
        expect(body['signatureBytes'], base64Encode([9, 9, 9]));
        return http.Response(jsonEncode({'id': 'sig-1'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.submitSignature('doc-1', 'user-1', [9, 9, 9]);

      expect(result, isA<SignSuccess>());
    });

    test('returns SignFailure with the server message on a duplicate signature', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'DuplicateSignatureError', 'message': 'User user-1 has already signed this document'}
          }),
          409,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.submitSignature('doc-1', 'user-1', [9, 9, 9]);

      expect(result, isA<SignFailure>());
      expect((result as SignFailure).message, 'User user-1 has already signed this document');
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/network/http_document_api_test.dart`
Expected: FAIL — `document_api.dart` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `flutter_digital_sign/lib/core/network/document_api.dart`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class DocumentSummary {
  final String id;
  final String title;
  final String uploaderId;
  final bool signedByUser;

  DocumentSummary({
    required this.id,
    required this.title,
    required this.uploaderId,
    required this.signedByUser,
  });

  factory DocumentSummary.fromJson(Map<String, dynamic> json) {
    return DocumentSummary(
      id: json['id'] as String,
      title: json['title'] as String,
      uploaderId: json['uploaderId'] as String,
      signedByUser: json['signedByUser'] as bool,
    );
  }
}

class DocumentSignature {
  final String userId;
  final DateTime signedAt;

  DocumentSignature({required this.userId, required this.signedAt});

  factory DocumentSignature.fromJson(Map<String, dynamic> json) {
    return DocumentSignature(
      userId: json['userId'] as String,
      signedAt: DateTime.parse(json['signedAt'] as String),
    );
  }
}

class DocumentDetail {
  final String id;
  final String title;
  final String uploaderId;
  final List<DocumentSignature> signatures;
  final bool signedByUser;
  final List<int>? signingPayload;

  DocumentDetail({
    required this.id,
    required this.title,
    required this.uploaderId,
    required this.signatures,
    required this.signedByUser,
    required this.signingPayload,
  });

  factory DocumentDetail.fromJson(Map<String, dynamic> json) {
    return DocumentDetail(
      id: json['id'] as String,
      title: json['title'] as String,
      uploaderId: json['uploaderId'] as String,
      signatures: (json['signatures'] as List)
          .map((s) => DocumentSignature.fromJson(s as Map<String, dynamic>))
          .toList(),
      signedByUser: json['signedByUser'] as bool,
      signingPayload:
          json['signingPayload'] == null ? null : base64Decode(json['signingPayload'] as String),
    );
  }
}

sealed class UploadResult {}

class UploadSuccess extends UploadResult {
  final String documentId;
  UploadSuccess(this.documentId);
}

class UploadFailure extends UploadResult {
  final String message;
  UploadFailure(this.message);
}

sealed class SignResult {}

class SignSuccess extends SignResult {}

class SignFailure extends SignResult {
  final String message;
  SignFailure(this.message);
}

abstract class DocumentApi {
  Future<List<DocumentSummary>> listDocuments(String userId);
  Future<DocumentDetail> getDocument(String documentId, String userId);
  Future<UploadResult> uploadDocument(String title, String uploaderId, List<int> fileBytes);
  Future<SignResult> submitSignature(String documentId, String userId, List<int> signatureBytes);
}

class HttpDocumentApi implements DocumentApi {
  final String baseUrl;
  final http.Client _client;

  HttpDocumentApi({this.baseUrl = 'http://localhost:3000', http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<List<DocumentSummary>> listDocuments(String userId) async {
    final response = await _client.get(Uri.parse('$baseUrl/documents?userId=$userId'));
    if (response.statusCode != 200) {
      throw Exception('Failed to load documents');
    }
    final body = jsonDecode(response.body) as List;
    return body.map((d) => DocumentSummary.fromJson(d as Map<String, dynamic>)).toList();
  }

  @override
  Future<DocumentDetail> getDocument(String documentId, String userId) async {
    final response = await _client.get(Uri.parse('$baseUrl/documents/$documentId?userId=$userId'));
    if (response.statusCode != 200) {
      throw Exception('Failed to load document');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return DocumentDetail.fromJson(body);
  }

  @override
  Future<UploadResult> uploadDocument(
    String title,
    String uploaderId,
    List<int> fileBytes,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/documents'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'title': title,
        'uploaderId': uploaderId,
        'fileBytes': base64Encode(fileBytes),
      }),
    );

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 201) {
      return UploadSuccess(body['id'] as String);
    }

    final error = body['error'] as Map<String, dynamic>?;
    final message = error?['message'] as String? ?? 'Upload failed';
    return UploadFailure(message);
  }

  @override
  Future<SignResult> submitSignature(
    String documentId,
    String userId,
    List<int> signatureBytes,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/documents/$documentId/signatures'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'userId': userId,
        'signatureBytes': base64Encode(signatureBytes),
      }),
    );

    if (response.statusCode == 201) {
      return SignSuccess();
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final error = body['error'] as Map<String, dynamic>?;
    final message = error?['message'] as String? ?? 'Signing failed';
    return SignFailure(message);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/core/network/http_document_api_test.dart`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Write `FakeDocumentApi`**

Create `flutter_digital_sign/test/core/network/fake_document_api.dart`:

```dart
import 'package:flutter_digital_sign/core/network/document_api.dart';

class FakeDocumentApi implements DocumentApi {
  List<DocumentSummary> Function(String userId)? onListDocuments;
  DocumentDetail Function(String documentId, String userId)? onGetDocument;
  UploadResult Function(String title, String uploaderId, List<int> fileBytes)? onUploadDocument;
  SignResult Function(String documentId, String userId, List<int> signatureBytes)? onSubmitSignature;

  final List<String> listCalls = [];
  final List<({String documentId, String userId})> getCalls = [];
  final List<({String title, String uploaderId, List<int> fileBytes})> uploadCalls = [];
  final List<({String documentId, String userId, List<int> signatureBytes})> signCalls = [];

  @override
  Future<List<DocumentSummary>> listDocuments(String userId) async {
    listCalls.add(userId);
    return onListDocuments?.call(userId) ?? [];
  }

  @override
  Future<DocumentDetail> getDocument(String documentId, String userId) async {
    getCalls.add((documentId: documentId, userId: userId));
    return onGetDocument!.call(documentId, userId);
  }

  @override
  Future<UploadResult> uploadDocument(String title, String uploaderId, List<int> fileBytes) async {
    uploadCalls.add((title: title, uploaderId: uploaderId, fileBytes: fileBytes));
    return onUploadDocument?.call(title, uploaderId, fileBytes) ?? UploadSuccess('fake-document-id');
  }

  @override
  Future<SignResult> submitSignature(String documentId, String userId, List<int> signatureBytes) async {
    signCalls.add((documentId: documentId, userId: userId, signatureBytes: signatureBytes));
    return onSubmitSignature?.call(documentId, userId, signatureBytes) ?? SignSuccess();
  }
}
```

- [ ] **Step 6: Run analysis and the full network test directory**

Run: `flutter analyze lib/core/network/document_api.dart test/core/network/`
Expected: no issues found.

Run: `flutter test test/core/network/`
Expected: PASS — 9 tests passed (7 new + the 2 existing `http_user_api_test.dart` tests; `fake_document_api.dart`/`fake_user_api.dart` have no tests of their own).

- [ ] **Step 7: Commit**

```bash
git add flutter_digital_sign/lib/core/network/document_api.dart flutter_digital_sign/test/core/network/http_document_api_test.dart flutter_digital_sign/test/core/network/fake_document_api.dart
git commit -m "feat: add DocumentApi, HttpDocumentApi, and FakeDocumentApi"
```

---

### Task 6: `Ed25519KeyPair.sign` (reconstruct + sign with a stored private key)

**Files:**
- Modify: `flutter_digital_sign/lib/core/crypto/ed25519_key_pair.dart`
- Test: `flutter_digital_sign/test/core/crypto/ed25519_key_pair_test.dart` (add to the existing file)

**Interfaces:**
- Consumes: `Ed25519`, `SimplePublicKey`, `Signature` from `package:cryptography/cryptography.dart` (`Ed25519().newKeyPairFromSeed(seed)` and `Ed25519().sign(message, keyPair: keyPair)`, both verified against the installed `cryptography` 2.9.0 source).
- Produces: `Ed25519KeyPair.sign(privateKeyBytes, message) -> Future<List<int>>` (static method). Task 7's `DocumentDetailsPage` depends on this exact signature.

- [ ] **Step 1: Write the failing test**

Add to `flutter_digital_sign/test/core/crypto/ed25519_key_pair_test.dart` (existing file — add this import at the top alongside the existing ones, and this `test` inside the existing `void main() { ... }` block, after the existing 3 tests):

```dart
import 'package:cryptography/cryptography.dart';
```

```dart
  test('sign produces a signature that verifies against the public key', () async {
    final keyPair = await Ed25519KeyPair.generate();
    final privateKeyBytes = await keyPair.extractPrivateKeyBytes();
    final message = [1, 2, 3, 4, 5];

    final signatureBytes = await Ed25519KeyPair.sign(privateKeyBytes, message);

    final algorithm = Ed25519();
    final publicKey = SimplePublicKey(keyPair.publicKeyBytes, type: KeyPairType.ed25519);
    final isValid = await algorithm.verify(
      message,
      signature: Signature(signatureBytes, publicKey: publicKey),
    );
    expect(isValid, true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `flutter_digital_sign/`): `flutter test test/core/crypto/ed25519_key_pair_test.dart`
Expected: FAIL — `Error: Method not found: 'sign'` (no static `sign` method on `Ed25519KeyPair` yet).

- [ ] **Step 3: Add `sign` to `Ed25519KeyPair`**

In `flutter_digital_sign/lib/core/crypto/ed25519_key_pair.dart`, add this static method to the class (after `extractPrivateKeyBytes`):

```dart
  static Future<List<int>> sign(List<int> privateKeyBytes, List<int> message) async {
    final algorithm = Ed25519();
    final keyPair = await algorithm.newKeyPairFromSeed(privateKeyBytes);
    final signature = await algorithm.sign(message, keyPair: keyPair);
    return signature.bytes;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/core/crypto/ed25519_key_pair_test.dart`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add flutter_digital_sign/lib/core/crypto/ed25519_key_pair.dart flutter_digital_sign/test/core/crypto/ed25519_key_pair_test.dart
git commit -m "feat: add Ed25519KeyPair.sign for signing with a stored private key"
```

---

### Task 7: Real `NextPage` (document list + upload)

**Files:**
- Modify: `flutter_digital_sign/pubspec.yaml` (already done — `file_picker: ^12.0.0` was added via `flutter pub add file_picker` while writing this plan; `pubspec.lock` reflects it)
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/next_page.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`
- Test: `flutter_digital_sign/test/document_selection_test.dart` (replace the existing content — see Task 8 for why `DocumentDetailsPage`'s constructor must land in the same task boundary as this test)

**Interfaces:**
- Consumes: `DocumentApi`, `DocumentSummary`, `UploadResult`, `UploadSuccess`, `UploadFailure` (Task 5), `IdentityStorage`, `StoredIdentity` (existing, registration sub-project), `FakeDocumentApi` (Task 5, test only), `FilePicker.pickFile()`/`PlatformFile.readAsBytes()` (verified against installed `file_picker` 12.0.0 source).
- Produces: `NextPage` (constructor `({DocumentApi? documentApi, IdentityStorage? identityStorage})`), `NextContent` (constructor `({required DocumentApi documentApi, required IdentityStorage identityStorage})`). Task 8's rewritten `DocumentDetailsPage` is what `NextContent` navigates to — this task assumes `DocumentDetailsPage` already accepts `documentId` (built in Task 8), so **Task 8 must be completed together with this task before running the full test suite**; the two are written as separate tasks only because they are separately reviewable units, not because they're independently shippable.

- [ ] **Step 1: Write the failing test**

Replace the entire content of `flutter_digital_sign/test/document_selection_test.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/next_page.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'core/network/fake_document_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<void> saveIdentity() async {
    await IdentityStorage().save('user-1', [1, 2, 3], [4, 5, 6]);
  }

  testWidgets('shows the real document list and opens document details', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onListDocuments = (userId) => [
            DocumentSummary(
              id: 'doc-1',
              title: 'Contract_Proposal.pdf',
              uploaderId: 'user-1',
              signedByUser: false,
            ),
          ]
      ..onGetDocument = (documentId, userId) => DocumentDetail(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-1',
            signatures: [],
            signedByUser: false,
            signingPayload: [1, 2, 3],
          );

    await tester.pumpWidget(
      MaterialApp(
        home: NextPage(documentApi: fakeApi, identityStorage: IdentityStorage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Documents'), findsOneWidget);
    expect(find.text('Contract_Proposal.pdf'), findsOneWidget);
    expect(fakeApi.listCalls, ['user-1']);

    await tester.tap(find.text('Contract_Proposal.pdf'));
    await tester.pumpAndSettle();

    expect(find.text('Confirm Signature'), findsOneWidget);
  });

  testWidgets('shows a "Signed" badge for a document the user already signed', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onListDocuments = (userId) => [
            DocumentSummary(
              id: 'doc-1',
              title: 'Contract_Proposal.pdf',
              uploaderId: 'user-1',
              signedByUser: true,
            ),
          ];

    await tester.pumpWidget(
      MaterialApp(
        home: NextPage(documentApi: fakeApi, identityStorage: IdentityStorage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Signed'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `flutter_digital_sign/`): `flutter test test/document_selection_test.dart`
Expected: FAIL — `NextPage`/`NextContent` don't accept `documentApi`/`identityStorage` yet, and `document.title` for the hardcoded mock strings won't exist.

- [ ] **Step 3: Rewrite `NextPage`**

Replace the entire content of `flutter_digital_sign/lib/features/next/presentation/pages/next_page.dart` with:

```dart
import 'package:flutter/material.dart';
import '../widgets/next_content.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class NextPage extends StatelessWidget {
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;

  const NextPage({super.key, this.documentApi, this.identityStorage});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Signature'),
      ),
      body: NextContent(
        documentApi: documentApi ?? HttpDocumentApi(),
        identityStorage: identityStorage ?? IdentityStorage(),
      ),
    );
  }
}
```

- [ ] **Step 4: Rewrite `NextContent`**

Replace the entire content of `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../pages/document_details_page.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class NextContent extends StatefulWidget {
  final DocumentApi documentApi;
  final IdentityStorage identityStorage;

  const NextContent({
    super.key,
    required this.documentApi,
    required this.identityStorage,
  });

  @override
  State<NextContent> createState() => _NextContentState();
}

class _NextContentState extends State<NextContent> {
  List<DocumentSummary>? _documents;
  String? _errorMessage;
  String? _userId;

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    final identity = await widget.identityStorage.load();
    if (identity == null) {
      setState(() {
        _errorMessage = 'No identity found on this device.';
      });
      return;
    }
    _userId = identity.userId;
    try {
      final documents = await widget.documentApi.listDocuments(identity.userId);
      if (!mounted) return;
      setState(() {
        _documents = documents;
        _errorMessage = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load documents.';
      });
    }
  }

  Future<void> _upload() async {
    final userId = _userId;
    if (userId == null) return;
    final file = await FilePicker.pickFile();
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final result = await widget.documentApi.uploadDocument(file.name, userId, bytes);
    if (!mounted) return;
    switch (result) {
      case UploadSuccess():
        _loadDocuments();
      case UploadFailure(message: final message):
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Documents',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              IconButton(
                icon: const Icon(Icons.upload_file),
                onPressed: _upload,
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Choose a document to sign.',
            style: TextStyle(fontSize: 16, color: Colors.grey),
          ),
          const SizedBox(height: 20),
          if (_errorMessage != null)
            Expanded(child: Center(child: Text(_errorMessage!)))
          else if (_documents == null)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else
            Expanded(
              child: ListView.separated(
                itemCount: _documents!.length,
                separatorBuilder: (context, index) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final document = _documents![index];
                  return Card(
                    elevation: 1,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: ListTile(
                      leading: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          document.signedByUser ? Icons.lock : Icons.picture_as_pdf,
                          color: Colors.red,
                        ),
                      ),
                      title: Text(document.title),
                      subtitle: Text(document.signedByUser ? 'Signed' : 'Ready for signature'),
                      trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                      onTap: () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => DocumentDetailsPage(
                              documentId: document.id,
                              documentApi: widget.documentApi,
                              identityStorage: widget.identityStorage,
                            ),
                          ),
                        );
                        _loadDocuments();
                      },
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 5: Do not run tests yet**

This test depends on `DocumentDetailsPage` accepting `documentId`/`documentApi`/`identityStorage`, which Task 8 builds. Proceed directly to Task 8 before running `flutter test test/document_selection_test.dart` — Task 8's Step 4 is where this task's test is verified and both tasks are committed together as noted below.

---

### Task 8: Real `DocumentDetailsPage` (signing + read-only state) and `SigningConfirmationPage` navigation fix

**Files:**
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/document_details_page.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/signing_confirmation_page.dart`
- Test: `flutter_digital_sign/test/signing_flow_test.dart` (replace the existing content)

**Interfaces:**
- Consumes: `DocumentApi`, `DocumentDetail`, `SignResult`, `SignSuccess`, `SignFailure` (Task 5), `Ed25519KeyPair.sign` (Task 6), `IdentityStorage` (existing), `FakeDocumentApi` (Task 5, test only), `AppRoutes.next` (existing — used only by `SigningConfirmationPage`'s fixed back button, via `ModalRoute.withName`).
- Produces: `DocumentDetailsPage` (constructor `({required String documentId, DocumentApi? documentApi, IdentityStorage? identityStorage})`). This is what Task 7's `NextContent` already navigates to.

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `flutter_digital_sign/test/signing_flow_test.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/document_details_page.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'core/network/fake_document_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<void> saveIdentity() async {
    await IdentityStorage().save('user-1', [1, 2, 3], [4, 5, 6]);
  }

  testWidgets('shows document details and signs successfully', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId, userId) => DocumentDetail(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-2',
            signatures: [],
            signedByUser: false,
            signingPayload: [1, 2, 3],
          );

    await tester.pumpWidget(
      MaterialApp(
        home: DocumentDetailsPage(
          documentId: 'doc-1',
          documentApi: fakeApi,
          identityStorage: IdentityStorage(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Contract_Proposal.pdf'), findsOneWidget);
    expect(find.text('Confirm Signature'), findsOneWidget);

    await tester.tap(find.text('Confirm Signature'));
    await tester.pumpAndSettle();

    expect(fakeApi.signCalls, hasLength(1));
    expect(fakeApi.signCalls.first.documentId, 'doc-1');
    expect(fakeApi.signCalls.first.userId, 'user-1');
    expect(find.text('Signature Confirmed'), findsOneWidget);
  });

  testWidgets('shows a read-only view for a document already signed by this user', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId, userId) => DocumentDetail(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-2',
            signatures: [DocumentSignature(userId: 'user-1', signedAt: DateTime.utc(2026, 8, 20))],
            signedByUser: true,
            signingPayload: null,
          );

    await tester.pumpWidget(
      MaterialApp(
        home: DocumentDetailsPage(
          documentId: 'doc-1',
          documentApi: fakeApi,
          identityStorage: IdentityStorage(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Confirm Signature'), findsNothing);
    expect(find.textContaining('already signed'), findsOneWidget);
  });

  testWidgets('confirmation page returns to the document list, not Welcome', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId, userId) => DocumentDetail(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-2',
            signatures: [],
            signedByUser: false,
            signingPayload: [1, 2, 3],
          );

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: GlobalKey<NavigatorState>(),
        onGenerateRoute: (settings) {
          if (settings.name == '/next') {
            return MaterialPageRoute(
              settings: settings,
              builder: (_) => const Scaffold(body: Text('Documents')),
            );
          }
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => DocumentDetailsPage(
              documentId: 'doc-1',
              documentApi: fakeApi,
              identityStorage: IdentityStorage(),
            ),
          );
        },
        initialRoute: '/next',
      ),
    );
    await tester.pumpAndSettle();

    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.push(MaterialPageRoute(
      builder: (_) => DocumentDetailsPage(
        documentId: 'doc-1',
        documentApi: fakeApi,
        identityStorage: IdentityStorage(),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Confirm Signature'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Back to Documents'));
    await tester.pumpAndSettle();

    expect(find.text('Documents'), findsOneWidget);
    expect(find.text('Signature Confirmed'), findsNothing);
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/signing_flow_test.dart`
Expected: FAIL — `DocumentDetailsPage` doesn't accept `documentId`/`documentApi`/`identityStorage` yet, and `SigningConfirmationPage`'s back button still pops to `isFirst`.

- [ ] **Step 3: Rewrite `DocumentDetailsPage`**

Replace the entire content of `flutter_digital_sign/lib/features/next/presentation/pages/document_details_page.dart` with:

```dart
import 'package:flutter/material.dart';
import 'signing_confirmation_page.dart';
import '../../../../core/crypto/ed25519_key_pair.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class DocumentDetailsPage extends StatefulWidget {
  final String documentId;
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;

  const DocumentDetailsPage({
    super.key,
    required this.documentId,
    this.documentApi,
    this.identityStorage,
  });

  @override
  State<DocumentDetailsPage> createState() => _DocumentDetailsPageState();
}

class _DocumentDetailsPageState extends State<DocumentDetailsPage> {
  late final DocumentApi _documentApi;
  late final IdentityStorage _identityStorage;
  DocumentDetail? _detail;
  String? _userId;
  String? _errorMessage;
  bool _isSigning = false;

  @override
  void initState() {
    super.initState();
    _documentApi = widget.documentApi ?? HttpDocumentApi();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _load();
  }

  Future<void> _load() async {
    final identity = await _identityStorage.load();
    if (identity == null) {
      setState(() {
        _errorMessage = 'No identity found on this device.';
      });
      return;
    }
    _userId = identity.userId;
    try {
      final detail = await _documentApi.getDocument(widget.documentId, identity.userId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load document.';
      });
    }
  }

  Future<void> _confirmSignature() async {
    final detail = _detail;
    final userId = _userId;
    if (detail == null || userId == null || detail.signingPayload == null) return;

    setState(() {
      _isSigning = true;
      _errorMessage = null;
    });

    final identity = await _identityStorage.load();
    final signatureBytes = await Ed25519KeyPair.sign(
      identity!.privateKeyBytes,
      detail.signingPayload!,
    );

    final result = await _documentApi.submitSignature(widget.documentId, userId, signatureBytes);

    if (!mounted) return;

    switch (result) {
      case SignSuccess():
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => SigningConfirmationPage(documentName: detail.title),
          ),
        );
      case SignFailure(message: final message):
        setState(() {
          _isSigning = false;
          _errorMessage = message;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    Widget body;
    if (detail == null && _errorMessage != null) {
      body = Center(child: Text(_errorMessage!, style: const TextStyle(color: Colors.red)));
    } else if (detail == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.red.shade50,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.picture_as_pdf, size: 48, color: Colors.red),
                const SizedBox(height: 12),
                const Text(
                  'Selected Document',
                  style: TextStyle(fontSize: 14, color: Colors.grey),
                ),
                const SizedBox(height: 8),
                Text(
                  detail.title,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Document Information',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _InfoRow(label: 'Uploader', value: detail.uploaderId),
          _InfoRow(label: 'Signatures', value: '${detail.signatures.length}'),
          if (_errorMessage != null) ...[
            const SizedBox(height: 16),
            Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
          ],
          const Spacer(),
          if (detail.signedByUser)
            const Text(
              'You have already signed this document.',
              style: TextStyle(fontWeight: FontWeight.w600),
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSigning ? null : _confirmSignature,
                child: const Text('Confirm Signature'),
              ),
            ),
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Document Details')),
      body: Padding(padding: const EdgeInsets.all(20.0), child: body),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.grey),
          ),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Fix `SigningConfirmationPage`'s back button**

In `flutter_digital_sign/lib/features/next/presentation/pages/signing_confirmation_page.dart`, add this import at the top:

```dart
import '../../../../app/routes/app_routes.dart';
```

Then change:
```dart
                onPressed: () {
                  Navigator.popUntil(context, (route) => route.isFirst);
                },
```
to:
```dart
                onPressed: () {
                  Navigator.popUntil(context, ModalRoute.withName(AppRoutes.next));
                },
```

- [ ] **Step 5: Run both test files to verify they pass**

Run: `flutter test test/signing_flow_test.dart test/document_selection_test.dart`
Expected: PASS — 5 tests passed (3 from `signing_flow_test.dart`, 2 from `document_selection_test.dart`).

- [ ] **Step 6: Run the full Flutter test suite and static analysis**

Run: `flutter test`
Expected: PASS — every test file passes (registration sub-project's tests, plus this plan's `http_document_api_test.dart`, `ed25519_key_pair_test.dart`'s new case, `document_selection_test.dart`, `signing_flow_test.dart`).

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 7: Manually verify against the real backend**

Make sure the backend is running (from the repo root, `d:\DevProject\DigitalSign`): `npm run dev` (with CORS already enabled from the registration sub-project's verification step).

Run the Flutter app (`flutter run -d chrome` in this environment, since it lacks the Visual Studio C++ workload for `-d windows`; use `-d windows` once that's installed):
```powershell
cd flutter_digital_sign
flutter run -d chrome
```

Expected flow: register or land on the document list (if an identity already exists from the previous sub-project's testing) → tap the upload icon → pick a real file → it appears in the list as "Ready for signature" → tap it → "Confirm Signature" → lands on "Signature Confirmed" → tap "Back to Documents" → lands back on the document list (not Welcome) → the just-signed document now shows "Signed" and, on tapping it again, a read-only view with no "Confirm Signature" button.

Confirm against Postgres:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "SELECT d.title, s.user_id FROM documents d JOIN signatures s ON s.document_id = d.id;"
```
Expected: the uploaded document's title with your user id as a signer.

- [ ] **Step 8: Commit both Task 7 and Task 8 together**

Since Task 7's test could not pass until Task 8's `DocumentDetailsPage` existed, commit both tasks' files in one commit:

```bash
git add flutter_digital_sign/pubspec.yaml flutter_digital_sign/pubspec.lock flutter_digital_sign/lib/features/next/ flutter_digital_sign/test/document_selection_test.dart flutter_digital_sign/test/signing_flow_test.dart
git commit -m "feat: wire document list, details, and signing to the real backend"
```

---

## Post-plan state

After Task 8, the Flutter app has a fully real document lifecycle: users can upload a real file, see a real list of documents from Postgres with per-user "already signed" state, sign using their on-device Ed25519 private key against the backend's existing signature-chain crypto (never reimplementing that hashing logic client-side), and correctly return to the document list after signing instead of bouncing through Welcome. A document the current user has already signed becomes read-only. Document *verification* (the existing `GET /documents/:documentId/verify` chain-integrity check) remains without a dedicated screen — flagged as a future sub-project, as is any multi-user sharing/notification feature.
