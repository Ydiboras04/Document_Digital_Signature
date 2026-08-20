# Real Ed25519 CryptoProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `verify()` with real Ed25519 signature verification (Node's built-in `crypto`, no new dependency), tighten `PublicKey`/`SignatureBytes` to their real Ed25519 sizes, and fix every test fixture this breaks across the codebase.

**Architecture:** `Ed25519CryptoProvider` (renamed from `InMemoryCryptoProvider`) implements real `verify()` via Node's JWK-based Ed25519 key construction. A new test-only fixture (`ed25519TestKeys.ts`) holds 3 real generated key pairs plus a `signWithTestKey()` helper, since `CryptoProvider` has no `sign()` and tests need a way to produce valid signatures.

**Tech Stack:** Node's built-in `crypto` module (`createPrivateKey`, `createPublicKey`, `sign`, `verify` — all support Ed25519 via JWK natively). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-20-ed25519-crypto-provider-design.md`

## Global Constraints

- `CryptoProvider` port shape is unchanged — still `hash()`/`verify()` only, no `sign()`. Signing only ever happens client-side.
- `hash()` is unchanged in every provider — still real SHA-256.
- The Ed25519 key-bridging pattern (raw 32-byte public key ↔ Node `KeyObject`) is JWK-based:
  `{ kty: 'OKP', crv: 'Ed25519', x: base64url(rawPublicKeyBytes) }` for public keys, plus `d: base64url(rawPrivateKeySeedBytes)` for private keys. `algorithm` is always `null` in `crypto.sign()`/`crypto.verify()` calls — the standard Node idiom for EdDSA, which has its own built-in hashing.
- The 3 test key pairs (`alice`/`bob`/`carol`) were generated once for this plan; their exact base64url values are given verbatim in Task 3 — do not regenerate them, or the seed data and test assertions across multiple files will stop matching each other.
- Test private key material lives only in `src/infrastructure/testing/ed25519TestKeys.ts` — never in seed data, never in production code paths.
- All new files use explicit `.js` extensions on relative imports, per the established convention.
- `package.json` already has `"type": "module"` — use `import`/`export`, no `require()`.
- Tests colocated with source.

---

### Task 1: Tighten PublicKey and SignatureBytes validation

**Files:**
- Modify: `src/domain/value-objects/PublicKey.ts`
- Modify: `src/domain/value-objects/PublicKey.test.ts`
- Modify: `src/domain/value-objects/SignatureBytes.ts`
- Modify: `src/domain/value-objects/SignatureBytes.test.ts`

**Interfaces:**
- Produces: `PublicKey.create(bytes)` now requires exactly 32 bytes; `SignatureBytes.create(bytes)` now requires exactly 64 bytes. Both still return `Result<T, InvalidValueError>` — the error type is unchanged, only the validation condition changes. This is the root of every other task's fixture-length changes.

- [ ] **Step 1: Write the new failing tests for PublicKey**

Replace the contents of `src/domain/value-objects/PublicKey.test.ts` with:

```ts
// src/domain/value-objects/PublicKey.test.ts
import { describe, it, expect } from 'vitest'
import { PublicKey } from './PublicKey'

function validPublicKeyBytes(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => i + 1)
}

describe('PublicKey', () => {
  it('creates a valid public key from 32 bytes', () => {
    const bytes = validPublicKeyBytes()
    const result = PublicKey.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = PublicKey.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('PublicKey')
  })

  it('rejects a byte array that is too short', () => {
    const result = PublicKey.create(new Uint8Array(31))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('32')
  })

  it('rejects a byte array that is too long', () => {
    const result = PublicKey.create(new Uint8Array(33))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('32')
  })

  it('is immutable to mutations via caller-supplied array', () => {
    const originalBytes = validPublicKeyBytes()
    const publicKey = PublicKey.create(originalBytes).value
    const originalValue = Array.from(publicKey.toBytes())

    originalBytes[0] = 99
    originalBytes[1] = 88

    const afterMutation = publicKey.toBytes()
    expect(afterMutation).toEqual(new Uint8Array(originalValue))
  })

  it('is immutable to mutations via toBytes() return value', () => {
    const bytes = validPublicKeyBytes()
    const publicKey = PublicKey.create(bytes).value

    const returnedArray = publicKey.toBytes()
    returnedArray[0] = 99
    returnedArray[1] = 88

    const secondCall = publicKey.toBytes()
    expect(secondCall).toEqual(bytes)
    expect(secondCall[0]).toBe(1)
    expect(secondCall[1]).toBe(2)
  })

  it('equals compares by byte value', () => {
    const a = PublicKey.create(validPublicKeyBytes()).value
    const b = PublicKey.create(validPublicKeyBytes()).value
    const differentBytes = validPublicKeyBytes()
    differentBytes[31] = 255
    const c = PublicKey.create(differentBytes).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify the new size tests fail**

Run: `npm test -- PublicKey.test.ts`
Expected: FAIL — the two new "too short"/"too long" tests fail because `PublicKey.create()` doesn't check size yet (only emptiness).

- [ ] **Step 3: Implement the size check**

Replace the contents of `src/domain/value-objects/PublicKey.ts` with:

```ts
import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

