# Real Ed25519 CryptoProvider — Design Spec

Date: 2026-08-20
Status: Approved

## Purpose

Replace the placeholder `verify()` implementation (a non-cryptographic
`SHA256(publicKey + message)` comparison, documented as a known limitation
since the in-memory infrastructure sub-project) with real Ed25519
signature verification, using Node's built-in `crypto` module — no new
dependency. This is the first of the two remaining backend gaps identified
after the Postgres migration (the other, real `FileStorage` persistence,
is a separate future sub-project).

## Scope

This sub-project only touches `hash()`/`verify()` and their consumers.
`hash()` itself is unchanged — it was already real SHA-256. `sign()`
remains intentionally absent from the `CryptoProvider` port; signing only
ever happens client-side (mobile app, not built yet), matching the
domain-core design.

## Domain Layer Change: Exact-Size Validation

`PublicKey.create()` now requires exactly 32 bytes (Ed25519 public key
size); `SignatureBytes.create()` now requires exactly 64 bytes (Ed25519
signature size) — mirroring `Hash.create()`'s existing exact-32-byte
pattern for SHA-256. Malformed input now fails fast at the domain boundary
with a clear `InvalidValueError`, instead of only surfacing as an opaque
error deep inside Node's crypto calls.

**Consequence:** every existing test fixture that constructed a
`PublicKey`/`SignatureBytes` from an arbitrary short byte array (e.g.
`[1, 2, 3]`, `[1, 2, 3, 4]`) — used purely for fixture convenience, with no
relation to real key sizes — now fails validation. This affects roughly 20
call sites across domain, use-case, infrastructure, and HTTP-layer test
files. All of these fixes are mechanical (lengthen the array / change the
`.fill()` value, no logic changes) — confirmed via a full-codebase grep
before this spec was written, listed file-by-file in the implementation
plan.

## Ed25519CryptoProvider (renamed from InMemoryCryptoProvider)

```
src/infrastructure/Ed25519CryptoProvider.ts       # was InMemoryCryptoProvider.ts
src/infrastructure/Ed25519CryptoProvider.test.ts  # was InMemoryCryptoProvider.test.ts
```

- `hash(data)`: unchanged — real SHA-256 via `node:crypto`'s `createHash`.
- `verify(publicKey, message, signature)`: real Ed25519 verification.
  Bridges the domain's raw-bytes value objects to Node's `crypto.verify()`
  by wrapping the raw 32-byte public key as a JWK
  (`{ kty: 'OKP', crv: 'Ed25519', x: base64url(publicKey.toBytes()) }`) and
  constructing a `KeyObject` via `crypto.createPublicKey()`, then calling
  `crypto.verify(null, message.toBytes(), keyObject, signature.toBytes())`
  — `null` as the algorithm is the standard Node idiom for EdDSA, which has
  its own built-in hashing and doesn't take a separate digest algorithm.

The rename reflects that neither half of this class is a
placeholder/in-memory concept anymore — `hash()` never was, and `verify()`
stops being one after this sub-project.

## Test Key Fixtures (new)

```
src/infrastructure/testing/ed25519TestKeys.ts
```

Follows the existing `domain/testing`/`use-cases/testing` convention for
test-support code. Contains 3 real, generated Ed25519 key pairs — one per
seed user (`alice`, `bob`, `carol`) — plus a `signWithTestKey()` helper
that reconstructs a private `KeyObject` from the fixture's raw key
material (same JWK-wrapping approach as `Ed25519CryptoProvider.verify()`,
mirrored for signing) and calls `crypto.sign(null, message, privateKey)`.

This is test-only infrastructure, analogous to how `FakeCryptoProvider`
(a separate, unrelated domain-layer test double) already has a `sign()`
method that the real `CryptoProvider` port doesn't — `signWithTestKey()`
exists purely so tests and manual/curl verification can produce valid
signatures to check `verify()` against, since production code never signs
anything server-side.

**On committing private key material:** these are clearly-labeled,
generated-for-this-purpose test keys with zero relationship to any real
user's actual key material (no real user exists yet — there's no mobile
app). This is standard practice for cryptography test fixtures. Anyone
with repo access can already read them; they secure nothing.

## Seed Data

`seed.ts` and `testSupport.ts`'s `ensureSeedUsers()` are updated to use the
real public keys from `ed25519TestKeys.ts` instead of the old placeholder
bytes (`[1,2,3,4]` etc.). `PostgresUserRepository.test.ts`'s assertion on
`user-alice`'s public key bytes is updated to match.

## Composition Root and Integration Tests

- `composition.ts`: `InMemoryCryptoProvider` → `Ed25519CryptoProvider`.
- `composition.test.ts`: its upload→sign→verify round-trip test now signs
  using `signWithTestKey()` with alice's real test private key, instead of
  replicating the old placeholder hash-based scheme inline.
- `documents.integration.test.ts`: same change — real signing via the test
  key fixture instead of the old placeholder formula, for both the
  successful-sign and successful-verify HTTP round-trip tests.

## Testing

- `PublicKey.test.ts`/`SignatureBytes.test.ts`: existing tests get
  32-byte/64-byte fixtures; new tests added for the wrong-size rejection
  case (too short, too long).
- `Ed25519CryptoProvider.test.ts`: `hash()` test unchanged (still checks
  against a known SHA-256 vector). `verify()` tests use real key pairs
  from `ed25519TestKeys.ts` — a signature produced by
  `signWithTestKey()` verifies successfully; a signature from the wrong
  key, or for the wrong message, or random 64 bytes, all fail verification.
- All ~20 mechanically-affected files: no new test cases, no assertion
  changes beyond byte-array literals — verified by the full suite still
  passing with the same test count as before this sub-project, since
  nothing here adds or removes test cases, only widens fixture data to
  valid sizes.
- `composition.test.ts`/`documents.integration.test.ts`: existing
  assertions unchanged, only how the valid `signatureBytes` value gets
  computed changes (real Ed25519 signing instead of the placeholder
  formula).

## Out of Scope

- Real `FileStorage` persistence — separate future sub-project.
- Any change to `CryptoProvider`'s port shape (still `hash()`/`verify()`
  only, no `sign()`).
- The Flutter mobile app — still explicitly last per the user's stated
  build order.
