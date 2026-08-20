# HTTP Wiring for Upload/Sign/Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `UploadDocumentUseCase`, `SignDocumentUseCase`, and `VerifyDocumentUseCase` into three real Hono HTTP routes, backed by the existing in-memory `createDependencies()` composition root, with serialization helpers, a shared error-to-HTTP-status mapping, and end-to-end integration tests.

**Architecture:** Two small pure-function modules (`serialization.ts`, `errorMapping.ts`) that the route handlers depend on, plus a `routes/documents.ts` factory function (mirroring the existing `routes/health.ts` pattern) mounted onto `app.ts`, which now calls `createDependencies()` once at module load.

**Tech Stack:** TypeScript (existing), Hono (existing), Vitest (existing), Node's built-in `Buffer` for base64 encode/decode. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-http-wiring-design.md`

## Global Constraints

- No real database — routes run entirely on the in-memory `createDependencies()` from the prior sub-project.
- No real cryptography — signature verification is still `InMemoryCryptoProvider`'s documented placeholder scheme.
- Binary data (`fileBytes`, `signatureBytes`) travels as base64 strings in JSON request bodies, and `signatureData` comes back as base64 in JSON responses — per the earlier decision, no multipart/form-data.
- `GET /documents/:documentId/verify` always returns `200` if the document exists, even when the chain is invalid — `{ valid: false, reason }` is a legitimate answer, not an HTTP error. Only `DocumentNotFoundError` on Verify maps to an HTTP error (`404`).
- `mapDomainErrorToResponse()` is shared by the Upload and Sign routes only — Verify handles `DocumentNotFoundError` through it too, but handles `UserNotFoundError`/`BrokenChainError` itself (see routes task).
- Hono's `c.json(body, status)` requires `status` to be a `ContentfulStatusCode` (from `hono/utils/http-status`), not a plain `number` — verified against the installed Hono version. `mapDomainErrorToResponse()`'s return type must use this type, not `number`, to avoid an `any` cast at call sites.
- All new files use explicit `.js` extensions on relative imports, per the established convention.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source.

---

### Task 1: Serialization helpers

**Files:**
- Create: `src/interface-adapters/http/serialization.ts`
- Test: `src/interface-adapters/http/serialization.test.ts`

**Interfaces:**
- Consumes: `Document`, `Signature` entities (existing, from `src/domain/entities/`).
- Produces: `toDocumentJson(document: Document): DocumentJson`, `toSignatureJson(signature: Signature): SignatureJson`, `decodeBase64(value: string): Uint8Array`, and the `DocumentJson`/`SignatureJson` interfaces:
  ```ts
  interface DocumentJson {
    id: string; title: string; filePath: string; originalHash: string; uploaderId: string
  }
  interface SignatureJson {
    id: string; documentId: string; userId: string; previousSignatureId: string | null;
    signatureData: string; signedAt: string
  }
  ```
  Task 3's routes use all of these.

- [ ] **Step 1: Write the failing tests**

Create `src/interface-adapters/http/serialization.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toDocumentJson, toSignatureJson, decodeBase64 } from './serialization.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

describe('toDocumentJson', () => {
  it('serializes a Document with hex-encoded originalHash', () => {
    const document = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: 'file-key-1',
      originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
      uploaderId: 'user-1'
    }).value

    const json = toDocumentJson(document)

    expect(json).toEqual({
      id: 'doc-1',
      title: 'Contract',
      filePath: 'file-key-1',
      originalHash: '05'.repeat(32),
      uploaderId: 'user-1'
    })
  })
})

describe('toSignatureJson', () => {
  it('serializes a Signature with base64 signatureData and ISO signedAt', () => {
    const signature = Signature.create({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value

    const json = toSignatureJson(signature)

    expect(json).toEqual({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: Buffer.from([1, 2, 3]).toString('base64'),
      signedAt: '2026-08-10T00:00:00.000Z'
    })
  })
})

describe('decodeBase64', () => {
  it('round-trips bytes through base64 encoding and decoding', () => {
    const original = new Uint8Array([10, 20, 30, 255])
    const encoded = Buffer.from(original).toString('base64')

    const decoded = decodeBase64(encoded)

    expect(decoded).toEqual(original)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- serialization.test.ts`