const ED25519_PUBLIC_KEY_BYTE_LENGTH = 32

export class PublicKey {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<PublicKey, InvalidValueError> {
    if (bytes.length !== ED25519_PUBLIC_KEY_BYTE_LENGTH) {
      return Result.fail(
        new InvalidValueError(
          'PublicKey',
          `must be exactly ${ED25519_PUBLIC_KEY_BYTE_LENGTH} bytes (Ed25519 public key), got ${bytes.length}`
        )
      )
    }
    return Result.ok(new PublicKey(new Uint8Array(bytes)))
  }

  toBytes(): Uint8Array {
    return this.bytes.slice()
  }

  equals(other: PublicKey): boolean {
    if (this.bytes.length !== other.bytes.length) {
      return false
    }
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== other.bytes[i]) {
        return false
      }
    }
    return true
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- PublicKey.test.ts`
Expected: PASS — 7 tests passed (was 5, now 7 with the two new size-rejection tests).

- [ ] **Step 5: Write the new failing tests for SignatureBytes**

Replace the contents of `src/domain/value-objects/SignatureBytes.test.ts` with:

```ts
// src/domain/value-objects/SignatureBytes.test.ts
import { describe, it, expect } from 'vitest'
import { SignatureBytes } from './SignatureBytes'

function validSignatureBytes(): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => i + 1)
}

