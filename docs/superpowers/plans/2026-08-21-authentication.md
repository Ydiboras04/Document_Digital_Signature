# Authentication (Ed25519 Challenge–Response, JWT Sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make identity provable — a client proves possession of its Ed25519 private key by signing a server-issued challenge, receives a short-lived JWT, and every protected endpoint derives `userId` from that token instead of trusting a client-supplied field.

**Architecture:** Two new public endpoints (`POST /auth/challenge`, `POST /auth/token`) built on the existing clean-architecture use-case pattern, reusing the existing `CryptoProvider.verify(publicKey, Hash, SignatureBytes)` port unchanged by sizing the challenge at exactly 32 bytes so it fits the existing `Hash` value object. Hono's built-in `jwt` middleware protects the document endpoints. On the Flutter side an `AuthSession` performs the handshake lazily, caches the token in memory, and `HttpDocumentApi` retries once on `401` so expiry is invisible.

**Tech Stack:** Existing stack only. Backend: Hono 4.13.1's built-in `hono/jwt` (`sign` + `jwt` middleware — no new dependency), Node's `crypto.randomBytes`, Drizzle/Postgres, Vitest. Flutter: existing `http`, `cryptography`, `flutter_secure_storage` — no new packages.

**Spec:** `docs/superpowers/specs/2026-08-21-authentication-design.md`

## Global Constraints

- No passwords anywhere. The Ed25519 private key generated at registration remains the sole credential.
- No new backend dependencies — `hono/jwt` is built into Hono 4.13.1 and exports `sign`, `verify`, `decode`, and the `jwt` middleware (verified against `node_modules/hono/dist/middleware/jwt/jwt.js`, which sets `c.set('jwtPayload', payload)`).
- No new Flutter dependencies.
- The challenge is **exactly 32 bytes** so the existing `Hash` value object (`Hash.create` requires exactly 32) and `CryptoProvider.verify` port are reused unchanged.
- Signatures are **exactly 64 bytes** (`SignatureBytes.create` enforces this).
- `JWT_SECRET` lives in `.env`, which is gitignored and must never be committed. `vitest.setup.ts` calls `process.loadEnvFile('.env')`, so adding it there covers tests too.
- All authentication failures (no pending challenge, expired challenge, bad signature) return `401` with an **identical** generic message, so the response leaks nothing about which condition failed. This is why they share one `AuthenticationFailedError` type rather than three.
- Domain and use-case layers stay transport-agnostic: only the route layer knows about JWTs. The use cases beneath (`ListDocumentsUseCase`, `GetDocumentUseCase`, `UploadDocumentUseCase`, `SignDocumentUseCase`) keep their current input shapes and their unit tests need no changes.
- This is sub-project 1 of 3. Do **not** add any role/`isAdmin` claim to the JWT — that is sub-project 2's job.

---

### Task 1: Auth primitives — error type, ports, and adapters

**Files:**
- Create: `src/domain/errors/AuthenticationFailedError.ts`
- Modify: `src/interface-adapters/http/errorMapping.ts`
- Create: `src/use-cases/ports/ChallengeStore.ts`
- Create: `src/use-cases/ports/NonceGenerator.ts`
- Create: `src/infrastructure/InMemoryChallengeStore.ts`
- Create: `src/infrastructure/RandomNonceGenerator.ts`
- Create: `src/use-cases/testing/FakeChallengeStore.ts`
- Create: `src/use-cases/testing/FakeNonceGenerator.ts`
- Test: `src/infrastructure/InMemoryChallengeStore.test.ts`
- Test: `src/infrastructure/RandomNonceGenerator.test.ts`
- Test: `src/interface-adapters/http/errorMapping.test.ts` (add a case to the existing file)

**Interfaces:**
- Consumes: `DomainError` (existing base class at `src/domain/errors/DomainError.ts`), `mapDomainErrorToResponse` (existing).
- Produces: `AuthenticationFailedError` (maps to 401); `ChallengeStore` with `save(userId, challenge): Promise<void>` and `take(userId): Promise<PendingChallenge | null>` (get-and-delete); `PendingChallenge` = `{ challenge: Uint8Array, expiresAt: Date }`; `NonceGenerator` with `generate(): Uint8Array` (32 bytes); `InMemoryChallengeStore`, `RandomNonceGenerator`, `FakeChallengeStore`, `FakeNonceGenerator`. Tasks 2 and 3 depend on all of these.

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/InMemoryChallengeStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemoryChallengeStore } from './InMemoryChallengeStore.js'

describe('InMemoryChallengeStore', () => {
  it('returns null when nothing was saved for the user', async () => {
    const store = new InMemoryChallengeStore()

    expect(await store.take('user-1')).toBeNull()
  })

  it('returns the saved challenge', async () => {
    const store = new InMemoryChallengeStore()
    const expiresAt = new Date('2026-08-21T00:02:00Z')
    await store.save('user-1', { challenge: new Uint8Array(32).fill(7), expiresAt })

    const taken = await store.take('user-1')

    expect(taken).not.toBeNull()
    expect(taken!.challenge).toEqual(new Uint8Array(32).fill(7))
    expect(taken!.expiresAt).toEqual(expiresAt)
  })

  it('deletes the challenge on take, so a nonce cannot be reused', async () => {
    const store = new InMemoryChallengeStore()
    await store.save('user-1', {
      challenge: new Uint8Array(32).fill(7),
      expiresAt: new Date('2026-08-21T00:02:00Z')
    })

    await store.take('user-1')

    expect(await store.take('user-1')).toBeNull()
  })

  it('keeps challenges for different users separate', async () => {
    const store = new InMemoryChallengeStore()
    await store.save('user-1', {
      challenge: new Uint8Array(32).fill(1),
      expiresAt: new Date('2026-08-21T00:02:00Z')
    })
    await store.save('user-2', {
      challenge: new Uint8Array(32).fill(2),
      expiresAt: new Date('2026-08-21T00:02:00Z')
    })

    expect((await store.take('user-1'))!.challenge).toEqual(new Uint8Array(32).fill(1))
    expect((await store.take('user-2'))!.challenge).toEqual(new Uint8Array(32).fill(2))
  })

  it('overwrites a previous pending challenge for the same user', async () => {
    const store = new InMemoryChallengeStore()
    const expiresAt = new Date('2026-08-21T00:02:00Z')
    await store.save('user-1', { challenge: new Uint8Array(32).fill(1), expiresAt })
    await store.save('user-1', { challenge: new Uint8Array(32).fill(9), expiresAt })

    expect((await store.take('user-1'))!.challenge).toEqual(new Uint8Array(32).fill(9))
  })
})
```

Create `src/infrastructure/RandomNonceGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RandomNonceGenerator } from './RandomNonceGenerator.js'

