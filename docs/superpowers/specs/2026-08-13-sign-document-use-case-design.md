# SignDocumentUseCase — Design Spec

Date: 2026-08-13
Status: Approved

## Purpose

Build the second use case of SecureDoc Chain's use-case layer:
`SignDocumentUseCase`, which lets an authorized user add a cryptographically
verified signature to an existing document's chain. This is the second of
three planned use cases (Upload, Sign, Verify); Verify is out of scope here.

Signing happens on the mobile device using the user's private key (which
never reaches the server, per the domain-core spec). This use case receives
the resulting signature bytes and is responsible for: locating the document
and signer, determining what the new signature chains onto, verifying the
signature against the signer's stored public key, and persisting it — all
before the signature is trusted or stored.

## Project Layout

```
src/
  domain/
    services/
      SignatureChainService.ts   # MODIFIED: add findTip()
      SignatureChainService.test.ts
    errors/
      DocumentNotFoundError.ts       # new
      UserNotFoundError.ts           # new
      SignatureVerificationFailedError.ts  # new
  use-cases/
    ports/
      DocumentRepository.ts      # MODIFIED: add findById()
      UserRepository.ts          # new
      SignatureRepository.ts     # new
      Clock.ts                   # new
    sign-document/
      SignDocumentUseCase.ts
      SignDocumentUseCase.test.ts
    testing/
      FakeDocumentRepository.ts  # MODIFIED: implement findById()
      FakeUserRepository.ts      # new
      FakeSignatureRepository.ts # new
      FakeClock.ts                # new
```

## Domain Layer Change: `SignatureChainService.findTip()`

```ts
findTip(signatures: Signature[]): Signature | null
```

Returns the signature that no other signature in the list points to via
`previousSignatureId` (i.e. the current end of the chain), or `null` if the
list is empty. This is a pure function over the given list — it does not
query storage. It lives in the domain layer (not the use case) because chain
structure is a domain rule, reusable by the future `VerifyDocumentUseCase`.

## New Ports

```ts
interface UserRepository {
  findById(id: string): Promise<User | null>
}

interface SignatureRepository {
  findByDocumentId(documentId: string): Promise<Signature[]>
  save(signature: Signature): Promise<void>
}

interface Clock {
  now(): Date
}
```

`DocumentRepository` (existing, from the Upload sub-project) gains:
```ts
findById(id: string): Promise<Document | null>
```
Upload only ever needed `save()`; Sign is the first consumer of a read path.

`Clock` exists for the same reason `IdGenerator` exists: `signedAt` is a
hidden non-deterministic dependency (`new Date()`) unless it's injected and
fakeable in tests.

## `SignDocumentUseCase`

**Input:**
```ts
interface SignDocumentInput {
  documentId: string
  userId: string
  signatureBytes: Uint8Array
}
```

**`execute(input: SignDocumentInput): Promise<Result<Signature, SignDocumentError>>`**

where `SignDocumentError` is the union of errors this use case can return:
`DocumentNotFoundError | UserNotFoundError | DuplicateSignatureError |
InvalidValueError | SignatureVerificationFailedError | InvalidSignatureError`.

Steps:
1. `document = await documentRepository.findById(input.documentId)`. If
   `null`, return `Result.fail(new DocumentNotFoundError(input.documentId))`.
2. `user = await userRepository.findById(input.userId)`. If `null`, return
   `Result.fail(new UserNotFoundError(input.userId))`.
3. `existingSignatures = await signatureRepository.findByDocumentId(input.documentId)`.
4. `signatureChainService.assertCanSign(document, existingSignatures, input.userId)`.
   If it fails, propagate its `DuplicateSignatureError` as-is.
5. `previousSignature = signatureChainService.findTip(existingSignatures)`.
6. `SignatureBytes.create(input.signatureBytes)`. If it fails, propagate its
   `InvalidValueError` as-is.
7. `message = signatureChainService.buildSigningPayload(document, previousSignature)`.
8. `crypto.verify(user.publicKey, message, signatureBytesResult.value)`. If
   `false`, return `Result.fail(new SignatureVerificationFailedError(input.userId, input.documentId))`.
9. `Signature.create({ id: idGenerator.generate(), documentId: document.id, userId: user.id, previousSignatureId: previousSignature?.id ?? null, signatureData: signatureBytesResult.value, signedAt: clock.now() })`.
   If it fails, propagate its `InvalidSignatureError` as-is.
10. `await signatureRepository.save(signatureResult.value)`, then return
    `Result.ok(signatureResult.value)`.

Constructor dependencies: `CryptoProvider`, `IdGenerator`, `Clock`,
`DocumentRepository`, `UserRepository`, `SignatureRepository`,
`SignatureChainService` — all injected.

## Error Handling

- Same convention as Upload: `Result` covers expected domain/business
  outcomes only. Three of those outcomes are new to this use case —
  "document not found," "user not found," and "signature verification
  failed" — none of which fit an existing domain error, so three new error
  classes are added, all extending `DomainError` like every other domain
  error:
  - `DocumentNotFoundError(documentId: string)`
  - `UserNotFoundError(userId: string)`
  - `SignatureVerificationFailedError(userId: string, documentId: string)`
- Infrastructure failures (repository methods rejecting) are not wrapped —
  same as Upload, deferred to a future error-handling sub-project.

## Testing

- `SignDocumentUseCase.test.ts`, colocated with the use case.
- New fakes: `FakeUserRepository`, `FakeSignatureRepository`, `FakeClock`.
  `FakeDocumentRepository` (from Upload) is extended to implement
  `findById()`.
- `SignatureChainService.findTip()` gets its own unit tests in
  `SignatureChainService.test.ts` (empty list → `null`, single signature →
  itself, multi-signature chain → the one nothing points to).
- Coverage target for the use case: successful first-signer flow (no prior
  signatures, chains onto the document hash), successful subsequent-signer
  flow (chains onto the existing tip), duplicate-signer rejection,
  document-not-found, user-not-found, malformed `signatureBytes`, and failed
  cryptographic verification (signature doesn't match payload/public key).

## Out of Scope (future sub-projects)

- `VerifyDocumentUseCase`.
- Concrete adapters for `UserRepository`, `SignatureRepository`, `Clock`,
  and `DocumentRepository.findById()` (e.g. Postgres-backed repositories,
  a real system clock).
- Wiring this use case into the Hono HTTP layer.
- Any mechanism for the mobile client to discover the current chain tip
  before signing (needed so its locally-computed signature matches what the
  server will verify) — that's an HTTP/API design concern, not this use
  case's.