describe('SignatureBytes', () => {
  it('creates valid signature bytes from 64 bytes', () => {
    const bytes = validSignatureBytes()
    const result = SignatureBytes.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = SignatureBytes.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('SignatureBytes')
  })

  it('rejects a byte array that is too short', () => {
    const result = SignatureBytes.create(new Uint8Array(63))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('64')
  })

  it('rejects a byte array that is too long', () => {
    const result = SignatureBytes.create(new Uint8Array(65))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('64')
  })

  it('is immutable to mutations via caller-supplied array', () => {
    const originalBytes = validSignatureBytes()
    const signatureBytes = SignatureBytes.create(originalBytes).value
    const originalValue = Array.from(signatureBytes.toBytes())

    originalBytes[0] = 99
    originalBytes[1] = 88

    const afterMutation = signatureBytes.toBytes()
    expect(afterMutation).toEqual(new Uint8Array(originalValue))
  })

  it('is immutable to mutations via toBytes() return value', () => {
    const bytes = validSignatureBytes()
    const signatureBytes = SignatureBytes.create(bytes).value

    const returnedArray = signatureBytes.toBytes()
    returnedArray[0] = 99
    returnedArray[1] = 88

    const secondCall = signatureBytes.toBytes()
    expect(secondCall).toEqual(bytes)
    expect(secondCall[0]).toBe(1)
    expect(secondCall[1]).toBe(2)
  })

  it('equals compares by byte value', () => {
    const a = SignatureBytes.create(validSignatureBytes()).value
    const b = SignatureBytes.create(validSignatureBytes()).value
    const differentBytes = validSignatureBytes()
    differentBytes[63] = 255
    const c = SignatureBytes.create(differentBytes).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
```

- [ ] **Step 6: Run tests to verify the new size tests fail**

Run: `npm test -- SignatureBytes.test.ts`
Expected: FAIL — the two new size tests fail.

- [ ] **Step 7: Implement the size check**

Replace the contents of `src/domain/value-objects/SignatureBytes.ts` with:

```ts
import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

const ED25519_SIGNATURE_BYTE_LENGTH = 64

export class SignatureBytes {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<SignatureBytes, InvalidValueError> {
    if (bytes.length !== ED25519_SIGNATURE_BYTE_LENGTH) {
      return Result.fail(
        new InvalidValueError(
          'SignatureBytes',
          `must be exactly ${ED25519_SIGNATURE_BYTE_LENGTH} bytes (Ed25519 signature), got ${bytes.length}`
        )
      )
    }
    return Result.ok(new SignatureBytes(new Uint8Array(bytes)))
  }

  toBytes(): Uint8Array {
    return this.bytes.slice()
  }

  equals(other: SignatureBytes): boolean {
    if (this.bytes.length !== other.bytes.length) {
      return false
    }
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== other.bytes[i]) {
        return false
      }
    }
    return true
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- SignatureBytes.test.ts`
Expected: PASS — 7 tests passed (was 5, now 7).

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors (this task's own files typecheck fine in isolation — the many OTHER files that break are fixed in Task 2, not here).

- [ ] **Step 10: Commit**

```bash
git add src/domain/value-objects/PublicKey.ts src/domain/value-objects/PublicKey.test.ts src/domain/value-objects/SignatureBytes.ts src/domain/value-objects/SignatureBytes.test.ts
git commit -m "feat: require exact Ed25519 sizes for PublicKey and SignatureBytes"
```

Note: `npm test` (the full suite) will fail after this commit until Task 2 is done — that's expected and unavoidable given how many fixtures the size change touches. Do not run the full suite as a "does this work" check until Task 2 is complete.

---

### Task 2: Fix every other broken test fixture (mechanical only)

**Files:**
- Modify: `src/domain/entities/User.test.ts`
- Modify: `src/domain/entities/Signature.test.ts`
- Modify: `src/domain/services/SignatureChainService.test.ts`
- Modify: `src/use-cases/sign-document/SignDocumentUseCase.test.ts`
- Modify: `src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`
- Modify: `src/infrastructure/InMemoryUserRepository.test.ts`
- Modify: `src/infrastructure/InMemorySignatureRepository.test.ts`
- Modify: `src/infrastructure/db/PostgresSignatureRepository.test.ts`
- Modify: `src/interface-adapters/http/serialization.test.ts`

**Interfaces:**
- Consumes: `PublicKey.create()`/`SignatureBytes.create()` from Task 1 (now exact-size).
- Produces: nothing new — every change here is lengthening an existing byte-array fixture literal so these files typecheck and pass again. No test case is added, removed, or changed in what it asserts.

None of these files' logic changes — only the byte arrays passed into `PublicKey.create()`/`SignatureBytes.create()` calls, widened to 32/64 bytes while preserving each test's original intent (same key across calls where identity mattered, different key/signature where a test needed to distinguish two).

- [ ] **Step 1: Fix User.test.ts**

In `src/domain/entities/User.test.ts`, change:
```ts
function aPublicKey(): PublicKey {
  return PublicKey.create(new Uint8Array([1, 2, 3])).value
}
```
to:
```ts
function aPublicKey(): PublicKey {
  return PublicKey.create(new Uint8Array(32).fill(1)).value
}
```

- [ ] **Step 2: Fix Signature.test.ts**

In `src/domain/entities/Signature.test.ts`, change:
```ts
function someBytes(): SignatureBytes {
  return SignatureBytes.create(new Uint8Array([1, 2, 3])).value
}
```
to:
```ts
function someBytes(): SignatureBytes {
  return SignatureBytes.create(new Uint8Array(64).fill(1)).value
}
```

- [ ] **Step 3: Fix SignatureChainService.test.ts**

In `src/domain/services/SignatureChainService.test.ts`, there are two `SignatureBytes.create(new Uint8Array([1, 2, 3]))` call sites (one in the `aSignature()` helper, one inline in the "ignores signatures belonging to a different document" test) — change each to `SignatureBytes.create(new Uint8Array(64).fill(1))`.

There is one `SignatureBytes.create(new Uint8Array([9, 9, 9, 9]))` call site (in the "fails when a signature was tampered with (verification mismatch)" test) — change it to `SignatureBytes.create(new Uint8Array(64).fill(9))`.

Change:
```ts
const publicKey = PublicKey.create(new Uint8Array([index + 1, index + 2, index + 3])).value
```
to:
```ts
const publicKey = PublicKey.create(new Uint8Array(32).fill(index + 1)).value
```

- [ ] **Step 4: Fix SignDocumentUseCase.test.ts**

In `src/use-cases/sign-document/SignDocumentUseCase.test.ts`:

Change:
```ts
publicKey: overrides.publicKey ?? PublicKey.create(new Uint8Array([1, 2, 3])).value
```
to:
```ts
publicKey: overrides.publicKey ?? PublicKey.create(new Uint8Array(32).fill(1)).value
```

Change:
```ts
const firstUser = aUser({ id: 'user-1', publicKey: PublicKey.create(new Uint8Array([1, 2, 3])).value })
const secondUser = aUser({ id: 'user-2', publicKey: PublicKey.create(new Uint8Array([4, 5, 6])).value })
```
to:
```ts
const firstUser = aUser({ id: 'user-1', publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value })
const secondUser = aUser({ id: 'user-2', publicKey: PublicKey.create(new Uint8Array(32).fill(4)).value })
```

The four remaining `new Uint8Array([9, 9, 9])`, `new Uint8Array([1, 2, 3])` (×2), and `new Uint8Array([9, 9, 9, 9])` literals in this file are passed as raw `signatureBytes` directly into `useCase.execute(...)` — NOT through `SignatureBytes.create()` directly (the use case calls that internally). These do NOT need lengthening for the empty/malformed-input tests to keep meaning what they meant, EXCEPT the ones that are supposed to represent "some non-empty but wrong-length or wrong-content bytes" — check each:
- `'rejects a user who has already signed'` test: `signatureBytes: new Uint8Array([9, 9, 9])` — this path fails at `assertCanSign` (duplicate check) BEFORE `SignatureBytes.create()` is ever called, per `SignDocumentUseCase`'s own step order, so this value never gets validated and can stay as-is.
- `'fails when the document does not exist'` and `'fails when the user does not exist'` tests: `signatureBytes: new Uint8Array([1, 2, 3])` — both fail before reaching `SignatureBytes.create()` too (document/user lookup happens first), so these can stay as-is.
- `'fails when signatureBytes is empty'` test: already `new Uint8Array(0)` — unaffected, still correctly tests the empty case, and empty still fails the new exact-64 check the same way it failed the old non-empty check.
- `'fails when the signature does not verify against the payload'` test: `signatureBytes: new Uint8Array([9, 9, 9, 9])` — this one DOES reach `SignatureBytes.create()` (the flow gets past document/user/duplicate checks). Change it to `new Uint8Array(64).fill(9)` so it passes the new size check and reaches the intended `SignatureVerificationFailedError` path instead of failing earlier with `InvalidValueError`.

- [ ] **Step 5: Fix VerifyDocumentUseCase.test.ts**

In `src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`, change:
```ts
function aUser(id: string, publicKeyByte: number): User {
  return User.create({
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    publicKey: PublicKey.create(new Uint8Array([publicKeyByte])).value
  }).value
}
```
to:
```ts
function aUser(id: string, publicKeyByte: number): User {
  return User.create({
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    publicKey: PublicKey.create(new Uint8Array(32).fill(publicKeyByte)).value
  }).value
}
```

Change the one `SignatureBytes.create(new Uint8Array([9, 9, 9, 9]))` (in the "fails when a signature was tampered with" test) to `SignatureBytes.create(new Uint8Array(64).fill(9))`.

- [ ] **Step 6: Fix InMemoryUserRepository.test.ts**

In `src/infrastructure/InMemoryUserRepository.test.ts`, change:
```ts
publicKey: PublicKey.create(new Uint8Array([1, 2, 3])).value
```
to:
```ts
publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value
```

- [ ] **Step 7: Fix InMemorySignatureRepository.test.ts**

In `src/infrastructure/InMemorySignatureRepository.test.ts`, change:
```ts
signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
```
to:
```ts
signatureData: SignatureBytes.create(new Uint8Array(64).fill(1)).value,
```

- [ ] **Step 8: Fix PostgresSignatureRepository.test.ts**

In `src/infrastructure/db/PostgresSignatureRepository.test.ts`, change:
```ts
signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
```
to:
```ts
signatureData: SignatureBytes.create(new Uint8Array(64).fill(1)).value,
```

- [ ] **Step 9: Fix serialization.test.ts**

In `src/interface-adapters/http/serialization.test.ts`, change:
```ts
signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
```
to:
```ts
signatureData: SignatureBytes.create(new Uint8Array(64).fill(1)).value,
```

And change the corresponding assertion:
```ts
signatureData: Buffer.from([1, 2, 3]).toString('base64'),
```
to:
```ts
signatureData: Buffer.from(new Uint8Array(64).fill(1)).toString('base64'),
```

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file compiles and passes again. Total count is 124 (120 before Task 1, +2 from `PublicKey.test.ts`'s new tests, +2 from `SignatureBytes.test.ts`'s new tests — Task 2 adds zero new tests, it only fixes fixtures broken by Task 1).

- [ ] **Step 11: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 12: Commit**

```bash
git add src/domain/entities/User.test.ts src/domain/entities/Signature.test.ts src/domain/services/SignatureChainService.test.ts src/use-cases/sign-document/SignDocumentUseCase.test.ts src/use-cases/verify-document/VerifyDocumentUseCase.test.ts src/infrastructure/InMemoryUserRepository.test.ts src/infrastructure/InMemorySignatureRepository.test.ts src/infrastructure/db/PostgresSignatureRepository.test.ts src/interface-adapters/http/serialization.test.ts
git commit -m "test: widen fixture byte arrays to valid Ed25519 sizes"
```

---

### Task 3: Ed25519 test key fixtures

**Files:**
- Create: `src/infrastructure/testing/ed25519TestKeys.ts`

**Interfaces:**
- Consumes: `createPrivateKey`, `sign` from `node:crypto`.
- Produces: `ed25519TestKeys` (an object with `alice`/`bob`/`carol`, each `{ publicKeyBase64Url: string; privateKeyBase64Url: string; publicKeyBytes: Uint8Array }`) and `signWithTestKey(keyPair, message: Uint8Array): Uint8Array`. Task 4's test file and Task 5/6's seed-data and integration-test updates all depend on this.

- [ ] **Step 1: Create the fixture**

Create `src/infrastructure/testing/ed25519TestKeys.ts`:

```ts
import { createPrivateKey, sign as cryptoSign } from 'node:crypto'

export interface Ed25519TestKeyPair {
  publicKeyBase64Url: string
  privateKeyBase64Url: string
  publicKeyBytes: Uint8Array
}

function keyPair(publicKeyBase64Url: string, privateKeyBase64Url: string): Ed25519TestKeyPair {
  return {
    publicKeyBase64Url,
    privateKeyBase64Url,
    publicKeyBytes: new Uint8Array(Buffer.from(publicKeyBase64Url, 'base64url'))
  }
}

// Generated once for this project's tests. NOT real user key material --
// there is no mobile app yet, so these exist purely so tests and manual
// verification can produce valid Ed25519 signatures to check verify()
// against. CryptoProvider has no sign() -- production code never signs
// anything server-side, so this private key material never appears
// outside test code.
export const ed25519TestKeys = {
  alice: keyPair('XHDfZbVeUWFelOFPeMin_8LM7rIPtyI6thZhY_HhSxQ', 'r0Cgzweco6jmUW9UdVqbX_0Jdu90hI24sCptHFBf56o'),
  bob: keyPair('T5nOsL2FgGY_3Jqij-UdBvC07rOe8Cr-CoMMNgcCSCk', 'eceG7cqj14GKxppK8LJSRP1nR3gg9oiPX-V_3pq_uF8'),
  carol: keyPair('ISp-DYexWlGL4kWxJb7dRI6htmAsgjhfsxIeCHs__2g', 'uMa2O3m1Z2adDNhacCGva1ZmBWqk3CANXsCFIkXzEEQ')
} as const

export function signWithTestKey(keyPair: Ed25519TestKeyPair, message: Uint8Array): Uint8Array {
  const privateKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: keyPair.publicKeyBase64Url, d: keyPair.privateKeyBase64Url },
    format: 'jwk'
  })
  return new Uint8Array(cryptoSign(null, message, privateKey))
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 3: Verify manually that signing/verification actually works**

Run: `node -e "const {ed25519TestKeys, signWithTestKey} = require('./src/infrastructure/testing/ed25519TestKeys.ts'); console.log('n/a - see Task 4 for the real automated test')"` — actually, since this is a `.ts` file, skip the manual `node -e` check here; Task 4's test suite is the real verification for this fixture. Just confirm the file exists and typechecks (Step 2).

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/testing/ed25519TestKeys.ts
git commit -m "test: add Ed25519 test key fixtures and signing helper"
```

---

### Task 4: Ed25519CryptoProvider (rename + real verify)

**Files:**
- Create: `src/infrastructure/Ed25519CryptoProvider.ts` (replaces `InMemoryCryptoProvider.ts`)
- Create: `src/infrastructure/Ed25519CryptoProvider.test.ts` (replaces `InMemoryCryptoProvider.test.ts`)
- Delete: `src/infrastructure/InMemoryCryptoProvider.ts`
- Delete: `src/infrastructure/InMemoryCryptoProvider.test.ts`

**Interfaces:**
- Consumes: `createHash`, `createPublicKey`, `verify` from `node:crypto`; `ed25519TestKeys`, `signWithTestKey` from Task 3.
- Produces: `Ed25519CryptoProvider` implementing `CryptoProvider` (`hash()` unchanged real SHA-256; `verify()` real Ed25519). Task 5's `composition.ts` and Task 6's test updates depend on this.

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/Ed25519CryptoProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { Ed25519CryptoProvider } from './Ed25519CryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'
import { ed25519TestKeys, signWithTestKey } from './testing/ed25519TestKeys.js'

describe('Ed25519CryptoProvider.hash', () => {
  it('matches a known SHA-256 digest', () => {
    const crypto = new Ed25519CryptoProvider()
    const data = new TextEncoder().encode('hello world')

    const result = crypto.hash(data)

    const expectedDigest = createHash('sha256').update(data).digest()
    expect(result.toBytes()).toEqual(new Uint8Array(expectedDigest))
  })
})

describe('Ed25519CryptoProvider.verify', () => {
  it('returns true for a signature produced with the matching private key', () => {
    const crypto = new Ed25519CryptoProvider()
    const publicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))

    const signatureBytes = signWithTestKey(ed25519TestKeys.alice, message.toBytes())
    const signature = SignatureBytes.create(signatureBytes).value

    expect(crypto.verify(publicKey, message, signature)).toBe(true)
  })

  it('returns false for a signature produced with a different private key', () => {
    const crypto = new Ed25519CryptoProvider()
    const alicePublicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))

    const bobSignatureBytes = signWithTestKey(ed25519TestKeys.bob, message.toBytes())
    const signature = SignatureBytes.create(bobSignatureBytes).value

    expect(crypto.verify(alicePublicKey, message, signature)).toBe(false)
  })

  it('returns false for a signature over a different message', () => {
    const crypto = new Ed25519CryptoProvider()
    const publicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))
    const differentMessage = crypto.hash(new TextEncoder().encode('a different document hash'))

    const signatureBytes = signWithTestKey(ed25519TestKeys.alice, differentMessage.toBytes())
    const signature = SignatureBytes.create(signatureBytes).value

    expect(crypto.verify(publicKey, message, signature)).toBe(false)
  })

  it('returns false for random 64 bytes', () => {
    const crypto = new Ed25519CryptoProvider()
    const publicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))
    const randomSignature = SignatureBytes.create(new Uint8Array(64).fill(9)).value

    expect(crypto.verify(publicKey, message, randomSignature)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- Ed25519CryptoProvider.test.ts`
Expected: FAIL — `Cannot find module './Ed25519CryptoProvider.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/infrastructure/Ed25519CryptoProvider.ts`:

```ts
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { Hash } from '../domain/value-objects/Hash.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'
import { CryptoProvider } from '../domain/ports/CryptoProvider.js'

export class Ed25519CryptoProvider implements CryptoProvider {
  hash(data: Uint8Array): Hash {
    const digest = createHash('sha256').update(data).digest()
    return Hash.create(new Uint8Array(digest)).value
  }

  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean {
    const keyObject = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey.toBytes()).toString('base64url') },
      format: 'jwk'
    })
    return cryptoVerify(null, message.toBytes(), keyObject, signature.toBytes())
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- Ed25519CryptoProvider.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Delete the old InMemoryCryptoProvider files**

```bash
rm src/infrastructure/InMemoryCryptoProvider.ts src/infrastructure/InMemoryCryptoProvider.test.ts
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: FAILS at this point — `composition.ts`, `composition.test.ts`, and `documents.integration.test.ts` still import the now-deleted `InMemoryCryptoProvider`. This is expected; Task 6 fixes them. Do not be alarmed by this typecheck failure — it's the reason this task's commit message below doesn't claim "all green."

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/Ed25519CryptoProvider.ts src/infrastructure/Ed25519CryptoProvider.test.ts
git add -u src/infrastructure/InMemoryCryptoProvider.ts src/infrastructure/InMemoryCryptoProvider.test.ts
git commit -m "feat: replace placeholder verify() with real Ed25519 (Ed25519CryptoProvider)"
```

(`git add -u` stages the deletions — `git add` alone doesn't pick up removed files. `npm run typecheck` will still fail after this commit until Task 6 rewires the remaining consumers — that's expected, tracked, and fixed two tasks from now.)

---

### Task 5: Real seed data

**Files:**
- Modify: `src/infrastructure/db/seed.ts`
- Modify: `src/infrastructure/db/testSupport.ts`
- Modify: `src/infrastructure/db/PostgresUserRepository.test.ts`

**Interfaces:**
- Consumes: `ed25519TestKeys` from Task 3.
- Produces: seed data now uses real Ed25519 public keys instead of placeholder bytes. Task 6's `composition.test.ts`/`documents.integration.test.ts` (which sign as `user-alice`) depend on the seeded public key actually matching `ed25519TestKeys.alice`'s key pair, or verification will fail.

- [ ] **Step 1: Update seed.ts**

Replace the contents of `src/infrastructure/db/seed.ts` with:

```ts
import { db } from './connection.js'
import { users } from './schema.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

async function seed() {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: ed25519TestKeys.alice.publicKeyBytes },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: ed25519TestKeys.bob.publicKeyBytes },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: ed25519TestKeys.carol.publicKeyBytes }
    ])
    .onConflictDoNothing()

  console.log('Seeded 3 test users.')
  process.exit(0)
}