describe('RandomNonceGenerator', () => {
  it('generates 32 bytes', () => {
    const generator = new RandomNonceGenerator()

    expect(generator.generate().length).toBe(32)
  })

  it('generates a different nonce each call', () => {
    const generator = new RandomNonceGenerator()

    expect(generator.generate()).not.toEqual(generator.generate())
  })
})
```

Add to the existing `src/interface-adapters/http/errorMapping.test.ts` — add this import alongside the existing ones at the top of the file:

```ts
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'
```

and add this `it` inside the existing top-level `describe('mapDomainErrorToResponse', ...)` block, matching that file's existing `const result = ...` assertion style:

```ts
  it('maps AuthenticationFailedError to 401', () => {
    const result = mapDomainErrorToResponse(new AuthenticationFailedError())
    expect(result.status).toBe(401)
    expect(result.body.error.type).toBe('AuthenticationFailedError')
    expect(result.body.error.message).toBe('Authentication failed')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/infrastructure/InMemoryChallengeStore.test.ts src/infrastructure/RandomNonceGenerator.test.ts src/interface-adapters/http/errorMapping.test.ts`
Expected: FAIL — the three new modules do not exist yet.

- [ ] **Step 3: Write the error type**

Create `src/domain/errors/AuthenticationFailedError.ts`:

```ts
import { DomainError } from './DomainError.js'

/**
 * Deliberately generic. Issued for a missing challenge, an expired challenge,
 * and a signature that does not verify alike, so a 401 response never reveals
 * which of those conditions actually failed.
 */
export class AuthenticationFailedError extends DomainError {
  constructor() {
    super('Authentication failed')
  }
}
```

- [ ] **Step 4: Map it to 401**

In `src/interface-adapters/http/errorMapping.ts`, add this import alongside the existing error imports:

```ts
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'
```

and add this line inside `statusForError`, immediately before the `SignatureVerificationFailedError` line:

```ts
  if (error instanceof AuthenticationFailedError) return 401
```

- [ ] **Step 5: Write the ports**

Create `src/use-cases/ports/ChallengeStore.ts`:

```ts
export interface PendingChallenge {
  challenge: Uint8Array
  expiresAt: Date
}

export interface ChallengeStore {
  save(userId: string, challenge: PendingChallenge): Promise<void>

  /**
   * Returns the pending challenge for this user and removes it in the same
   * step. Single-use by construction: a captured signature cannot be replayed
   * because the nonce it was made over no longer exists.
   */
  take(userId: string): Promise<PendingChallenge | null>
}
```

Create `src/use-cases/ports/NonceGenerator.ts`:

```ts
export interface NonceGenerator {
  /** Returns exactly 32 cryptographically random bytes. */
  generate(): Uint8Array
}
```

- [ ] **Step 6: Write the real adapters**

Create `src/infrastructure/InMemoryChallengeStore.ts`:

```ts
import { ChallengeStore, PendingChallenge } from '../use-cases/ports/ChallengeStore.js'

/**
 * Challenges are short-lived (2 minutes) and single-use, so losing them on
 * server restart is harmless -- a client simply requests a fresh one.
 */
export class InMemoryChallengeStore implements ChallengeStore {
  private readonly challenges = new Map<string, PendingChallenge>()

  async save(userId: string, challenge: PendingChallenge): Promise<void> {
    this.challenges.set(userId, challenge)
  }

  async take(userId: string): Promise<PendingChallenge | null> {
    const pending = this.challenges.get(userId)
    if (pending === undefined) {
      return null
    }
    this.challenges.delete(userId)
    return pending
  }
}
```

Create `src/infrastructure/RandomNonceGenerator.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { NonceGenerator } from '../use-cases/ports/NonceGenerator.js'

const NONCE_BYTE_LENGTH = 32

export class RandomNonceGenerator implements NonceGenerator {
  generate(): Uint8Array {
    return new Uint8Array(randomBytes(NONCE_BYTE_LENGTH))
  }
}
```

- [ ] **Step 7: Write the test doubles**

Create `src/use-cases/testing/FakeChallengeStore.ts`:

```ts
import { ChallengeStore, PendingChallenge } from '../ports/ChallengeStore.js'

export class FakeChallengeStore implements ChallengeStore {
  readonly saved = new Map<string, PendingChallenge>()
  readonly takenUserIds: string[] = []

  async save(userId: string, challenge: PendingChallenge): Promise<void> {
    this.saved.set(userId, challenge)
  }

  async take(userId: string): Promise<PendingChallenge | null> {
    this.takenUserIds.push(userId)
    const pending = this.saved.get(userId)
    if (pending === undefined) {
      return null
    }
    this.saved.delete(userId)
    return pending
  }
}
```

Create `src/use-cases/testing/FakeNonceGenerator.ts`:

```ts
import { NonceGenerator } from '../ports/NonceGenerator.js'

export class FakeNonceGenerator implements NonceGenerator {
  constructor(private readonly nonce: Uint8Array = new Uint8Array(32).fill(3)) {}

  generate(): Uint8Array {
    return new Uint8Array(this.nonce)
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/infrastructure/InMemoryChallengeStore.test.ts src/infrastructure/RandomNonceGenerator.test.ts src/interface-adapters/http/errorMapping.test.ts`
Expected: PASS — 5 store tests, 2 generator tests, and the existing errorMapping tests plus the new 401 case.

- [ ] **Step 9: Commit**

```bash
git add src/domain/errors/AuthenticationFailedError.ts src/interface-adapters/http/errorMapping.ts src/interface-adapters/http/errorMapping.test.ts src/use-cases/ports/ChallengeStore.ts src/use-cases/ports/NonceGenerator.ts src/infrastructure/InMemoryChallengeStore.ts src/infrastructure/RandomNonceGenerator.ts src/infrastructure/InMemoryChallengeStore.test.ts src/infrastructure/RandomNonceGenerator.test.ts src/use-cases/testing/FakeChallengeStore.ts src/use-cases/testing/FakeNonceGenerator.ts
git commit -m "feat: add auth primitives (ChallengeStore, NonceGenerator, AuthenticationFailedError)"
```

---

### Task 2: `RequestChallengeUseCase`

**Files:**
- Create: `src/use-cases/request-challenge/RequestChallengeUseCase.ts`
- Test: `src/use-cases/request-challenge/RequestChallengeUseCase.test.ts`

**Interfaces:**
- Consumes: `UserRepository.findById(id): Promise<User | null>` (existing), `NonceGenerator.generate()` and `ChallengeStore.save(userId, {challenge, expiresAt})` (Task 1), `Clock.now(): Date` (existing port at `src/use-cases/ports/Clock.ts`), `UserNotFoundError` (existing).
- Produces: `RequestChallengeUseCase` with `execute(input: {userId: string}): Promise<Result<Uint8Array, UserNotFoundError>>`, and the exported constant `CHALLENGE_TTL_MS = 120_000`. Task 4's route depends on this.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/request-challenge/RequestChallengeUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RequestChallengeUseCase, CHALLENGE_TTL_MS } from './RequestChallengeUseCase.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeChallengeStore } from '../testing/FakeChallengeStore.js'
import { FakeNonceGenerator } from '../testing/FakeNonceGenerator.js'
import { FakeClock } from '../testing/FakeClock.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'

function aUser(): User {
  return User.create({
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value
  }).value
}

function setup() {
  const userRepository = new FakeUserRepository()
  const challengeStore = new FakeChallengeStore()
  const nonceGenerator = new FakeNonceGenerator()
  const clock = new FakeClock(new Date('2026-08-21T00:00:00Z'))
  const useCase = new RequestChallengeUseCase(userRepository, challengeStore, nonceGenerator, clock)
  return { userRepository, challengeStore, nonceGenerator, clock, useCase }
}

describe('RequestChallengeUseCase', () => {
  it('fails when the user does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ userId: 'missing-user' })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('returns a 32-byte challenge for a known user', async () => {
    const { userRepository, useCase } = setup()
    userRepository.users.push(aUser())

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result.isOk()).toBe(true)
    expect(result.value.length).toBe(32)
    expect(result.value).toEqual(new Uint8Array(32).fill(3))
  })

  it('stores the challenge with a 2-minute expiry', async () => {
    const { userRepository, challengeStore, useCase } = setup()
    userRepository.users.push(aUser())

    await useCase.execute({ userId: 'user-1' })

    const stored = challengeStore.saved.get('user-1')
    expect(stored).toBeDefined()
    expect(stored!.challenge).toEqual(new Uint8Array(32).fill(3))
    expect(stored!.expiresAt).toEqual(new Date(new Date('2026-08-21T00:00:00Z').getTime() + CHALLENGE_TTL_MS))
    expect(CHALLENGE_TTL_MS).toBe(120_000)
  })

  it('stores nothing when the user does not exist', async () => {
    const { challengeStore, useCase } = setup()

    await useCase.execute({ userId: 'missing-user' })

    expect(challengeStore.saved.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/use-cases/request-challenge/RequestChallengeUseCase.test.ts`
Expected: FAIL — `RequestChallengeUseCase.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/request-challenge/RequestChallengeUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { UserRepository } from '../ports/UserRepository.js'
import { ChallengeStore } from '../ports/ChallengeStore.js'
import { NonceGenerator } from '../ports/NonceGenerator.js'
import { Clock } from '../ports/Clock.js'

export const CHALLENGE_TTL_MS = 120_000

export interface RequestChallengeInput {
  userId: string
}

export class RequestChallengeUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly challengeStore: ChallengeStore,
    private readonly nonceGenerator: NonceGenerator,
    private readonly clock: Clock
  ) {}

  async execute(input: RequestChallengeInput): Promise<Result<Uint8Array, UserNotFoundError>> {
    const user = await this.userRepository.findById(input.userId)
    if (user === null) {
      return Result.fail(new UserNotFoundError(input.userId))
    }

    const challenge = this.nonceGenerator.generate()
    const expiresAt = new Date(this.clock.now().getTime() + CHALLENGE_TTL_MS)
    await this.challengeStore.save(user.id, { challenge, expiresAt })

    return Result.ok(challenge)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/use-cases/request-challenge/RequestChallengeUseCase.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/request-challenge/
git commit -m "feat: add RequestChallengeUseCase"
```

---

### Task 3: `VerifyChallengeUseCase`

**Files:**
- Create: `src/use-cases/verify-challenge/VerifyChallengeUseCase.ts`
- Test: `src/use-cases/verify-challenge/VerifyChallengeUseCase.test.ts`

**Interfaces:**
- Consumes: `UserRepository.findById` (existing), `ChallengeStore.take(userId)` (Task 1), `Clock.now()` (existing), `CryptoProvider.verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean` (existing port), `Hash.create` / `SignatureBytes.create` (existing value objects), `AuthenticationFailedError` (Task 1), `UserNotFoundError` / `InvalidValueError` (existing).
- Produces: `VerifyChallengeUseCase` with `execute(input: {userId: string, signatureBytes: Uint8Array}): Promise<Result<User, VerifyChallengeError>>` where `VerifyChallengeError = UserNotFoundError | AuthenticationFailedError | InvalidValueError`. Returns the full `User` (not just the id) because sub-project 2 will need its role. Task 4's route depends on this.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/verify-challenge/VerifyChallengeUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { VerifyChallengeUseCase } from './VerifyChallengeUseCase.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeChallengeStore } from '../testing/FakeChallengeStore.js'
import { FakeClock } from '../testing/FakeClock.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'

const NOW = new Date('2026-08-21T00:00:00Z')
const CHALLENGE = new Uint8Array(32).fill(3)

function aUser(): User {
  return User.create({
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value
  }).value
}

function setup() {
  const userRepository = new FakeUserRepository()
  const challengeStore = new FakeChallengeStore()
  const clock = new FakeClock(NOW)
  const crypto = new FakeCryptoProvider()
  const useCase = new VerifyChallengeUseCase(userRepository, challengeStore, clock, crypto)
  return { userRepository, challengeStore, clock, crypto, useCase }
}

/** A signature the FakeCryptoProvider will accept for this user over CHALLENGE. */
function validSignatureFor(user: User, crypto: FakeCryptoProvider): Uint8Array {
  return crypto.sign(user.publicKey, Hash.create(CHALLENGE).value).toBytes()
}

describe('VerifyChallengeUseCase', () => {
  it('returns the user when the signature verifies', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.id).toBe('user-1')
  })

  it('fails when the user does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      userId: 'missing-user',
      signatureBytes: new Uint8Array(64).fill(9)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('fails when there is no pending challenge', async () => {
    const { userRepository, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('fails when the challenge has expired', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() - 1)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('fails when the signature does not verify', async () => {
    const { userRepository, challengeStore, useCase } = setup()
    userRepository.users.push(aUser())
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: new Uint8Array(64).fill(9)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('fails with InvalidValueError when the signature is not 64 bytes', async () => {
    const { userRepository, challengeStore, useCase } = setup()
    userRepository.users.push(aUser())
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: new Uint8Array([1, 2, 3])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidValueError)
  })

  it('consumes the challenge so the same signature cannot be replayed', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })
    const signature = validSignatureFor(user, crypto)

    const first = await useCase.execute({ userId: 'user-1', signatureBytes: signature })
    const second = await useCase.execute({ userId: 'user-1', signatureBytes: signature })

    expect(first.isOk()).toBe(true)
    expect(second.isFail()).toBe(true)
    expect(second.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('consumes the challenge even when verification fails, so it cannot be retried', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    await useCase.execute({ userId: 'user-1', signatureBytes: new Uint8Array(64).fill(9) })
    const retry = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(retry.isFail()).toBe(true)
    expect(retry.error).toBeInstanceOf(AuthenticationFailedError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/use-cases/verify-challenge/VerifyChallengeUseCase.test.ts`
Expected: FAIL — `VerifyChallengeUseCase.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/verify-challenge/VerifyChallengeUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { User } from '../../domain/entities/User.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { CryptoProvider } from '../../domain/ports/CryptoProvider.js'
import { UserRepository } from '../ports/UserRepository.js'
import { ChallengeStore } from '../ports/ChallengeStore.js'
import { Clock } from '../ports/Clock.js'

export interface VerifyChallengeInput {
  userId: string
  signatureBytes: Uint8Array
}

export type VerifyChallengeError = UserNotFoundError | AuthenticationFailedError | InvalidValueError

export class VerifyChallengeUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly challengeStore: ChallengeStore,
    private readonly clock: Clock,
    private readonly crypto: CryptoProvider
  ) {}

  async execute(input: VerifyChallengeInput): Promise<Result<User, VerifyChallengeError>> {
    const user = await this.userRepository.findById(input.userId)
    if (user === null) {
      return Result.fail(new UserNotFoundError(input.userId))
    }

    // take() removes the challenge here, before verification runs, so a nonce
    // is single-use whether or not the signature turns out to be valid.
    const pending = await this.challengeStore.take(input.userId)
    if (pending === null) {
      return Result.fail(new AuthenticationFailedError())
    }

    if (this.clock.now().getTime() > pending.expiresAt.getTime()) {
      return Result.fail(new AuthenticationFailedError())
    }

    const signatureResult = SignatureBytes.create(input.signatureBytes)
    if (signatureResult.isFail()) {
      return Result.fail(signatureResult.error)
    }

    const messageResult = Hash.create(pending.challenge)
    if (messageResult.isFail()) {
      return Result.fail(messageResult.error)
    }

    const isValid = this.crypto.verify(user.publicKey, messageResult.value, signatureResult.value)
    if (!isValid) {
      return Result.fail(new AuthenticationFailedError())
    }

    return Result.ok(user)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/use-cases/verify-challenge/VerifyChallengeUseCase.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/verify-challenge/
git commit -m "feat: add VerifyChallengeUseCase"
```

---

### Task 4: Auth routes, JWT issuing, config, composition wiring

**Files:**
- Create: `src/infrastructure/config.ts`
- Create: `src/interface-adapters/http/routes/auth.ts`
- Modify: `src/infrastructure/composition.ts`
- Modify: `src/interface-adapters/http/app.ts`
- Modify: `.env` (gitignored — add `JWT_SECRET`)
- Test: `src/interface-adapters/http/auth.integration.test.ts`

**Interfaces:**
- Consumes: `RequestChallengeUseCase` (Task 2), `VerifyChallengeUseCase` (Task 3), `sign` from `hono/jwt`, `mapDomainErrorToResponse` (existing), `ensureSeedUsers` from `src/infrastructure/db/testSupport.js` and `ed25519TestKeys`/`signWithTestKey` from `src/infrastructure/testing/ed25519TestKeys.js` (existing, test only).
- Produces: `POST /auth/challenge` → `200 {challenge: base64}`; `POST /auth/token` → `200 {token: string}`; `requireJwtSecret(): string`; `Dependencies` gains `requestChallengeUseCase`, `verifyChallengeUseCase`, and `jwtSecret: string`; the exported constant `TOKEN_TTL_SECONDS = 3600`. Task 5 consumes `dependencies.jwtSecret` for the middleware.

- [ ] **Step 1: Add `JWT_SECRET` to `.env`**

`.env` is gitignored and already contains `DATABASE_URL`. Append a line with a freshly generated random secret — generate one rather than inventing a memorable string:

```bash
node -e "console.log('JWT_SECRET=' + require('node:crypto').randomBytes(32).toString('base64'))" >> .env
```

Verify it landed: `grep -c JWT_SECRET .env` should print `1`. `vitest.setup.ts` calls `process.loadEnvFile('.env')`, so tests pick it up automatically.

- [ ] **Step 2: Write the failing tests**

Create `src/interface-adapters/http/auth.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
import { app } from './app.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'

beforeAll(async () => {
  await ensureSeedUsers()
})

async function requestChallenge(userId: string) {
  const res = await app.request('/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  })
  return res
}

describe('POST /auth/challenge', () => {
  it('returns a 32-byte base64 challenge for a known user', async () => {
    const res = await requestChallenge('user-alice')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.challenge).toBe('string')
    expect(Buffer.from(body.challenge, 'base64').length).toBe(32)
  })

  it('returns 404 for an unknown user', async () => {
    const res = await requestChallenge('missing-user')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('UserNotFoundError')
  })

  it('returns 400 when userId is missing', async () => {
    const res = await app.request('/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /auth/token', () => {
  it('issues a JWT when the challenge is signed with the real private key', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signWithTestKey(ed25519TestKeys.alice, new Uint8Array(Buffer.from(challenge, 'base64')))

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.split('.')).toHaveLength(3)
  })

  it('returns 401 when the signature is made with the wrong key', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signWithTestKey(ed25519TestKeys.bob, new Uint8Array(Buffer.from(challenge, 'base64')))

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    expect(res.status).toBe(401)
  })

  it('returns 401 when no challenge was requested first', async () => {
    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-carol',
        signature: Buffer.from(new Uint8Array(64).fill(9)).toString('base64')
      })
    })

    expect(res.status).toBe(401)
  })

  it('rejects a replayed signature (nonce is single-use)', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signWithTestKey(ed25519TestKeys.alice, new Uint8Array(Buffer.from(challenge, 'base64')))
    const payload = JSON.stringify({
      userId: 'user-alice',
      signature: Buffer.from(signature).toString('base64')
    })
    const headers = { 'Content-Type': 'application/json' }

    const first = await app.request('/auth/token', { method: 'POST', headers, body: payload })
    const replay = await app.request('/auth/token', { method: 'POST', headers, body: payload })

    expect(first.status).toBe(200)
    expect(replay.status).toBe(401)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/interface-adapters/http/auth.integration.test.ts`
Expected: FAIL — the `/auth/*` routes do not exist yet, so requests 404.

- [ ] **Step 4: Write the config module**

Create `src/infrastructure/config.ts`:

```ts
/**
 * Read at composition time so a missing secret fails the process at startup
 * with a clear message, rather than silently signing tokens with `undefined`.
 */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT_SECRET environment variable is required but was not set')
  }
  return secret
}
```

- [ ] **Step 5: Write the auth routes**

Create `src/interface-adapters/http/routes/auth.ts`:

```ts
import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { decodeBase64 } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'

export const TOKEN_TTL_SECONDS = 3600

export function createAuthRoutes(dependencies: Dependencies): Hono {
  const auth = new Hono()

  auth.post('/auth/challenge', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.userId !== 'string' || body.userId.length === 0) {
      return c.json({ error: { type: 'ValidationError', message: 'userId is required' } }, 400)
    }

    const result = await dependencies.requestChallengeUseCase.execute({ userId: body.userId })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json({ challenge: Buffer.from(result.value).toString('base64') }, 200)
  })

  auth.post('/auth/token', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      body === null ||
      typeof body.userId !== 'string' ||
      body.userId.length === 0 ||
      typeof body.signature !== 'string'
    ) {
      return c.json({ error: { type: 'ValidationError', message: 'userId and signature are required' } }, 400)
    }

    const result = await dependencies.verifyChallengeUseCase.execute({
      userId: body.userId,
      signatureBytes: decodeBase64(body.signature)
    })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    const token = await sign(
      {
        sub: result.value.id,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
      },
      dependencies.jwtSecret
    )

    return c.json({ token }, 200)
  })

  return auth
}
```

- [ ] **Step 6: Wire into the composition root**

In `src/infrastructure/composition.ts`, add these imports alongside the existing ones:

```ts
import { InMemoryChallengeStore } from './InMemoryChallengeStore.js'
import { RandomNonceGenerator } from './RandomNonceGenerator.js'
import { requireJwtSecret } from './config.js'
import { RequestChallengeUseCase } from '../use-cases/request-challenge/RequestChallengeUseCase.js'
import { VerifyChallengeUseCase } from '../use-cases/verify-challenge/VerifyChallengeUseCase.js'
```

Add these three fields to the `Dependencies` interface:

```ts
  requestChallengeUseCase: RequestChallengeUseCase
  verifyChallengeUseCase: VerifyChallengeUseCase
  jwtSecret: string
```

In `createDependencies()`, add these constructions after `getDocumentUseCase`:

```ts
  const challengeStore = new InMemoryChallengeStore()
  const nonceGenerator = new RandomNonceGenerator()
  const jwtSecret = requireJwtSecret()
  const requestChallengeUseCase = new RequestChallengeUseCase(
    userRepository,
    challengeStore,
    nonceGenerator,
    clock
  )
  const verifyChallengeUseCase = new VerifyChallengeUseCase(userRepository, challengeStore, clock, crypto)
```

and add all three to the returned object:

```ts
  return {
    createUserUseCase,
    uploadDocumentUseCase,
    signDocumentUseCase,
    verifyDocumentUseCase,
    listDocumentsUseCase,
    getDocumentUseCase,
    requestChallengeUseCase,
    verifyChallengeUseCase,
    jwtSecret
  }
```

- [ ] **Step 7: Mount the routes**

In `src/interface-adapters/http/app.ts`, add the import:

```ts
import { createAuthRoutes } from './routes/auth.js'
```

and mount it alongside the existing routes (order among `app.route` calls does not matter here — the paths do not overlap):

```ts
app.route('/', createAuthRoutes(dependencies))
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/interface-adapters/http/auth.integration.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 9: Commit**

```bash
git add src/infrastructure/config.ts src/interface-adapters/http/routes/auth.ts src/infrastructure/composition.ts src/interface-adapters/http/app.ts src/interface-adapters/http/auth.integration.test.ts
git commit -m "feat: add POST /auth/challenge and POST /auth/token"
```

(`.env` is gitignored — it will not appear in the commit, which is correct.)

---

### Task 5: Protect the document endpoints and stop trusting client-supplied `userId`

**Files:**
- Create: `src/interface-adapters/http/authContext.ts`
- Create: `src/interface-adapters/http/authTestSupport.ts`
- Modify: `src/interface-adapters/http/app.ts`
- Modify: `src/interface-adapters/http/routes/documents.ts`
- Test: `src/interface-adapters/http/documents.integration.test.ts` (rewrite the existing file)

**Interfaces:**
- Consumes: `dependencies.jwtSecret` (Task 4), the `/auth/*` endpoints (Task 4), `jwt` middleware from `hono/jwt`.
- Produces: `getAuthenticatedUserId(c: Context): string`; `authTokenFor(userId: string, keyPair: Ed25519TestKeyPair): Promise<string>` (test helper); document endpoints that take no `userId` from the client. Task 8's Flutter client depends on the new request shapes.

**Endpoint shape changes** (this is the whole point of the task):

| Endpoint | Before | After |
|---|---|---|
| `GET /documents` | `?userId=X` | no parameter |
| `GET /documents/:documentId` | `?userId=X` | no parameter |
| `POST /documents` | body `{title, uploaderId, fileBytes}` | body `{title, fileBytes}` |
| `POST /documents/:documentId/signatures` | body `{userId, signatureBytes}` | body `{signatureBytes}` |

- [ ] **Step 1: Write the auth context helper**

Create `src/interface-adapters/http/authContext.ts`:

```ts
import type { Context } from 'hono'

/**
 * Reads the authenticated user id from the JWT payload that Hono's `jwt`
 * middleware placed on the context. Throwing here means a route was mounted
 * without the middleware -- a wiring bug, not a client error.
 */
export function getAuthenticatedUserId(c: Context): string {
  const payload = c.get('jwtPayload') as { sub?: unknown } | undefined
  const sub = payload?.sub
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('jwtPayload.sub is missing - this route is not behind the JWT middleware')
  }
  return sub
}
```

- [ ] **Step 2: Write the integration test helper**

Create `src/interface-adapters/http/authTestSupport.ts`:

```ts
import { app } from './app.js'
import { Ed25519TestKeyPair, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'

/**
 * Performs the real challenge-response handshake against the app, so
 * integration tests exercise the genuine flow rather than minting tokens
 * behind the server's back.
 */
export async function authTokenFor(userId: string, keyPair: Ed25519TestKeyPair): Promise<string> {
  const challengeRes = await app.request('/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  })
  const { challenge } = await challengeRes.json()

  const signature = signWithTestKey(keyPair, new Uint8Array(Buffer.from(challenge, 'base64')))

  const tokenRes = await app.request('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, signature: Buffer.from(signature).toString('base64') })
  })
  const { token } = await tokenRes.json()
  return token
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}
```

- [ ] **Step 3: Write the failing tests**

Replace the entire content of `src/interface-adapters/http/documents.integration.test.ts` with:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
import { app } from './app.js'
import { Ed25519CryptoProvider } from '../../infrastructure/Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'
import { authTokenFor, bearer } from './authTestSupport.js'

let aliceToken: string

beforeAll(async () => {
  await ensureSeedUsers()
  aliceToken = await authTokenFor('user-alice', ed25519TestKeys.alice)
})

async function uploadADocument() {
  const res = await app.request('/documents', {
    method: 'POST',
    headers: bearer(aliceToken),
    body: JSON.stringify({
      title: 'Contract',
      fileBytes: Buffer.from('hello world').toString('base64')
    })
  })
  return res.json()
}

function computeAliceSignatureBytes(originalHashHex: string): Uint8Array {
  const crypto = new Ed25519CryptoProvider()
  const message = crypto.hash(Buffer.from(originalHashHex, 'hex'))
  return signWithTestKey(ed25519TestKeys.alice, message.toBytes())
}

describe('authentication is required', () => {
  it('rejects GET /documents with no token', async () => {
    const res = await app.request('/documents')

    expect(res.status).toBe(401)
  })

  it('rejects GET /documents/:documentId with no token', async () => {
    const res = await app.request('/documents/any-id')

    expect(res.status).toBe(401)
  })

  it('rejects POST /documents with no token', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', fileBytes: '' })
    })

    expect(res.status).toBe(401)
  })

  it('rejects POST /documents/:documentId/signatures with no token', async () => {
    const res = await app.request('/documents/any-id/signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureBytes: '' })
    })

    expect(res.status).toBe(401)
  })

  it('rejects GET /documents/:documentId/verify with no token', async () => {
    const res = await app.request('/documents/any-id/verify')

    expect(res.status).toBe(401)
  })

  it('rejects a malformed token', async () => {
    const res = await app.request('/documents', {
      headers: { Authorization: 'Bearer not-a-real-token' }
    })

    expect(res.status).toBe(401)
  })
})