Expected: FAIL — `Cannot find module './serialization.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/interface-adapters/http/serialization.ts`:

```ts
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'

export interface DocumentJson {
  id: string
  title: string
  filePath: string
  originalHash: string
  uploaderId: string
}

export interface SignatureJson {
  id: string
  documentId: string
  userId: string
  previousSignatureId: string | null
  signatureData: string
  signedAt: string
}

export function toDocumentJson(document: Document): DocumentJson {
  return {
    id: document.id,
    title: document.title,
    filePath: document.filePath,
    originalHash: document.originalHash.toHex(),
    uploaderId: document.uploaderId
  }
}

export function toSignatureJson(signature: Signature): SignatureJson {
  return {
    id: signature.id,
    documentId: signature.documentId,
    userId: signature.userId,
    previousSignatureId: signature.previousSignatureId,
    signatureData: Buffer.from(signature.signatureData.toBytes()).toString('base64'),
    signedAt: signature.signedAt.toISOString()
  }
}

export function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- serialization.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/interface-adapters/http/serialization.ts src/interface-adapters/http/serialization.test.ts
git commit -m "feat: add HTTP serialization helpers for Document and Signature"
```

---

### Task 2: Error mapping

**Files:**
- Create: `src/interface-adapters/http/errorMapping.ts`
- Test: `src/interface-adapters/http/errorMapping.test.ts`

**Interfaces:**
- Consumes: `DomainError` and its subclasses (existing, from `src/domain/errors/`); `ContentfulStatusCode` type from `hono/utils/http-status`.
- Produces: `ErrorResponse` interface (`{ status: ContentfulStatusCode; body: { error: { type: string; message: string } } }`) and `mapDomainErrorToResponse(error: DomainError): ErrorResponse`. Task 3's routes use this for Upload, Sign, and the `DocumentNotFoundError` case of Verify.

- [ ] **Step 1: Write the failing tests**

Create `src/interface-adapters/http/errorMapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapDomainErrorToResponse } from './errorMapping.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'
import { BrokenChainError } from '../../domain/errors/BrokenChainError.js'

describe('mapDomainErrorToResponse', () => {
  it('maps InvalidDocumentError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidDocumentError('title must not be empty'))
    expect(result.status).toBe(400)
    expect(result.body.error.type).toBe('InvalidDocumentError')
    expect(result.body.error.message).toContain('title must not be empty')
  })

  it('maps InvalidValueError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidValueError('SignatureBytes', 'must not be empty'))
    expect(result.status).toBe(400)
  })

  it('maps InvalidSignatureError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidSignatureError('id must not be empty'))
    expect(result.status).toBe(400)
  })

  it('maps DocumentNotFoundError to 404', () => {
    const result = mapDomainErrorToResponse(new DocumentNotFoundError('doc-1'))
    expect(result.status).toBe(404)
    expect(result.body.error.type).toBe('DocumentNotFoundError')
  })

  it('maps UserNotFoundError to 404', () => {
    const result = mapDomainErrorToResponse(new UserNotFoundError('user-1'))
    expect(result.status).toBe(404)
  })

  it('maps DuplicateSignatureError to 409', () => {
    const result = mapDomainErrorToResponse(new DuplicateSignatureError('user-1'))
    expect(result.status).toBe(409)
  })

  it('maps SignatureVerificationFailedError to 422', () => {
    const result = mapDomainErrorToResponse(new SignatureVerificationFailedError('user-1', 'doc-1'))
    expect(result.status).toBe(422)
  })

  it('maps an unrecognized DomainError to 500', () => {
    const result = mapDomainErrorToResponse(new BrokenChainError('sig-1', 'cryptographic verification failed'))
    expect(result.status).toBe(500)
    expect(result.body.error.type).toBe('BrokenChainError')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- errorMapping.test.ts`
Expected: FAIL — `Cannot find module './errorMapping.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/interface-adapters/http/errorMapping.ts`:

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DomainError } from '../../domain/errors/DomainError.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'