seed()
```

- [ ] **Step 2: Update testSupport.ts**

Replace the contents of `src/infrastructure/db/testSupport.ts` with:

```ts
import { db } from './connection.js'
import { documents, signatures, users } from './schema.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

export async function cleanDatabase(): Promise<void> {
  await db.delete(signatures)
  await db.delete(documents)
}

export async function ensureSeedUsers(): Promise<void> {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: ed25519TestKeys.alice.publicKeyBytes },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: ed25519TestKeys.bob.publicKeyBytes },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: ed25519TestKeys.carol.publicKeyBytes }
    ])
    .onConflictDoNothing()
}
```

**Important:** since the 3 seed users already exist in your local Postgres database from earlier sub-projects (with the OLD placeholder public key bytes), `onConflictDoNothing()` means re-running `db:seed` or `ensureSeedUsers()` will NOT update their public keys — the old rows are already there and get skipped. You must delete the existing seed user rows once so the new real keys actually get inserted:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "DELETE FROM users WHERE id IN ('user-alice', 'user-bob', 'user-carol');"
```

(This is safe — `documents`/`signatures` referencing these users via foreign key would block the delete if any exist; if that happens, run `cleanDatabase()`-equivalent SQL first: `DELETE FROM signatures; DELETE FROM documents;` before the `DELETE FROM users` above.)