describe('POST /documents', () => {
  it('uploads a document, taking uploaderId from the token', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({
        title: 'Contract',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Contract')
    expect(body.uploaderId).toBe('user-alice')
    expect(typeof body.id).toBe('string')
  })

  it('returns 400 when title is missing', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ fileBytes: Buffer.from('x').toString('base64') })
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /documents/:documentId/signatures', () => {
  it('signs an uploaded document, taking userId from the token', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)

    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
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
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(new Uint8Array(64)).toString('base64') })
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
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toHaveLength(1)
  })

  it('returns 404 when verifying a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/verify', { headers: bearer(aliceToken) })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })
})

describe('GET /documents', () => {
  it('lists documents with signedByUser computed for the token holder', async () => {
    const document = await uploadADocument()

    const res = await app.request('/documents', { headers: bearer(aliceToken) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toContainEqual({
      id: document.id,
      title: 'Contract',
      uploaderId: 'user-alice',
      signedByUser: false
    })
  })
})

describe('GET /documents/:documentId', () => {
  it('returns document detail with a signing payload for an unsigned document', async () => {
    const document = await uploadADocument()

    const res = await app.request(`/documents/${document.id}`, { headers: bearer(aliceToken) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(document.id)
    expect(body.signedByUser).toBe(false)
    expect(typeof body.signingPayload).toBe('string')
  })

  it('returns signedByUser: true and a null signing payload after the token holder signs', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    const res = await app.request(`/documents/${document.id}`, { headers: bearer(aliceToken) })

    const body = await res.json()
    expect(body.signedByUser).toBe(true)
    expect(body.signingPayload).toBeNull()
  })

  it('returns 404 for a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc', { headers: bearer(aliceToken) })

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/interface-adapters/http/documents.integration.test.ts`
Expected: FAIL — no middleware is mounted, so the "authentication is required" tests get `200`/`400` instead of `401`, and the upload tests fail because the route still demands `uploaderId` in the body.

- [ ] **Step 5: Mount the JWT middleware**

In `src/interface-adapters/http/app.ts`, add the import:

```ts
import { jwt } from 'hono/jwt'
```

and add these two lines **after** `app.use('*', cors())` and **before** the `app.route(...)` calls. Both paths are needed: Hono's `/documents/*` pattern does not match the bare `/documents` path.

```ts
app.use('/documents', jwt({ secret: dependencies.jwtSecret }))
app.use('/documents/*', jwt({ secret: dependencies.jwtSecret }))
```

- [ ] **Step 6: Take `userId` from the token in the document routes**

Replace the entire content of `src/interface-adapters/http/routes/documents.ts` with:

```ts
import { Hono } from 'hono'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { toDocumentJson, toSignatureJson, decodeBase64, toDocumentDetailJson } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'
import { DocumentNotFoundError } from '../../../domain/errors/DocumentNotFoundError.js'
import { getAuthenticatedUserId } from '../authContext.js'

export function createDocumentsRoutes(dependencies: Dependencies): Hono {
  const documents = new Hono()

  documents.post('/documents', async (c) => {
    const uploaderId = getAuthenticatedUserId(c)
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.title !== 'string' || typeof body.fileBytes !== 'string') {
      return c.json(
        { error: { type: 'ValidationError', message: 'title and fileBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.uploadDocumentUseCase.execute({
      title: body.title,
      uploaderId,
      fileBytes: decodeBase64(body.fileBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentJson(result.value), 201)
  })

  documents.post('/documents/:documentId/signatures', async (c) => {
    const userId = getAuthenticatedUserId(c)
    const documentId = c.req.param('documentId')
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.signatureBytes !== 'string') {
      return c.json({ error: { type: 'ValidationError', message: 'signatureBytes is required' } }, 400)
    }

    const result = await dependencies.signDocumentUseCase.execute({
      documentId,
      userId,
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

  documents.get('/documents', async (c) => {
    const userId = getAuthenticatedUserId(c)

    const summaries = await dependencies.listDocumentsUseCase.execute({ userId })
    return c.json(summaries, 200)
  })

  documents.get('/documents/:documentId', async (c) => {
    const userId = getAuthenticatedUserId(c)
    const documentId = c.req.param('documentId')

    const result = await dependencies.getDocumentUseCase.execute({ documentId, userId })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentDetailJson(result.value), 200)
  })

  return documents
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/interface-adapters/http/documents.integration.test.ts`
Expected: PASS — 15 tests passed.

- [ ] **Step 8: Run the full backend suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all tests pass, no type errors. The use-case unit tests are untouched by design — if any fail, something changed that should not have.

- [ ] **Step 9: Commit**

```bash
git add src/interface-adapters/http/authContext.ts src/interface-adapters/http/authTestSupport.ts src/interface-adapters/http/app.ts src/interface-adapters/http/routes/documents.ts src/interface-adapters/http/documents.integration.test.ts
git commit -m "feat: require JWT on document endpoints, derive userId from token"
```

---

### Task 6: Flutter `AuthApi`

**Files:**
- Create: `flutter_digital_sign/lib/core/network/auth_api.dart`
- Test: `flutter_digital_sign/test/core/network/http_auth_api_test.dart`
- Create: `flutter_digital_sign/test/core/network/fake_auth_api.dart` (test helper, no tests of its own)

**Interfaces:**
- Consumes: `http.Client` / `http.Response` from `package:http/http.dart`; `MockClient` from `package:http/testing.dart` (test only). Backend endpoints from Task 4.
- Produces: `UnknownIdentityException`; `AuthApi` (abstract) with `requestChallenge(String userId) -> Future<List<int>>` and `exchangeForToken(String userId, List<int> signature) -> Future<String>`; `HttpAuthApi({String baseUrl = 'http://localhost:3000', http.Client? client})`; `FakeAuthApi`. Task 7's `AuthSession` depends on all of these.

- [ ] **Step 1: Write the failing tests**

Create `flutter_digital_sign/test/core/network/http_auth_api_test.dart`:

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/network/auth_api.dart';

void main() {
  group('HttpAuthApi.requestChallenge', () {
    test('posts the userId and returns the decoded challenge bytes', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/auth/challenge');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-1');
        return http.Response(jsonEncode({'challenge': base64Encode([1, 2, 3])}), 200);
      });
      final api = HttpAuthApi(client: mockClient);

      final challenge = await api.requestChallenge('user-1');

      expect(challenge, [1, 2, 3]);
    });

    test('throws UnknownIdentityException on 404', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'UserNotFoundError', 'message': 'User user-1 was not found'}
          }),
          404,
        );
      });
      final api = HttpAuthApi(client: mockClient);

      expect(
        () => api.requestChallenge('user-1'),
        throwsA(isA<UnknownIdentityException>()),
      );
    });

    test('throws a generic Exception on a server error', () async {
      final mockClient = MockClient((request) async => http.Response('boom', 500));
      final api = HttpAuthApi(client: mockClient);

      expect(() => api.requestChallenge('user-1'), throwsA(isA<Exception>()));
    });
  });

  group('HttpAuthApi.exchangeForToken', () {
    test('posts the base64 signature and returns the token', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/auth/token');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-1');
        expect(body['signature'], base64Encode([9, 9, 9]));
        return http.Response(jsonEncode({'token': 'a.b.c'}), 200);
      });
      final api = HttpAuthApi(client: mockClient);

      final token = await api.exchangeForToken('user-1', [9, 9, 9]);

      expect(token, 'a.b.c');
    });

    test('throws on 401', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'AuthenticationFailedError', 'message': 'Authentication failed'}
          }),
          401,
        );
      });
      final api = HttpAuthApi(client: mockClient);

      expect(() => api.exchangeForToken('user-1', [9, 9, 9]), throwsA(isA<Exception>()));
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/network/http_auth_api_test.dart`
Expected: FAIL — `auth_api.dart` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `flutter_digital_sign/lib/core/network/auth_api.dart`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Thrown when the server does not recognise the identity stored on this
/// device. The private key can never be re-associated with a server-side
/// account, so the only recovery is to discard it and register again.
class UnknownIdentityException implements Exception {
  @override
  String toString() => 'UnknownIdentityException: this device\'s identity is unknown to the server';
}

abstract class AuthApi {
  Future<List<int>> requestChallenge(String userId);
  Future<String> exchangeForToken(String userId, List<int> signature);
}

class HttpAuthApi implements AuthApi {
  final String baseUrl;
  final http.Client _client;

  HttpAuthApi({this.baseUrl = 'http://localhost:3000', http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<List<int>> requestChallenge(String userId) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/auth/challenge'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'userId': userId}),
    );

    if (response.statusCode == 404) {
      throw UnknownIdentityException();
    }
    if (response.statusCode != 200) {
      throw Exception('Failed to request challenge');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return base64Decode(body['challenge'] as String);
  }

  @override
  Future<String> exchangeForToken(String userId, List<int> signature) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/auth/token'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'userId': userId,
        'signature': base64Encode(signature),
      }),
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to exchange challenge for token');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['token'] as String;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/core/network/http_auth_api_test.dart`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Write `FakeAuthApi`**

Create `flutter_digital_sign/test/core/network/fake_auth_api.dart`:

```dart
import 'package:flutter_digital_sign/core/network/auth_api.dart';

class FakeAuthApi implements AuthApi {
  List<int> Function(String userId)? onRequestChallenge;
  String Function(String userId, List<int> signature)? onExchangeForToken;

  final List<String> challengeCalls = [];
  final List<({String userId, List<int> signature})> tokenCalls = [];

  @override
  Future<List<int>> requestChallenge(String userId) async {
    challengeCalls.add(userId);
    return onRequestChallenge?.call(userId) ?? List<int>.filled(32, 3);
  }

  @override
  Future<String> exchangeForToken(String userId, List<int> signature) async {
    tokenCalls.add((userId: userId, signature: signature));
    return onExchangeForToken?.call(userId, signature) ?? 'fake-token';
  }
}
```

- [ ] **Step 6: Run analysis and the network test directory**

Run: `flutter analyze lib/core/network/auth_api.dart test/core/network/`
Expected: no issues found.

Run: `flutter test test/core/network/`
Expected: PASS — the 5 new tests plus the existing `http_user_api_test.dart` and `http_document_api_test.dart` tests.

- [ ] **Step 7: Commit**

```bash
git add flutter_digital_sign/lib/core/network/auth_api.dart flutter_digital_sign/test/core/network/http_auth_api_test.dart flutter_digital_sign/test/core/network/fake_auth_api.dart
git commit -m "feat: add Flutter AuthApi, HttpAuthApi, and FakeAuthApi"
```

---

### Task 7: `AuthSession` and `IdentityStorage.clear()`

**Files:**
- Create: `flutter_digital_sign/lib/core/auth/auth_session.dart`
- Modify: `flutter_digital_sign/lib/core/storage/identity_storage.dart`
- Test: `flutter_digital_sign/test/core/auth/auth_session_test.dart`
- Test: `flutter_digital_sign/test/core/storage/identity_storage_test.dart` (add a case to the existing file)

**Interfaces:**
- Consumes: `AuthApi`, `UnknownIdentityException` (Task 6), `FakeAuthApi` (Task 6, test only), `IdentityStorage` / `StoredIdentity` (existing), `Ed25519KeyPair.sign(List<int> privateKeyBytes, List<int> message) -> Future<List<int>>` (existing).
- Produces: `AuthSession({required AuthApi authApi, required IdentityStorage identityStorage})` with `Future<String> token()` and `void invalidate()`; `IdentityStorage.clear() -> Future<void>`. Task 8's `HttpDocumentApi` depends on `AuthSession`.

- [ ] **Step 1: Write the failing tests**

Create `flutter_digital_sign/test/core/auth/auth_session_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'package:flutter_digital_sign/core/network/auth_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import '../network/fake_auth_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<IdentityStorage> storageWithIdentity() async {
    final storage = IdentityStorage();
    await storage.save('user-1', List<int>.filled(32, 1), List<int>.generate(32, (i) => i));
    return storage;
  }

  test('performs the handshake and returns the token', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => 'token-abc');
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    final token = await session.token();

    expect(token, 'token-abc');
    expect(fakeAuthApi.challengeCalls, ['user-1']);
    expect(fakeAuthApi.tokenCalls, hasLength(1));
    expect(fakeAuthApi.tokenCalls.first.userId, 'user-1');
    expect(fakeAuthApi.tokenCalls.first.signature, hasLength(64));
  });

  test('caches the token so a second call performs no new handshake', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi();
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    await session.token();
    await session.token();

    expect(fakeAuthApi.challengeCalls, hasLength(1));
    expect(fakeAuthApi.tokenCalls, hasLength(1));
  });

  test('invalidate forces a fresh handshake on the next call', () async {
    final identityStorage = await storageWithIdentity();
    var issued = 0;
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => 'token-${++issued}');
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    final first = await session.token();
    session.invalidate();
    final second = await session.token();

    expect(first, 'token-1');
    expect(second, 'token-2');
    expect(fakeAuthApi.challengeCalls, hasLength(2));
  });

  test('throws UnknownIdentityException when no identity is stored', () async {
    final fakeAuthApi = FakeAuthApi();
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: IdentityStorage());

    expect(() => session.token(), throwsA(isA<UnknownIdentityException>()));
    expect(fakeAuthApi.challengeCalls, isEmpty);
  });

  test('propagates UnknownIdentityException when the server does not know the identity', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onRequestChallenge = ((userId) => throw UnknownIdentityException());
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    expect(() => session.token(), throwsA(isA<UnknownIdentityException>()));
  });
}
```

Add to the existing `flutter_digital_sign/test/core/storage/identity_storage_test.dart`, inside the existing `void main() { ... }` block after the current tests:

```dart
  test('clear removes the saved identity', () async {
    final storage = IdentityStorage();
    await storage.save('user-123', [1, 2, 3], [4, 5, 6]);

    await storage.clear();

    expect(await storage.load(), isNull);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/auth/auth_session_test.dart test/core/storage/identity_storage_test.dart`
Expected: FAIL — `auth_session.dart` does not exist and `IdentityStorage` has no `clear` method.

- [ ] **Step 3: Add `clear()` to `IdentityStorage`**

In `flutter_digital_sign/lib/core/storage/identity_storage.dart`, add this method to the `IdentityStorage` class, after `load()`:

```dart
  Future<void> clear() async {
    await _storage.delete(key: _userIdKey);
    await _storage.delete(key: _publicKeyKey);
    await _storage.delete(key: _privateKeyKey);
  }
```

- [ ] **Step 4: Write `AuthSession`**

Create `flutter_digital_sign/lib/core/auth/auth_session.dart`:

```dart
import '../crypto/ed25519_key_pair.dart';
import '../network/auth_api.dart';
import '../storage/identity_storage.dart';

/// Obtains and caches a session token by proving possession of this device's
/// Ed25519 private key.
///
/// The token is held in memory only, never written to secure storage:
/// re-authenticating costs one round trip and needs no user interaction, so
/// persisting a bearer token would add attack surface and buy nothing.
class AuthSession {
  final AuthApi _authApi;
  final IdentityStorage _identityStorage;
  String? _token;

  AuthSession({
    required AuthApi authApi,
    required IdentityStorage identityStorage,
  })  : _authApi = authApi,
        _identityStorage = identityStorage;

  Future<String> token() async {
    final cached = _token;
    if (cached != null) {
      return cached;
    }

    final identity = await _identityStorage.load();
    if (identity == null) {
      throw UnknownIdentityException();
    }

    final challenge = await _authApi.requestChallenge(identity.userId);
    final signature = await Ed25519KeyPair.sign(identity.privateKeyBytes, challenge);
    final token = await _authApi.exchangeForToken(identity.userId, signature);

    _token = token;
    return token;
  }

  void invalidate() {
    _token = null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/core/auth/auth_session_test.dart test/core/storage/identity_storage_test.dart`
Expected: PASS — 5 `AuthSession` tests and 3 `IdentityStorage` tests.

- [ ] **Step 6: Commit**

```bash
git add flutter_digital_sign/lib/core/auth/auth_session.dart flutter_digital_sign/lib/core/storage/identity_storage.dart flutter_digital_sign/test/core/auth/auth_session_test.dart flutter_digital_sign/test/core/storage/identity_storage_test.dart
git commit -m "feat: add AuthSession and IdentityStorage.clear()"
```

---

### Task 8: Authenticate `HttpDocumentApi` and update its callers

**Files:**
- Modify: `flutter_digital_sign/lib/core/network/document_api.dart`
- Modify: `flutter_digital_sign/test/core/network/fake_document_api.dart`
- Modify: `flutter_digital_sign/test/core/network/http_document_api_test.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/next_page.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/document_details_page.dart`
- Modify: `flutter_digital_sign/test/document_selection_test.dart`
- Modify: `flutter_digital_sign/test/signing_flow_test.dart`

**Interfaces:**
- Consumes: `AuthSession` (Task 7), `UnknownIdentityException` (Task 6), `AppRoutes.register` (existing, equals `'/register'`).
- Produces: `DocumentApi` methods without `userId` parameters — `listDocuments()`, `getDocument(String documentId)`, `uploadDocument(String title, List<int> fileBytes)`, `submitSignature(String documentId, List<int> signatureBytes)`; `HttpDocumentApi({String baseUrl, http.Client? client, required AuthSession authSession})`.

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `flutter_digital_sign/test/core/network/http_document_api_test.dart` with:

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'fake_auth_api.dart';

Future<AuthSession> aSession({String token = 'tok-1'}) async {
  final identityStorage = IdentityStorage();
  await identityStorage.save('user-1', List<int>.filled(32, 1), List<int>.generate(32, (i) => i));
  final authApi = FakeAuthApi()..onExchangeForToken = ((userId, signature) => token);
  return AuthSession(authApi: authApi, identityStorage: identityStorage);
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('HttpDocumentApi.listDocuments', () {
    test('sends the bearer token and no userId parameter', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), 'http://localhost:3000/documents');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        return http.Response(
          jsonEncode([
            {'id': 'doc-1', 'title': 'Contract', 'uploaderId': 'user-1', 'signedByUser': false}
          ]),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.listDocuments();

      expect(result, hasLength(1));
      expect(result.first.id, 'doc-1');
    });

    test('re-authenticates and retries exactly once on 401', () async {
      var calls = 0;
      final mockClient = MockClient((request) async {
        calls++;
        if (calls == 1) {
          return http.Response(jsonEncode({'error': 'expired'}), 401);
        }
        return http.Response(jsonEncode([]), 200);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.listDocuments();

      expect(calls, 2);
      expect(result, isEmpty);
    });

    test('does not loop when the retry also returns 401', () async {
      var calls = 0;
      final mockClient = MockClient((request) async {
        calls++;
        return http.Response(jsonEncode({'error': 'expired'}), 401);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      await expectLater(() => api.listDocuments(), throwsA(isA<Exception>()));
      expect(calls, 2);
    });
  });

  group('HttpDocumentApi.getDocument', () {
    test('requests the document with no userId parameter', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1');
        expect(request.headers['Authorization'], 'Bearer tok-1');
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
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.getDocument('doc-1');

      expect(result.signingPayload, [1, 2, 3]);
    });
  });

  group('HttpDocumentApi.uploadDocument', () {
    test('posts title and fileBytes only, with the bearer token', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['title'], 'Contract.pdf');
        expect(body['fileBytes'], base64Encode([1, 2, 3]));
        expect(body.containsKey('uploaderId'), isFalse);
        return http.Response(jsonEncode({'id': 'doc-1'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.uploadDocument('Contract.pdf', [1, 2, 3]);

      expect(result, isA<UploadSuccess>());
      expect((result as UploadSuccess).documentId, 'doc-1');
    });
  });

  group('HttpDocumentApi.submitSignature', () {
    test('posts signatureBytes only, with the bearer token', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1/signatures');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['signatureBytes'], base64Encode([9, 9, 9]));
        expect(body.containsKey('userId'), isFalse);
        return http.Response(jsonEncode({'id': 'sig-1'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.submitSignature('doc-1', [9, 9, 9]);

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
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.submitSignature('doc-1', [9, 9, 9]);

      expect(result, isA<SignFailure>());
      expect((result as SignFailure).message, 'User user-1 has already signed this document');
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/network/http_document_api_test.dart`
Expected: FAIL — `HttpDocumentApi` has no `authSession` parameter and its methods still require `userId`.

- [ ] **Step 3: Update `DocumentApi` and `HttpDocumentApi`**

In `flutter_digital_sign/lib/core/network/document_api.dart`, add this import at the top:

```dart
import '../auth/auth_session.dart';
```

Replace the `abstract class DocumentApi { ... }` block with:

```dart
abstract class DocumentApi {
  Future<List<DocumentSummary>> listDocuments();
  Future<DocumentDetail> getDocument(String documentId);
  Future<UploadResult> uploadDocument(String title, List<int> fileBytes);
  Future<SignResult> submitSignature(String documentId, List<int> signatureBytes);
}
```

Replace the entire `class HttpDocumentApi implements DocumentApi { ... }` block with:

```dart
class HttpDocumentApi implements DocumentApi {
  final String baseUrl;
  final http.Client _client;
  final AuthSession _authSession;

  HttpDocumentApi({
    this.baseUrl = 'http://localhost:3000',
    http.Client? client,
    required AuthSession authSession,
  })  : _client = client ?? http.Client(),
        _authSession = authSession;

  /// Sends [request] with a bearer token. On a 401 the token is discarded and
  /// the request is retried exactly once with a freshly obtained one, which is
  /// what makes token expiry invisible to the caller.
  Future<http.Response> _send(Future<http.Response> Function(String token) request) async {
    var response = await request(await _authSession.token());
    if (response.statusCode == 401) {
      _authSession.invalidate();
      response = await request(await _authSession.token());
    }
    return response;
  }

  Map<String, String> _headers(String token) => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  @override
  Future<List<DocumentSummary>> listDocuments() async {
    final response = await _send(
      (token) => _client.get(Uri.parse('$baseUrl/documents'), headers: _headers(token)),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to load documents');
    }
    final body = jsonDecode(response.body) as List;
    return body.map((d) => DocumentSummary.fromJson(d as Map<String, dynamic>)).toList();
  }

  @override
  Future<DocumentDetail> getDocument(String documentId) async {
    final response = await _send(
      (token) => _client.get(Uri.parse('$baseUrl/documents/$documentId'), headers: _headers(token)),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to load document');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return DocumentDetail.fromJson(body);
  }

  @override
  Future<UploadResult> uploadDocument(String title, List<int> fileBytes) async {
    final response = await _send(
      (token) => _client.post(
        Uri.parse('$baseUrl/documents'),
        headers: _headers(token),
        body: jsonEncode({'title': title, 'fileBytes': base64Encode(fileBytes)}),
      ),
    );

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 201) {
      return UploadSuccess(body['id'] as String);
    }

    final error = body['error'] as Map<String, dynamic>?;
    return UploadFailure(error?['message'] as String? ?? 'Upload failed');
  }

  @override
  Future<SignResult> submitSignature(String documentId, List<int> signatureBytes) async {
    final response = await _send(
      (token) => _client.post(
        Uri.parse('$baseUrl/documents/$documentId/signatures'),
        headers: _headers(token),
        body: jsonEncode({'signatureBytes': base64Encode(signatureBytes)}),
      ),
    );

    if (response.statusCode == 201) {
      return SignSuccess();
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final error = body['error'] as Map<String, dynamic>?;
    return SignFailure(error?['message'] as String? ?? 'Signing failed');
  }
}
```

- [ ] **Step 4: Update `FakeDocumentApi`**

Replace the entire content of `flutter_digital_sign/test/core/network/fake_document_api.dart` with:

```dart
import 'package:flutter_digital_sign/core/network/document_api.dart';

class FakeDocumentApi implements DocumentApi {
  List<DocumentSummary> Function()? onListDocuments;
  DocumentDetail Function(String documentId)? onGetDocument;
  UploadResult Function(String title, List<int> fileBytes)? onUploadDocument;
  SignResult Function(String documentId, List<int> signatureBytes)? onSubmitSignature;

  int listCalls = 0;
  final List<String> getCalls = [];
  final List<({String title, List<int> fileBytes})> uploadCalls = [];
  final List<({String documentId, List<int> signatureBytes})> signCalls = [];

  @override
  Future<List<DocumentSummary>> listDocuments() async {
    listCalls++;
    return onListDocuments?.call() ?? [];
  }

  @override
  Future<DocumentDetail> getDocument(String documentId) async {
    getCalls.add(documentId);
    return onGetDocument!.call(documentId);
  }

  @override
  Future<UploadResult> uploadDocument(String title, List<int> fileBytes) async {
    uploadCalls.add((title: title, fileBytes: fileBytes));
    return onUploadDocument?.call(title, fileBytes) ?? UploadSuccess('fake-document-id');
  }

  @override
  Future<SignResult> submitSignature(String documentId, List<int> signatureBytes) async {
    signCalls.add((documentId: documentId, signatureBytes: signatureBytes));
    return onSubmitSignature?.call(documentId, signatureBytes) ?? SignSuccess();
  }
}
```

- [ ] **Step 5: Update `NextPage` to build an authenticated client**

Replace the entire content of `flutter_digital_sign/lib/features/next/presentation/pages/next_page.dart` with:

```dart
import 'package:flutter/material.dart';
import '../widgets/next_content.dart';
import '../../../../core/auth/auth_session.dart';
import '../../../../core/network/auth_api.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class NextPage extends StatefulWidget {
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;

  const NextPage({super.key, this.documentApi, this.identityStorage});

  @override
  State<NextPage> createState() => _NextPageState();
}

class _NextPageState extends State<NextPage> {
  late final DocumentApi _documentApi;
  late final IdentityStorage _identityStorage;

  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _documentApi = widget.documentApi ??
        HttpDocumentApi(
          authSession: AuthSession(
            authApi: HttpAuthApi(),
            identityStorage: _identityStorage,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Signature'),
      ),
      body: NextContent(
        documentApi: _documentApi,
        identityStorage: _identityStorage,
      ),
    );
  }
}
```

(`NextPage` becomes stateful so the `AuthSession` — and therefore its cached token — is built once in `initState` rather than being recreated on every rebuild.)

- [ ] **Step 6: Update `NextContent`**

In `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`, add these imports alongside the existing ones:

```dart
import '../../../../app/routes/app_routes.dart';
import '../../../../core/network/auth_api.dart';
```

Replace the `_loadDocuments` method with:

```dart
  Future<void> _loadDocuments() async {
    final identity = await widget.identityStorage.load();
    if (identity == null) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'No identity found on this device.';
      });
      return;
    }
    _userId = identity.userId;
    try {
      final documents = await widget.documentApi.listDocuments();
      if (!mounted) return;
      setState(() {
        _documents = documents;
        _errorMessage = null;
      });
    } on UnknownIdentityException {
      await _recoverFromStaleIdentity();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load documents.';
      });
    }
  }

  /// The server does not know this device's identity -- most likely the
  /// database was rebuilt. The private key can never be re-associated, so the
  /// only way forward is to discard it and register again.
  Future<void> _recoverFromStaleIdentity() async {
    await widget.identityStorage.clear();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This device\'s identity is no longer recognised. Please register again.')),
    );
    Navigator.pushReplacementNamed(context, AppRoutes.register);
  }
```

Replace the `_upload` method's API call line — change:

```dart
    final result = await widget.documentApi.uploadDocument(file.name, userId, bytes);
```

to:

```dart
    final result = await widget.documentApi.uploadDocument(file.name, bytes);
```

(`_userId` is still assigned in `_loadDocuments` and still guards `_upload`, so it stays.)

- [ ] **Step 7: Update `DocumentDetailsPage`**

In `flutter_digital_sign/lib/features/next/presentation/pages/document_details_page.dart`:

Add these imports alongside the existing ones:

```dart
import '../../../../core/auth/auth_session.dart';
import '../../../../core/network/auth_api.dart';
```

In `initState`, replace the `_documentApi` assignment line:

```dart
    _documentApi = widget.documentApi ?? HttpDocumentApi();
```

with (note `_identityStorage` must be assigned first, so keep that line above this one):

```dart
    _documentApi = widget.documentApi ??
        HttpDocumentApi(
          authSession: AuthSession(
            authApi: HttpAuthApi(),
            identityStorage: _identityStorage,
          ),
        );
```

Replace the entire `_load` method with (it no longer needs the identity, since the token identifies the caller):

```dart
  Future<void> _load() async {
    try {
      final detail = await _documentApi.getDocument(widget.documentId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
      });
    } on UnknownIdentityException {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'This device\'s identity is no longer recognised.';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load document.';
      });
    }
  }
```

Delete the now-unused `String? _userId;` field declaration.

In `_confirmSignature`, replace the opening guard:

```dart
    final detail = _detail;
    final userId = _userId;
    if (detail == null || userId == null || detail.signingPayload == null) return;
```

with:

```dart
    final detail = _detail;
    if (detail == null || detail.signingPayload == null) return;
```

and replace the submit call:

```dart
      final result = await _documentApi.submitSignature(widget.documentId, userId, signatureBytes);
```

with:

```dart
      final result = await _documentApi.submitSignature(widget.documentId, signatureBytes);
```

- [ ] **Step 8: Update the widget tests to the new signatures**

Only the `FakeDocumentApi` callback shapes and two assertions change; every test's intent and structure is unchanged. Both files are given in full to avoid ambiguity.

Note the parenthesisation in the first test below: a cascade section whose value is an arrow function must be wrapped in parentheses when another `..` section follows it, otherwise the arrow body swallows the next section and the file will not compile. The second and third tests need no parentheses because their cascade is the last one.

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
      ..onListDocuments = (() => [
            DocumentSummary(
              id: 'doc-1',
              title: 'Contract_Proposal.pdf',
              uploaderId: 'user-1',
              signedByUser: false,
            ),
          ])
      ..onGetDocument = (documentId) => DocumentDetail(
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
    expect(fakeApi.listCalls, 1);

    await tester.tap(find.text('Contract_Proposal.pdf'));
    await tester.pumpAndSettle();

    expect(find.text('Confirm Signature'), findsOneWidget);
  });

  testWidgets('shows a "Signed" badge for a document the user already signed', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onListDocuments = () => [
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

  testWidgets('Retry button reloads the document list after a failed load', (tester) async {
    await saveIdentity();
    var callCount = 0;
    final fakeApi = FakeDocumentApi()
      ..onListDocuments = () {
        callCount++;
        if (callCount == 1) {
          throw Exception('network blip');
        }
        return [
          DocumentSummary(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-1',
            signedByUser: false,
          ),
        ];
      };

    await tester.pumpWidget(
      MaterialApp(
        home: NextPage(documentApi: fakeApi, identityStorage: IdentityStorage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Failed to load documents.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('Contract_Proposal.pdf'), findsNothing);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load documents.'), findsNothing);
    expect(find.text('Contract_Proposal.pdf'), findsOneWidget);
    expect(callCount, 2);
  });
}
```

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

  // The private key must be a real 32-byte Ed25519 seed: these tests exercise
  // the genuine signing path via Ed25519KeyPair.sign.
  Future<void> saveIdentity() async {
    await IdentityStorage().save('user-1', [1, 2, 3], List.generate(32, (i) => i));
  }

  testWidgets('shows document details and signs successfully', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId) => DocumentDetail(
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
    expect(fakeApi.signCalls.first.signatureBytes, hasLength(64));
    expect(find.text('Signature Confirmed'), findsOneWidget);
  });

  testWidgets('shows a read-only view for a document already signed by this user', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId) => DocumentDetail(
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
      ..onGetDocument = (documentId) => DocumentDetail(
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

  testWidgets('returning via the confirmation page back arrow refreshes the details page', (tester) async {
    await saveIdentity();
    var getCallCount = 0;
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId) {
        getCallCount++;
        final alreadySigned = getCallCount > 1;
        return DocumentDetail(
          id: 'doc-1',
          title: 'Contract_Proposal.pdf',
          uploaderId: 'user-2',
          signatures: alreadySigned
              ? [DocumentSignature(userId: 'user-1', signedAt: DateTime.utc(2026, 8, 20))]
              : [],
          signedByUser: alreadySigned,
          signingPayload: alreadySigned ? null : [1, 2, 3],
        );
      };

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

    expect(find.text('Confirm Signature'), findsOneWidget);

    await tester.tap(find.text('Confirm Signature'));
    await tester.pumpAndSettle();

    expect(find.text('Signature Confirmed'), findsOneWidget);

    // Return to DocumentDetailsPage via the confirmation page's AppBar back
    // arrow instead of "Back to Documents".
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();

    expect(find.text('Signature Confirmed'), findsNothing);
    expect(find.text('Confirm Signature'), findsNothing);
    expect(find.textContaining('already signed'), findsOneWidget);
  });
}
```

Note that these widget tests inject `FakeDocumentApi`, so no real `AuthSession` is ever constructed and no handshake occurs — which is why `document_selection_test.dart` can keep its 3-byte placeholder private key while `signing_flow_test.dart` still needs a real 32-byte seed for the genuine `Ed25519KeyPair.sign` call.

- [ ] **Step 9: Run the full Flutter suite and analysis**

Run: `flutter test`
Expected: PASS — every test file passes, including the updated `document_selection_test.dart` and `signing_flow_test.dart`.

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 10: Manually verify the whole flow against the real backend**

Start the backend from the repo root (`d:\DevProject\DigitalSign`): `npm run dev`.

Confirm the handshake works end to end from the command line before touching the app:

```bash
CH=$(curl -s -X POST http://localhost:3000/auth/challenge -H "Content-Type: application/json" -d '{"userId":"user-alice"}' | sed 's/.*"challenge":"\([^"]*\)".*/\1/')
echo "challenge=$CH"
curl -s -o /dev/null -w "unauthenticated list -> %{http_code}\n" http://localhost:3000/documents
```
Expected: a base64 challenge is printed, and the unauthenticated list request prints `401`.

Then run the app (`flutter run -d windows` if the Visual Studio C++ workload is installed; otherwise `flutter run -d chrome`) and confirm: registering a new user still works, the document list loads without any visible login step, uploading works, and signing works. Nothing in the UI should have changed — the handshake is silent. That invisibility is the success criterion.

- [ ] **Step 11: Commit**

```bash
git add flutter_digital_sign/lib/core/network/document_api.dart flutter_digital_sign/test/core/network/fake_document_api.dart flutter_digital_sign/test/core/network/http_document_api_test.dart flutter_digital_sign/lib/features/next/ flutter_digital_sign/test/document_selection_test.dart flutter_digital_sign/test/signing_flow_test.dart
git commit -m "feat: authenticate document requests with bearer tokens"
```

---

## Post-plan state

Every document endpoint requires a valid JWT, and `userId` is derived from that token rather than accepted from the client — so a caller can no longer name, let alone act as, a different user. The Flutter app authenticates silently on first use and re-authenticates transparently on expiry, with no login screen anywhere. A device holding an identity the server no longer recognises is detected and routed back to registration instead of failing opaquely.

Nothing the user can see has changed. That is the intended outcome: this sub-project buys the enforceable privilege boundary that sub-project 2 (admin role, admin-only upload) and sub-project 3 (admin signature-verification screen) need in order to mean anything.
