# VerifyDocumentUseCase — Design Spec

Date: 2026-08-13
Status: Approved

## Purpose

Build the third and final use case of SecureDoc Chain's initial use-case
layer decomposition: `VerifyDocumentUseCase`, which reconstructs a
document's signature chain in causal order and cryptographically verifies
every link, returning the full verified chain. This completes the
Upload → Sign → Verify sequence; no further use cases are planned in this
decomposition.

## Project Layout

```
src/
  domain/
    services/
      SignatureChainService.ts       # MODIFIED: add orderChain()
      SignatureChainService.test.ts
  use-cases/
    verify-document/
      VerifyDocumentUseCase.ts
      VerifyDocumentUseCase.test.ts
```

No new ports and no new fakes — `DocumentRepository`, `SignatureRepository`,
and `UserRepository` (all from the Upload/Sign sub-projects) already expose
everything this use case needs (`findById`, `findByDocumentId`).

## Domain Layer Change: `SignatureChainService.orderChain()`

```ts
orderChain(signatures: Signature[]): Result<Signature[], BrokenChainError>
```

Reconstructs causal order (first signer to last) from an unordered list of
a document's signatures, by walking `previousSignatureId` links forward
from the chain head. Reuses the existing `BrokenChainError` — no new error
type is introduced for this.

This exists because `SignatureChainService.verifyChain()` (built in
domain-core) expects its `orderedSignatures` argument already in causal
order, but `SignatureRepository.findByDocumentId()` returns signatures in
whatever order storage gives back. Naively walking from the head and
stopping when the trail runs out would silently drop any signature that
isn't reachable from the head — which would let `verifyChain()` report a
document as fully verified while inconsistent or extra signatures sit
unexamined in storage. `orderChain()` guards against that: it fails rather
than silently ignoring anything.

Behavior:
- Empty input → `Result.ok([])` (vacuously valid, nothing to order).
- Exactly one signature with `previousSignatureId === null` is required as
  the chain head. Zero or more than one → `Result.fail(BrokenChainError)`.
- Walking forward via a reverse index (`previousSignatureId` → next
  signature): if a cycle is detected before every input signature has been
  visited, or if any signature turns out unreachable from the head once the
  walk terminates, → `Result.fail(BrokenChainError)`.
- Otherwise → `Result.ok(orderedSignatures)`, where `orderedSignatures` has
  the same elements as the input, in causal order.

## `VerifyDocumentUseCase`

**Input:**
```ts
interface VerifyDocumentInput {
  documentId: string
}
```

**`execute(input: VerifyDocumentInput): Promise<Result<Signature[], VerifyDocumentError>>`**

where `VerifyDocumentError = DocumentNotFoundError | UserNotFoundError | BrokenChainError`
— entirely reused domain errors; no new error class is introduced for the
use case itself.

Steps:
1. `document = await documentRepository.findById(input.documentId)`. If
   `null`, return `Result.fail(new DocumentNotFoundError(input.documentId))`.
2. `signatures = await signatureRepository.findByDocumentId(input.documentId)`.
3. `orderedResult = signatureChainService.orderChain(signatures)`. If it
   fails, propagate its `BrokenChainError` as-is.
4. For each unique `userId` among `orderedResult.value`, look up the user
   via `userRepository.findById(userId)`. If any lookup returns `null`,
   return `Result.fail(new UserNotFoundError(userId))` immediately (fail
   fast, don't continue collecting). Otherwise collect into
   `publicKeysByUserId: Map<string, PublicKey>`. This is a loop of
   individual `findById()` calls, not a batch lookup — consistent with the
   Sign sub-project's YAGNI decision not to add a batch method until
   there's a concrete need.
5. `signatureChainService.verifyChain(document, orderedResult.value, publicKeysByUserId)`.
   If it fails, propagate its `BrokenChainError` as-is.
6. Return `Result.ok(orderedResult.value)` — the full, verified, ordered
   chain of signatures. (An empty array for a document with no signatures
   yet — verification is vacuously successful in that case.)

Constructor dependencies: `DocumentRepository`, `SignatureRepository`,
`UserRepository`, `SignatureChainService` — all injected. No `CryptoProvider`,
`IdGenerator`, or `Clock` needed — this use case reads and verifies, it
never writes or generates anything.

## Error Handling

- Same convention as Upload and Sign: `Result` covers expected
  domain/business outcomes only. Every outcome this use case can produce
  reuses an existing domain error (`DocumentNotFoundError`,
  `UserNotFoundError` from the Sign sub-project; `BrokenChainError` from
  domain-core, now also returned by `orderChain()`).
- Infrastructure failures (repository methods rejecting) are not wrapped —
  same as Upload and Sign.

## Testing

- `SignatureChainService.orderChain()` gets its own unit tests in
  `SignatureChainService.test.ts`: empty list, already-ordered input,
  shuffled input (order-independence, same idea as `findTip()`'s test),
  missing head (no signature with `previousSignatureId === null`),
  multiple heads (more than one), a cycle, and an orphaned signature
  (unreachable from the head).
- `VerifyDocumentUseCase.test.ts`, colocated with the use case. Coverage
  target: a valid multi-signer chain (verifies successfully, returns the
  ordered list), an empty chain (no signatures yet, returns `Result.ok([])`),
  document not found, user not found (a signer's account is missing), and a
  broken chain (reusing `orderChain`'s/`verifyChain`'s existing failure
  modes — e.g. a tampered signature).

## Out of Scope (future sub-projects)

- Concrete adapters for any port (Postgres repositories, etc.).
- Wiring this use case into the Hono HTTP layer.
- Any richer verification report format (e.g. per-signer status, partial
  verification) — `execute()` is all-or-nothing: either the whole chain
  verifies or a single `Result.fail` is returned identifying the first
  problem found.