- [ ] **Step 3: Re-seed with the real keys**

Run: `npm run db:seed`
Expected: `Seeded 3 test users.` — and this time, since the old rows are gone, the real Ed25519 public keys actually get inserted.

- [ ] **Step 4: Update PostgresUserRepository.test.ts's assertion**

In `src/infrastructure/db/PostgresUserRepository.test.ts`, add this import alongside the existing ones:

```ts
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'
```

Change:
```ts
expect(found!.publicKey.toBytes()).toEqual(new Uint8Array([1, 2, 3, 4]))
```
to:
```ts
expect(found!.publicKey.toBytes()).toEqual(ed25519TestKeys.alice.publicKeyBytes)
```

- [ ] **Step 5: Run this test file**

Run: `npm test -- PostgresUserRepository.test.ts`
Expected: PASS — 2 tests passed. (This test's own `beforeEach` calls `cleanDatabase()`/`ensureSeedUsers()`, so it's self-sufficient regardless of Step 3's manual re-seed — but Step 3 is still needed for your persistent dev database and for Task 6's manual curl verification later.)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: still FAILS — `composition.ts`/`composition.test.ts`/`documents.integration.test.ts` still reference the deleted `InMemoryCryptoProvider`. Still expected; Task 6 is next.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/db/seed.ts src/infrastructure/db/testSupport.ts src/infrastructure/db/PostgresUserRepository.test.ts
git commit -m "feat: seed real Ed25519 public keys instead of placeholder bytes"
```

---

### Task 6: Wire Ed25519CryptoProvider into composition and fix remaining tests

**Files:**
- Modify: `src/infrastructure/composition.ts`
- Modify: `src/infrastructure/composition.test.ts`
- Modify: `src/interface-adapters/http/documents.integration.test.ts`

**Interfaces:**
- Consumes: `Ed25519CryptoProvider` (Task 4), `ed25519TestKeys`/`signWithTestKey` (Task 3).
- Produces: nothing new — this is the final task. `createDependencies()` now uses real Ed25519 verification end-to-end, and the last two test files that referenced the deleted `InMemoryCryptoProvider` are fixed.

- [ ] **Step 1: Update composition.ts**

In `src/infrastructure/composition.ts`, change:
```ts
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
```
to:
```ts
import { Ed25519CryptoProvider } from './Ed25519CryptoProvider.js'
```

And change:
```ts
  const crypto = new InMemoryCryptoProvider()
