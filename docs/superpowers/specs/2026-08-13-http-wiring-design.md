# HTTP Wiring for Upload/Sign/Verify — Design Spec

Date: 2026-08-13
Status: Approved

## Purpose

Wire the three existing use cases (`UploadDocumentUseCase`,
`SignDocumentUseCase`, `VerifyDocumentUseCase`) into the Hono HTTP layer,
using the in-memory `createDependencies()` composition root built in the
prior sub-project. This is the second of two sub-projects needed to get
the backend working end-to-end without a real database; a real database is
explicitly a separate, later sub-project.

## Project Layout

```
src/
  interface-adapters/
    http/
      app.ts                      # MODIFIED: calls createDependencies(), mounts documents routes
      routes/
        health.ts                 # existing, unchanged
        documents.ts               # new: 3 routes
      serialization.ts             # new: toDocumentJson(), toSignatureJson(), base64 helpers
      errorMapping.ts              # new: mapDomainErrorToResponse()
      documents.integration.test.ts # new: end-to-end HTTP tests
```

## Routes

All resource-nested under `/documents`.

**`POST /documents`** (Upload)
- Body: `{ title: string, uploaderId: string, fileBytes: string }` —
  `fileBytes` is base64-encoded.
- On missing/wrong-type fields: `400` with `{ error: { type: "ValidationError", message: "..." } }`.
- Calls `uploadDocumentUseCase.execute({ title, uploaderId, fileBytes: decoded })`.
- Success: `201 Created`, body is `toDocumentJson(document)`.
- Failure: routed through `mapDomainErrorToResponse()`.

**`POST /documents/:documentId/signatures`** (Sign)
- Body: `{ userId: string, signatureBytes: string }` — `signatureBytes` is
  base64-encoded.
- On missing/wrong-type fields: `400`, same shape as above.
- Calls `signDocumentUseCase.execute({ documentId: <from path>, userId, signatureBytes: decoded })`.
- Success: `201 Created`, body is `toSignatureJson(signature)`.
- Failure: routed through `mapDomainErrorToResponse()`.

**`GET /documents/:documentId/verify`** (Verify)
- No body.
- Calls `verifyDocumentUseCase.execute({ documentId: <from path> })`.
- If the result fails with `DocumentNotFoundError`: `404`, via
  `mapDomainErrorToResponse()` (the document genuinely doesn't exist — this
  is the one Verify failure that IS an HTTP error, since there's nothing to
  report on).
- If the result fails with `UserNotFoundError` or `BrokenChainError`: `200 OK`
  with `{ valid: false, reason: error.message }`. These represent "the
  document exists and was checked; the chain isn't valid" — a legitimate
  business answer, not a request-processing failure.
- If the result succeeds: `200 OK` with
  `{ valid: true, signatures: signatures.map(toSignatureJson) }`.

## Serialization (`serialization.ts`)

```ts
function toDocumentJson(document: Document): {
  id: string; title: string; filePath: string; originalHash: string; uploaderId: string
}
// originalHash via document.originalHash.toHex()

function toSignatureJson(signature: Signature): {
  id: string; documentId: string; userId: string; previousSignatureId: string | null;
  signatureData: string; signedAt: string
}
// signatureData via Buffer.from(signature.signatureData.toBytes()).toString('base64')
// signedAt via signature.signedAt.toISOString()

function decodeBase64(value: string): Uint8Array
// via Buffer.from(value, 'base64')
```

## Error Mapping (`errorMapping.ts`)

```ts
function mapDomainErrorToResponse(error: DomainError): { status: number; body: unknown }
```

One shared function, used by both the Upload and Sign route handlers (Verify
handles its own errors specially per the table above, since two of its three
failure modes are NOT HTTP errors). Response body shape:
`{ error: { type: string, message: string } }`, where `type` is
`error.constructor.name` and `message` is `error.message`.

| Error | Status |
|---|---|
| `InvalidDocumentError` | 400 |
| `InvalidValueError` | 400 |
| `InvalidSignatureError` | 400 |
| `DocumentNotFoundError` | 404 |
| `UserNotFoundError` | 404 |
| `DuplicateSignatureError` | 409 |
| `SignatureVerificationFailedError` | 422 |

Any error type not in this table (should not happen given the use cases'
own typed error unions, but included as a safety net) maps to `500` with
`{ error: { type: "InternalError", message: "..." } }`.

## Request Validation

Each route checks required fields are present and are the correct
primitive type (e.g. `title` and `uploaderId` are non-empty strings,
`fileBytes` is a string) before calling its use case. This is boundary
validation — catching malformed HTTP input — not a duplicate of the
domain's own entity validation (which still runs inside the use case and
is still what `mapDomainErrorToResponse` handles for e.g. an empty title
that technically arrives as a valid-shaped string).

## Wiring (`app.ts`)

`app.ts` calls `createDependencies()` once at module load time and passes
the three use-case instances into a `createDocumentsRoutes(dependencies)`
factory (in `routes/documents.ts`), which returns a configured `Hono`
sub-app — mirroring the existing `routes/health.ts` pattern. `app.ts`
mounts it the same way it already mounts `health`.

## Testing

`documents.integration.test.ts`, using Hono's `app.request()` against the
fully composed app (real in-memory adapters from `createDependencies()`,
no mocks — the app under test is exactly what `server.ts` would run).
Exhaustive domain-error coverage already exists at the use-case unit-test
level; these tests confirm the HTTP translation layer itself is correct:

- `POST /documents`: a successful upload (201, correct body shape).
- `POST /documents/:documentId/signatures`: a successful sign, computing a
  valid `signatureBytes` value via `InMemoryCryptoProvider`'s documented
  placeholder scheme (201); one representative error case — signing a
  document that doesn't exist (404).
- `GET /documents/:documentId/verify`: a successful verify after a real
  upload+sign (200, `valid: true`); verifying a document that doesn't
  exist (404); verifying a document with no signatures yet (200,
  `valid: true`, `signatures: []`).

## Out of Scope (future sub-projects)

- Any real database — this sub-project still runs entirely on the
  in-memory `createDependencies()` composition root from the prior
  sub-project.
- Real cryptographic signature verification (still the documented
  placeholder from `InMemoryCryptoProvider`).
- Authentication/authorization on any route (e.g. verifying the caller
  actually is the `uploaderId`/`userId` they claim to be) — not addressed
  by any use case built so far, so not addressed here either.
- CORS, request logging, rate limiting — none of this was in scope for the
  original Hono-skeleton sub-project either, and nothing here changes that.
- The Flutter mobile app — explicitly last per the user's stated build
  order.
