# In-Memory Infrastructure Adapters — Design Spec

Date: 2026-08-13
Status: Approved

## Purpose

Build the first of two sub-projects needed to get SecureDoc Chain's backend
working end-to-end without a real database: concrete, in-memory
implementations of all six use-case-layer ports, plus a composition root
that wires them into ready-to-use `UploadDocumentUseCase`,
`SignDocumentUseCase`, and `VerifyDocumentUseCase` instances.

This sub-project produces no HTTP code. Wiring these use-case instances
into actual Hono routes (error mapping, request/response shapes, the three
endpoints, integration tests) is a separate follow-up sub-project, built on
top of this one.

## Project Layout

```
src/
  infrastructure/
    InMemoryDocumentRepository.ts
    InMemoryDocumentRepository.test.ts
    InMemoryUserRepository.ts
    InMemoryUserRepository.test.ts
    InMemorySignatureRepository.ts
    InMemorySignatureRepository.test.ts
    InMemoryFileStorage.ts
    InMemoryFileStorage.test.ts
    RandomIdGenerator.ts
    RandomIdGenerator.test.ts
    SystemClock.ts
    SystemClock.test.ts
    InMemoryCryptoProvider.ts
    InMemoryCryptoProvider.test.ts
    seedUsers.ts
    composition.ts
    composition.test.ts
```

A new top-level layer, parallel to `domain/`, `use-cases/`, and
`interface-adapters/`.

## Why New Classes Instead Of Reusing The Fakes

`FakeDocumentRepository` etc. (in `domain/testing` and `use-cases/testing`)
already implement every port in-memory. This sub-project builds separate
`InMemory*` classes instead of reusing them directly, even though the logic
is currently very similar, because:
- Test doubles and temporary production infrastructure are conceptually
  different things; a change made for test convenience shouldn't be able to
  silently affect runtime behavior.
- This is the seam that gets swapped for real Postgres-backed adapters
  later — keeping it separate from test code means that swap never touches
  `*.test.ts` files that exercise use cases.

## The Adapters

**`InMemoryDocumentRepository`** (`DocumentRepository`): array-backed.
`save()` appends; `findById()` searches by id, returns `null` if not found.

**`InMemoryUserRepository`** (`UserRepository`): constructed with a list of
seed users (see `seedUsers.ts` below). `findById()` searches that list.

**`InMemorySignatureRepository`** (`SignatureRepository`): array-backed.
`save()` appends; `findByDocumentId()` filters by `documentId`.

**`InMemoryFileStorage`** (`FileStorage`): `Map<string, Uint8Array>`-backed.
`store()` generates a key via `crypto.randomUUID()`, stores the bytes under
it, and returns the key as the `filePath`.

**`RandomIdGenerator`** (`IdGenerator`): `generate()` returns
`crypto.randomUUID()` (Node's built-in `crypto` module — no new
dependency).

**`SystemClock`** (`Clock`): `now()` returns `new Date()`.

**`InMemoryCryptoProvider`** (`CryptoProvider`) — the one adapter needing
care:
- `hash(data)`: real SHA-256, via Node's built-in `crypto` module
  (`createHash('sha256')`), wrapped into the domain's `Hash` value object.
- `verify(publicKey, message, signature)`: **not real cryptography.** A
  clearly-commented placeholder: computes
  `SHA256(publicKey.toBytes() + message.toBytes())` (using the same real
  SHA-256 primitive as `hash()`) and compares it to `signature` via
  `SignatureBytes.equals()`. This is deterministic and independently
  reproducible (useful for later manual/curl testing of the Sign endpoint)
  without pretending to be a real asymmetric signature scheme. A real
  Ed25519 (or similar) `CryptoProvider` is an explicit future sub-project,
  once there's an actual mobile client producing real signatures — building
  it now would mean designing security-critical code with nothing real to
  verify against yet.

**`seedUsers.ts`**: exports a fixed array of 2-3 `User` entities (arbitrary
fixed public-key bytes, since there's no real key generation flow either).
This is what makes it possible to exercise Sign/Verify at all without a
database or a registration endpoint — a gap noted during brainstorming: none
of the three existing use cases can create a `User`.

**`composition.ts`**: exports `createDependencies()`, a single factory
function that constructs all seven adapters, a `SignatureChainService`, and
the three use-case instances, returning them together as one object:
```ts
function createDependencies(): {
  uploadDocumentUseCase: UploadDocumentUseCase
  signDocumentUseCase: SignDocumentUseCase
  verifyDocumentUseCase: VerifyDocumentUseCase
}
```
The follow-up HTTP-wiring sub-project calls this once and hands the three
use-case instances to its route handlers — no route-level wiring logic.

## Testing

Unlike the `Fake*` test doubles (only exercised indirectly through
use-case tests), these are temporary production adapters and get their own
direct unit tests:
- **Repositories**: save-then-find round-trip; find-by-unknown-id/documentId
  returns `null`/`[]`.
- **`InMemoryFileStorage`**: `store()` returns a string key; two calls
  produce different keys.
- **`RandomIdGenerator`**: `generate()` returns a string; two consecutive
  calls differ.
- **`SystemClock`**: `now()` returns a `Date` within a loose tolerance
  (e.g. a few seconds) of the actual current time — the one test
  inherently about wall-clock time.
- **`InMemoryCryptoProvider`**: `hash()` matches a known SHA-256 test
  vector (verified against Node's own `crypto.createHash` independently in
  the test, not by re-deriving the same code path); `verify()` returns
  `true` for a signature computed via the documented placeholder scheme,
  `false` for a mismatched one.
- **`composition.test.ts`**: calls `createDependencies()` and drives a real
  upload through the composed `UploadDocumentUseCase`, confirming the
  adapters interoperate correctly through their real port contracts — a
  smoke test for the wiring itself, independent of HTTP.

## Out of Scope (this sub-project)

- Any HTTP/Hono code — routes, error-to-status mapping, request/response
  shapes. That is the next sub-project, built on top of this one.
- Real cryptographic signature verification (Ed25519 or similar).
- Any real database — this entire sub-project is in-memory and will be
  replaced wholesale once a real database sub-project happens (per the
  user's stated build order: HTTP wiring with in-memory adapters first,
  then a real database, then the Flutter app last).
- A real user-registration flow — `seedUsers.ts` is a fixed, hardcoded
  stand-in.