```
to:
```ts
  const crypto = new Ed25519CryptoProvider()
```

- [ ] **Step 2: Update composition.test.ts**

Replace the contents of `src/infrastructure/composition.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDependencies } from './composition.js'
import { Ed25519CryptoProvider } from './Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from './testing/ed25519TestKeys.js'
import { cleanDatabase, ensureSeedUsers } from './db/testSupport.js'

describe('createDependencies', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

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
    const crypto = new Ed25519CryptoProvider()

    const uploadResult = await uploadDocumentUseCase.execute({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: new TextEncoder().encode('hello world')
    })
    expect(uploadResult.isOk()).toBe(true)
    const document = uploadResult.value

    const message = crypto.hash(document.originalHash.toBytes())
    const signatureBytes = signWithTestKey(ed25519TestKeys.alice, message.toBytes())

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

- [ ] **Step 3: Update documents.integration.test.ts**

In `src/interface-adapters/http/documents.integration.test.ts`, change:
```ts
import { InMemoryCryptoProvider } from '../../infrastructure/InMemoryCryptoProvider.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
```
to:
```ts
import { Ed25519CryptoProvider } from '../../infrastructure/Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'
```

And change:
```ts
function computeAliceSignatureBytes(originalHashHex: string): Uint8Array {
  const crypto = new InMemoryCryptoProvider()
  const message = crypto.hash(Buffer.from(originalHashHex, 'hex'))
  const alicePublicKey = PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
  const combined = new Uint8Array(alicePublicKey.toBytes().length + message.toBytes().length)
  combined.set(alicePublicKey.toBytes(), 0)
  combined.set(message.toBytes(), alicePublicKey.toBytes().length)
  return crypto.hash(combined).toBytes()
}
```
to:
```ts
function computeAliceSignatureBytes(originalHashHex: string): Uint8Array {
  const crypto = new Ed25519CryptoProvider()
  const message = crypto.hash(Buffer.from(originalHashHex, 'hex'))
  return signWithTestKey(ed25519TestKeys.alice, message.toBytes())
}
```

Nothing else in this file changes — every `describe`/`it` block still calls `computeAliceSignatureBytes(document.originalHash)` exactly as before; only what happens inside that function changed.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all 126 tests pass (124 from the end of Task 2, +2 net from Task 4 replacing `InMemoryCryptoProvider.test.ts`'s 3 tests with `Ed25519CryptoProvider.test.ts`'s 5 tests; Tasks 3, 5, and 6 add no further new tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors — this is the first typecheck since Task 4 that should be fully green again.

- [ ] **Step 6: Manually verify with the running dev server**

Run: `npm run dev`

In a separate terminal, upload a document:
```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Ed25519 Test","uploaderId":"user-alice","fileBytes":"aGVsbG8gd29ybGQ="}'
```
Note the `id` and `originalHash` from the response.

Compute a real Ed25519 signature using alice's test private key (Node one-liner, replace `<originalHash>` with the value from the response above):
```bash
node -e '
const crypto = require("crypto");
const originalHashHex = "<originalHash>";
const pubX = "XHDfZbVeUWFelOFPeMin_8LM7rIPtyI6thZhY_HhSxQ";
const privD = "r0Cgzweco6jmUW9UdVqbX_0Jdu90hI24sCptHFBf56o";
const message = crypto.createHash("sha256").update(Buffer.from(originalHashHex, "hex")).digest();
const privateKey = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: pubX, d: privD }, format: "jwk" });
const signature = crypto.sign(null, message, privateKey);
console.log(signature.toString("base64"));
'
```

Sign the document (replace `<documentId>` and `<signatureBase64>`):
```bash
curl -X POST http://localhost:3000/documents/<documentId>/signatures \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-alice","signatureBytes":"<signatureBase64>"}'
```
Expected: `201` with the serialized signature.

Verify:
```bash
curl http://localhost:3000/documents/<documentId>/verify
```
Expected: `200` with `{"valid":true,"signatures":[...]}` — this time backed by genuine Ed25519 cryptographic verification, not a placeholder formula.

As a sanity check that verification is now real (not still trivially permissive), try signing with garbage bytes instead and confirm it's rejected:
```bash
curl -X POST http://localhost:3000/documents/<documentId>/signatures \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-bob","signatureBytes":"'"$(node -e 'console.log(Buffer.alloc(64, 9).toString("base64"))')"'"}'
```
Expected: `422` (`SignatureVerificationFailedError`) — 64 well-formed-length bytes that are NOT a real signature over the message must still fail verification.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/composition.ts src/infrastructure/composition.test.ts src/interface-adapters/http/documents.integration.test.ts
git commit -m "feat: wire Ed25519CryptoProvider into composition root"
```

---

## Post-plan state

After Task 6, SecureDoc Chain's backend performs genuine cryptographic signature verification — a forged or garbage signature is rejected, not accepted by a formula anyone could read in the source. `hash()` was always real SHA-256; now `verify()` is real Ed25519 too, closing the last security-critical placeholder in the backend. The one remaining backend gap is `FileStorage` (uploaded file bytes still aren't durably persisted — still in-memory) — a separate future sub-project. The Flutter mobile app remains explicitly last per the user's stated build order.