export interface ErrorResponse {
  status: ContentfulStatusCode
  body: { error: { type: string; message: string } }
}

export function mapDomainErrorToResponse(error: DomainError): ErrorResponse {
  return {
    status: statusForError(error),
    body: { error: { type: error.constructor.name, message: error.message } }
  }
}

function statusForError(error: DomainError): ContentfulStatusCode {
  if (error instanceof InvalidDocumentError) return 400
  if (error instanceof InvalidValueError) return 400
  if (error instanceof InvalidSignatureError) return 400
  if (error instanceof DocumentNotFoundError) return 404
  if (error instanceof UserNotFoundError) return 404
  if (error instanceof DuplicateSignatureError) return 409
  if (error instanceof SignatureVerificationFailedError) return 422
  return 500
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- errorMapping.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/interface-adapters/http/errorMapping.ts src/interface-adapters/http/errorMapping.test.ts
git commit -m "feat: add domain-error-to-HTTP-response mapping"
```

---

### Task 3: Documents routes, wiring, and integration tests

**Files:**
- Create: `src/interface-adapters/http/routes/documents.ts`
- Modify: `src/interface-adapters/http/app.ts`
- Test: `src/interface-adapters/http/documents.integration.test.ts`

**Interfaces:**
- Consumes: `Dependencies` type and `createDependencies()` from `src/infrastructure/composition.ts` (existing); `toDocumentJson`, `toSignatureJson`, `decodeBase64` (Task 1); `mapDomainErrorToResponse` (Task 2); `DocumentNotFoundError` (existing); `InMemoryCryptoProvider` and `PublicKey` (existing, used only in the integration test to compute valid signatures).
- Produces: `createDocumentsRoutes(dependencies: Dependencies): Hono` — a factory function returning a configured `Hono` sub-app with the three routes registered. Nothing later in this plan depends on it; `app.ts` mounts it directly.

- [ ] **Step 1: Write the failing integration tests**

Create `src/interface-adapters/http/documents.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { app } from './app.js'
import { InMemoryCryptoProvider } from '../../infrastructure/InMemoryCryptoProvider.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'

async function uploadADocument() {
  const res = await app.request('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: Buffer.from('hello world').toString('base64')
    })
  })
  return res.json()
}

function computeAliceSignatureBytes(originalHashHex: string): Uint8Array {
  const crypto = new InMemoryCryptoProvider()
  const message = crypto.hash(Buffer.from(originalHashHex, 'hex'))
  const alicePublicKey = PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
  const combined = new Uint8Array(alicePublicKey.toBytes().length + message.toBytes().length)
  combined.set(alicePublicKey.toBytes(), 0)
  combined.set(message.toBytes(), alicePublicKey.toBytes().length)
  return crypto.hash(combined).toBytes()
}

describe('POST /documents', () => {
  it('uploads a document and returns 201 with the serialized document', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Contract',
        uploaderId: 'user-alice',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Contract')
    expect(body.uploaderId).toBe('user-alice')
    expect(typeof body.id).toBe('string')
    expect(typeof body.originalHash).toBe('string')
  })
})

describe('POST /documents/:documentId/signatures', () => {
  it('signs an uploaded document and returns 201 with the serialized signature', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)

    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signatureBytes: Buffer.from(signatureBytes).toString('base64')
      })
    })

    expect(signRes.status).toBe(201)
    const signature = await signRes.json()
    expect(signature.documentId).toBe(document.id)
    expect(signature.userId).toBe('user-alice')
    expect(signature.previousSignatureId).toBeNull()
  })

  it('returns 404 when signing a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signatureBytes: Buffer.from([1, 2, 3]).toString('base64')
      })
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })
})

