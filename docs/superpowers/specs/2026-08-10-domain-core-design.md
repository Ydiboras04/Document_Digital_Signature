# Domain Core — Design Spec

Date: 2026-08-10
Status: Approved

## Purpose

Build the Domain Core layer of SecureDoc Chain's Clean Architecture backend: the
entities and business rules for users, documents, and chained multi-signatures.
This layer has no dependency on the database, HTTP framework, or any specific
crypto library implementation — it is pure TypeScript, independently testable.

This is the first sub-project of the backend; use cases, controllers, and
infrastructure (Hono, PostgreSQL, concrete crypto provider) are out of scope
and will follow in later design/plan cycles.

## Project Layout

Single backend folder at the repo root (no monorepo/workspaces yet):

```
src/
  domain/
    entities/
      User.ts
      Document.ts
      Signature.ts
    value-objects/
      Hash.ts
      PublicKey.ts
      SignatureBytes.ts
    services/
      SignatureChainService.ts
    ports/
      CryptoProvider.ts
    errors/
      DomainError.ts
      InvalidDocumentError.ts
      InvalidSignatureError.ts
      DuplicateSignatureError.ts
      BrokenChainError.ts
      ...
    result/
      Result.ts
```

## Entities & Value Objects

All entities and value objects are immutable and are constructed only through
static `create(...)` factory methods that return `Result<T, DomainError>`.
Constructors are private, so invalid instances cannot exist.

- **User**: `id`, `username`, `email`, `publicKey: PublicKey`.
- **Document**: `id`, `title`, `filePath`, `originalHash: Hash`, `uploaderId`.
- **Signature**: `id`, `documentId`, `userId`, `previousSignatureId: string | null`,
  `signatureData: SignatureBytes`, `signedAt: Date`.
- **Hash** (value object): wraps validated hash bytes/hex string; equality by value.
- **PublicKey** (value object): wraps validated public key bytes/encoding.
- **SignatureBytes** (value object): wraps validated signature output bytes.

Value object `create()` factories validate format (non-empty, correct
encoding/length for the expected algorithm) and reject malformed input via
`Result.fail`.

## Domain Rules — `SignatureChainService`

The service is stateless; callers (future use-cases) pass in the document and
the document's existing signatures — the domain layer never queries storage
itself.

1. **Duplicate prevention**: `assertCanSign(document, existingSignatures, userId)`
   returns `Result.fail(new DuplicateSignatureError(...))` if `userId` already
   has a signature in `existingSignatures` for this document.

2. **No enforced signer order**: any authorized user may sign at any time.
   A new signature always chains onto whatever is currently the chain's tip
   (the most recently added signature for that document), or directly onto
   the document hash if no signatures exist yet.

3. **Signing payload construction** — `buildSigningPayload(document, previousSignature)`:
   - First signer: `message = hash(document.originalHash)`.
   - Subsequent signers: `message = hash(document.originalHash + previousSignature.signatureData)`.
   - This uses `CryptoProvider.hash()`. The resulting `Hash` is what the mobile
     client (or, for verification, the server) feeds into sign/verify.

4. **Chain verification** — `verifyChain(document, orderedSignatures, publicKeysByUserId)`:
   - Walks the chain from first to last signature.
   - For each signature, recomputes the expected message per rule 3, then
     calls `CryptoProvider.verify(publicKey, message, signature.signatureData)`.
   - Returns `Result.ok(true)` if every link verifies.
   - Returns `Result.fail(new BrokenChainError(signatureId, ...))` identifying
     the first signature that fails verification (either bad crypto or a
     `previousSignatureId` that doesn't match the actual chain order).

## Ports

```ts
interface CryptoProvider {
  hash(data: Uint8Array): Hash
  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean
}
```

`sign()` is intentionally excluded from this port. Signing happens on the
mobile device using the user's private key, which never leaves the device or
reaches the server. The backend domain only ever verifies signatures; a
concrete `CryptoProvider` implementation (e.g. wrapping Node's `crypto` or a
library such as `@noble/ed25519`) is infrastructure, built in a later phase.

## Error Handling

- No exceptions are thrown across the domain boundary. Every fallible domain
  operation returns `Result<T, DomainError>`.
- `DomainError` is an abstract base class; concrete subclasses carry whatever
  context is useful for the caller (e.g. `BrokenChainError` carries the
  offending `signatureId`).
- `Result<T, E>` is a small local implementation (`ok`/`fail` static
  constructors, `isOk`/`isFail`, `value`/`error` accessors) — no external
  dependency.

## Testing

- Unit tests colocated with source (e.g. `Signature.test.ts` next to
  `Signature.ts`).
- Pure unit tests, no I/O. `CryptoProvider` is faked/mocked in tests that
  exercise `SignatureChainService`.
- Coverage target: every domain rule above (duplicate signing, first-signer
  vs subsequent-signer payload construction, chain verification success, and
  each way chain verification can fail) has at least one test.

## Out of Scope (future sub-projects)

- Use cases (Upload, Sign, Verify) that orchestrate the domain against real
  storage.
- Hono controllers / HTTP layer.
- PostgreSQL repositories / ORM mappings.
- Concrete `CryptoProvider` implementation.
- Flutter mobile app.