describe('GET /documents/:documentId/verify', () => {
  it('returns valid: true with the signature chain after a real upload and sign', async () => {
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

    const verifyRes = await app.request(`/documents/${document.id}/verify`)

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toHaveLength(1)
  })

  it('returns 404 when verifying a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/verify')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })

  it('returns valid: true with an empty signatures array for a document with no signatures yet', async () => {
    const document = await uploadADocument()

    const verifyRes = await app.request(`/documents/${document.id}/verify`)

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- documents.integration.test.ts`
Expected: FAIL — `/documents` returns Hono's default 404 (route doesn't exist yet), so the first assertion (`res.status` toBe `201`) fails.

- [ ] **Step 3: Write the routes**

Create `src/interface-adapters/http/routes/documents.ts`:

```ts
import { Hono } from 'hono'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { toDocumentJson, toSignatureJson, decodeBase64 } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'
import { DocumentNotFoundError } from '../../../domain/errors/DocumentNotFoundError.js'

export function createDocumentsRoutes(dependencies: Dependencies): Hono {
  const documents = new Hono()

  documents.post('/documents', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      body === null ||
      typeof body.title !== 'string' ||
      typeof body.uploaderId !== 'string' ||
      typeof body.fileBytes !== 'string'
    ) {
      return c.json(
        { error: { type: 'ValidationError', message: 'title, uploaderId, and fileBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.uploadDocumentUseCase.execute({
      title: body.title,
      uploaderId: body.uploaderId,
      fileBytes: decodeBase64(body.fileBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentJson(result.value), 201)
  })

  documents.post('/documents/:documentId/signatures', async (c) => {
    const documentId = c.req.param('documentId')
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.userId !== 'string' || typeof body.signatureBytes !== 'string') {
      return c.json(
        { error: { type: 'ValidationError', message: 'userId and signatureBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.signDocumentUseCase.execute({
      documentId,
      userId: body.userId,
      signatureBytes: decodeBase64(body.signatureBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toSignatureJson(result.value), 201)
  })

  documents.get('/documents/:documentId/verify', async (c) => {
    const documentId = c.req.param('documentId')

    const result = await dependencies.verifyDocumentUseCase.execute({ documentId })

    if (result.isFail()) {
      const error = result.error
      if (error instanceof DocumentNotFoundError) {
        const { status, body: errorBody } = mapDomainErrorToResponse(error)
        return c.json(errorBody, status)
      }
      return c.json({ valid: false, reason: error.message }, 200)
    }

    return c.json({ valid: true, signatures: result.value.map(toSignatureJson) }, 200)
  })

  return documents
}
```

- [ ] **Step 4: Wire the routes into app.ts**

Modify `src/interface-adapters/http/app.ts` to:

```ts
import { Hono } from 'hono'
import { health } from './routes/health.js'
import { createDocumentsRoutes } from './routes/documents.js'
import { createDependencies } from '../../infrastructure/composition.js'

export const app = new Hono()

const dependencies = createDependencies()

app.route('/', health)
app.route('/', createDocumentsRoutes(dependencies))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- documents.integration.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all previously-passing tests still pass, plus this plan's new tests — total test count increases by 17 from wherever it started (95 + 3 serialization + 8 error mapping + 6 integration = 112).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 8: Manually verify with the running dev server**

Run: `npm run dev`

In a separate terminal:
```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Contract","uploaderId":"user-alice","fileBytes":"aGVsbG8gd29ybGQ="}'
```
Expected: `201` with a JSON body containing `id`, `title: "Contract"`, `originalHash`, `uploaderId: "user-alice"`.

Then:
```bash
curl http://localhost:3000/documents/missing-doc/verify
```
Expected: `404` with `{"error":{"type":"DocumentNotFoundError","message":"..."}}`.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 9: Commit**

```bash
git add src/interface-adapters/http/routes/documents.ts src/interface-adapters/http/app.ts src/interface-adapters/http/documents.integration.test.ts
git commit -m "feat: wire Upload/Sign/Verify use cases into HTTP routes"
```

---

## Post-plan state

After Task 3, the backend is fully working end-to-end without a real database: `npm run dev` starts a server where `POST /documents`, `POST /documents/:documentId/signatures`, and `GET /documents/:documentId/verify` all work against real (in-memory) storage, 3 seeded users, real SHA-256 hashing, and a documented placeholder signature scheme. `npm test` / `npm run typecheck` both pass. Per the user's stated build order, the next sub-project is a real database (replacing the in-memory adapters), with the Flutter mobile app explicitly last.
