# CreateUserUseCase and Registration Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real user registration — `CreateUserUseCase` and `POST /users` — unblocking the Flutter app's future login/identity work, which currently has no way to create a real user (only 3 fixed seed users exist).

**Architecture:** `CreateUserUseCase` follows the exact shape of `UploadDocumentUseCase`/`SignDocumentUseCase`. `UserRepository` (currently read-only) gains `save()` and `findByEmail()`, implemented across all three existing implementations (`Postgres`/`InMemory`/`Fake`). Wired directly into a new `POST /users` route in the same sub-project — small enough not to split use-case-building from HTTP-wiring this time.

**Tech Stack:** No new dependencies — same stack as every prior backend sub-project.

**Spec:** `docs/superpowers/specs/2026-08-20-create-user-use-case-design.md`

## Global Constraints

- Uniqueness enforced on **email only** — matches the existing `users.email` `UNIQUE` DB constraint exactly. No schema migration.
- `CreateUserError = DuplicateEmailError | InvalidValueError | InvalidUserError` — entirely reused/new domain errors, no use-case-specific wrapper.
- `User.create()`'s existing email-format validation is reused as-is (via `InvalidUserError`) — not duplicated in the use case.
- Tests that create real users against the real Postgres database (integration tests, `PostgresUserRepository` tests) must use unique, randomly-generated email addresses per test run (`` `prefix-${randomUUID()}@example.com` ``) — `cleanDatabase()` deliberately never touches `users` (to preserve seed data), so a hardcoded test email would collide with leftover rows from a previous run and either fail a "successful registration" assertion or crash on a real DB unique-constraint violation.
- All new files use explicit `.js` extensions on relative imports, per the established convention.
- Tests colocated with source.

---

### Task 1: DuplicateEmailError

**Files:**
- Create: `src/domain/errors/DuplicateEmailError.ts`
- Modify: `src/domain/errors/DomainError.test.ts`

**Interfaces:**
- Produces: `DuplicateEmailError` (constructor `(email: string)`), extending `DomainError`. Task 3's `CreateUserUseCase` and Task 4's `errorMapping.ts` both depend on this.

- [ ] **Step 1: Create the error**

Create `src/domain/errors/DuplicateEmailError.ts`:

```ts
import { DomainError } from './DomainError.js'

export class DuplicateEmailError extends DomainError {
  constructor(email: string) {
    super(`Email ${email} is already registered`)
  }
}
```

- [ ] **Step 2: Add its test**

In `src/domain/errors/DomainError.test.ts`, add this import alongside the existing ones:

```ts
import { DuplicateEmailError } from './DuplicateEmailError'
```

Add this `it` block inside the existing `describe('DomainError subclasses', ...)` block, after the `SignatureVerificationFailedError` test:

```ts
  it('DuplicateEmailError carries the offending email', () => {
    const error = new DuplicateEmailError('taken@example.com')
    expect(error.name).toBe('DuplicateEmailError')
    expect(error.message).toContain('taken@example.com')
  })
```

- [ ] **Step 3: Run tests**

Run: `npm test -- DomainError.test.ts`
Expected: PASS — 7 tests passed (was 6).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/errors/DuplicateEmailError.ts src/domain/errors/DomainError.test.ts
git commit -m "feat: add DuplicateEmailError"
```

---

### Task 2: UserRepository save() and findByEmail()

**Files:**
- Modify: `src/use-cases/ports/UserRepository.ts`
- Modify: `src/infrastructure/InMemoryUserRepository.ts`
- Modify: `src/infrastructure/InMemoryUserRepository.test.ts`
- Modify: `src/use-cases/testing/FakeUserRepository.ts`
- Modify: `src/infrastructure/db/PostgresUserRepository.ts`
- Modify: `src/infrastructure/db/PostgresUserRepository.test.ts`

**Interfaces:**
- Produces: `UserRepository` gains `save(user: User): Promise<void>` and `findByEmail(email: string): Promise<User | null>`, implemented identically in all three classes. Task 3's `CreateUserUseCase` depends on this (via `FakeUserRepository` in its own tests, and via the real implementations at runtime).

This task modifies an existing port and all three of its implementers together, so `npm run typecheck` never sits in a broken intermediate state (same reasoning as the `DocumentRepository.findById()` extension in the Upload/Sign sub-project).

- [ ] **Step 1: Extend the port**

In `src/use-cases/ports/UserRepository.ts`, replace the contents with:

```ts
import { User } from '../../domain/entities/User.js'

export interface UserRepository {
  findById(id: string): Promise<User | null>
  save(user: User): Promise<void>
  findByEmail(email: string): Promise<User | null>
}
```

- [ ] **Step 2: Implement on InMemoryUserRepository**

Replace the contents of `src/infrastructure/InMemoryUserRepository.ts` with:

```ts
import { User } from '../domain/entities/User.js'
import { UserRepository } from '../use-cases/ports/UserRepository.js'

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly users: User[]) {}

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null
  }

  async save(user: User): Promise<void> {
    this.users.push(user)
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((u) => u.email === email) ?? null
  }
}
```

(`private readonly users: User[]` still allows `.push()` — `readonly` only prevents reassigning the property itself, not mutating the array it points to.)

- [ ] **Step 3: Add tests for InMemoryUserRepository**

In `src/infrastructure/InMemoryUserRepository.test.ts`, add these two `it` blocks inside the existing `describe('InMemoryUserRepository', ...)` block, after the existing tests:

```ts
  it('finds a saved user by email', async () => {
    const repository = new InMemoryUserRepository([])
    const user = aUser('user-2')

    await repository.save(user)
    const found = await repository.findByEmail('user-2@example.com')

    expect(found).toBe(user)
  })

  it('returns null when finding by an unknown email', async () => {
    const repository = new InMemoryUserRepository([])

    const found = await repository.findByEmail('missing@example.com')

    expect(found).toBeNull()
  })
```

(Reuses the existing `aUser()` helper already defined at the top of this file, which builds an email as `` `${id}@example.com` `` — so `aUser('user-2')` has email `user-2@example.com`.)

- [ ] **Step 4: Implement on FakeUserRepository**

Replace the contents of `src/use-cases/testing/FakeUserRepository.ts` with:

```ts
import { User } from '../../domain/entities/User.js'
import { UserRepository } from '../ports/UserRepository.js'

export class FakeUserRepository implements UserRepository {
  readonly users: User[] = []

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null
  }

  async save(user: User): Promise<void> {
    this.users.push(user)
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((u) => u.email === email) ?? null
  }
}
```

- [ ] **Step 5: Implement on PostgresUserRepository**

Replace the contents of `src/infrastructure/db/PostgresUserRepository.ts` with:

```ts
import { eq } from 'drizzle-orm'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { UserRepository } from '../../use-cases/ports/UserRepository.js'
import { db } from './connection.js'
import { users } from './schema.js'

export class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return User.create({
      id: row.id,
      username: row.username,
      email: row.email,
      publicKey: PublicKey.create(row.publicKey).value
    }).value
  }

  async save(user: User): Promise<void> {
    await db.insert(users).values({
      id: user.id,
      username: user.username,
      email: user.email,
      publicKey: user.publicKey.toBytes()
    })
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return User.create({
      id: row.id,
      username: row.username,
      email: row.email,
      publicKey: PublicKey.create(row.publicKey).value
    }).value
  }
}
```

- [ ] **Step 6: Add tests for PostgresUserRepository**

In `src/infrastructure/db/PostgresUserRepository.test.ts`, add this import alongside the existing ones:

```ts
import { randomUUID } from 'node:crypto'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
```

Add these two `it` blocks inside the existing `describe('PostgresUserRepository', ...)` block, after the existing tests:

```ts
  it('finds a saved user by email', async () => {
    const repository = new PostgresUserRepository()
    const email = `dave-${randomUUID()}@example.com`
    const user = User.create({
      id: randomUUID(),
      username: 'dave',
      email,
      publicKey: PublicKey.create(new Uint8Array(32).fill(7)).value
    }).value

    await repository.save(user)
    const found = await repository.findByEmail(email)

    expect(found).not.toBeNull()
    expect(found!.email).toBe(email)
    expect(found!.username).toBe('dave')
  })

  it('returns null when finding by an unknown email', async () => {
    const repository = new PostgresUserRepository()

    const found = await repository.findByEmail('missing@example.com')

    expect(found).toBeNull()
  })
```

(Uses a randomly-generated email per test run — see Global Constraints for why a hardcoded one would eventually collide with leftover data from a previous run, since `cleanDatabase()` never clears `users`.)

- [ ] **Step 7: Run tests**

Run: `npm test -- InMemoryUserRepository.test.ts PostgresUserRepository.test.ts`
Expected: PASS — 4 tests in the first file (was 2), 4 in the second (was 2).

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/use-cases/ports/UserRepository.ts src/infrastructure/InMemoryUserRepository.ts src/infrastructure/InMemoryUserRepository.test.ts src/use-cases/testing/FakeUserRepository.ts src/infrastructure/db/PostgresUserRepository.ts src/infrastructure/db/PostgresUserRepository.test.ts
git commit -m "feat: add save() and findByEmail() to UserRepository"
```

---

### Task 3: CreateUserUseCase

**Files:**
- Create: `src/use-cases/create-user/CreateUserUseCase.ts`
- Test: `src/use-cases/create-user/CreateUserUseCase.test.ts`

**Interfaces:**
- Consumes: `IdGenerator` (existing), `UserRepository`/`FakeUserRepository`/`FakeIdGenerator` (Task 2 and existing), `User`, `PublicKey`, `InvalidValueError`, `InvalidUserError` (existing), `DuplicateEmailError` (Task 1).
- Produces: `CreateUserInput` (`{ username: string; email: string; publicKeyBytes: Uint8Array }`), `CreateUserError` (union type), `CreateUserUseCase` — constructor `(idGenerator: IdGenerator, userRepository: UserRepository)`, method `execute(input: CreateUserInput): Promise<Result<User, CreateUserError>>`. Task 4/5's HTTP route and `composition.ts` depend on this.

- [ ] **Step 1: Write the failing tests**

Create `src/use-cases/create-user/CreateUserUseCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CreateUserUseCase } from './CreateUserUseCase.js'
import { FakeIdGenerator } from '../testing/FakeIdGenerator.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'

function setup() {
  const idGenerator = new FakeIdGenerator()
  const userRepository = new FakeUserRepository()
  const useCase = new CreateUserUseCase(idGenerator, userRepository)
  return { idGenerator, userRepository, useCase }
}

describe('CreateUserUseCase', () => {
  it('registers a new user successfully', async () => {
    const { userRepository, useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isOk()).toBe(true)
    const user = result.value
    expect(user.username).toBe('dave')
    expect(user.email).toBe('dave@example.com')
    expect(user.id).toBe('fake-id-1')
    expect(userRepository.users).toEqual([user])
  })

  it('rejects a duplicate email', async () => {
    const { userRepository, useCase } = setup()
    const existing = User.create({
      id: 'user-existing',
      username: 'existing',
      email: 'dave@example.com',
      publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value
    }).value
    userRepository.users.push(existing)

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DuplicateEmailError)
  })

  it('rejects a malformed public key', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(10)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidValueError)
  })

  it('rejects an invalid email format', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'not-an-email',
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidUserError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- CreateUserUseCase.test.ts`
Expected: FAIL — `Cannot find module './CreateUserUseCase.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/use-cases/create-user/CreateUserUseCase.ts`:

```ts
import { Result } from '../../domain/result/Result.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
import { IdGenerator } from '../ports/IdGenerator.js'
import { UserRepository } from '../ports/UserRepository.js'

export interface CreateUserInput {
  username: string
  email: string
  publicKeyBytes: Uint8Array
}

export type CreateUserError = DuplicateEmailError | InvalidValueError | InvalidUserError

export class CreateUserUseCase {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly userRepository: UserRepository
  ) {}

  async execute(input: CreateUserInput): Promise<Result<User, CreateUserError>> {
    const existing = await this.userRepository.findByEmail(input.email)
    if (existing !== null) {
      return Result.fail(new DuplicateEmailError(input.email))
    }

    const publicKeyResult = PublicKey.create(input.publicKeyBytes)
    if (publicKeyResult.isFail()) {
      return Result.fail(publicKeyResult.error)
    }

    const userResult = User.create({
      id: this.idGenerator.generate(),
      username: input.username,
      email: input.email,
      publicKey: publicKeyResult.value
    })
    if (userResult.isFail()) {
      return Result.fail(userResult.error)
    }

    await this.userRepository.save(userResult.value)

    return Result.ok(userResult.value)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- CreateUserUseCase.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test`
Expected: all previously-passing tests still pass, plus this task's 4 new tests.

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/use-cases/create-user/CreateUserUseCase.ts src/use-cases/create-user/CreateUserUseCase.test.ts
git commit -m "feat: add CreateUserUseCase"
```

---

### Task 4: Error mapping and serialization

**Files:**
- Modify: `src/interface-adapters/http/errorMapping.ts`
- Modify: `src/interface-adapters/http/errorMapping.test.ts`
- Modify: `src/interface-adapters/http/serialization.ts`
- Modify: `src/interface-adapters/http/serialization.test.ts`

**Interfaces:**
- Produces: `mapDomainErrorToResponse()` now maps `DuplicateEmailError` → `409` and `InvalidUserError` → `400` (the latter was a pre-existing gap — `InvalidUserError` was never in the mapping table before, since no use case surfaced it to HTTP until now; without this fix it would incorrectly fall through to the `500` default). `toUserJson(user: User): UserJson` is new, alongside `UserJson`. Task 5's route depends on both.

- [ ] **Step 1: Add InvalidUserError and DuplicateEmailError to error mapping**

Replace the contents of `src/interface-adapters/http/errorMapping.ts` with:

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DomainError } from '../../domain/errors/DomainError.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
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
  if (error instanceof InvalidUserError) return 400
  if (error instanceof DocumentNotFoundError) return 404
  if (error instanceof UserNotFoundError) return 404
  if (error instanceof DuplicateSignatureError) return 409
  if (error instanceof DuplicateEmailError) return 409
  if (error instanceof SignatureVerificationFailedError) return 422
  return 500
}
```

- [ ] **Step 2: Add tests**

In `src/interface-adapters/http/errorMapping.test.ts`, add these imports alongside the existing ones:

```ts
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
```

Add these two `it` blocks inside the existing `describe('mapDomainErrorToResponse', ...)` block, after the `InvalidSignatureError` test:

```ts
  it('maps InvalidUserError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidUserError('username must not be empty'))
    expect(result.status).toBe(400)
  })
```

And after the `DuplicateSignatureError` test:

```ts
  it('maps DuplicateEmailError to 409', () => {
    const result = mapDomainErrorToResponse(new DuplicateEmailError('taken@example.com'))
    expect(result.status).toBe(409)
  })
```

- [ ] **Step 3: Run tests**

Run: `npm test -- errorMapping.test.ts`
Expected: PASS — 10 tests passed (was 8).

- [ ] **Step 4: Add toUserJson to serialization.ts**

In `src/interface-adapters/http/serialization.ts`, add this import alongside the existing ones:

```ts
import { User } from '../../domain/entities/User.js'
```

Add this interface and function anywhere after the existing `DocumentJson`/`SignatureJson` interfaces and their functions:

```ts
export interface UserJson {
  id: string
  username: string
  email: string
  publicKey: string
}

export function toUserJson(user: User): UserJson {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    publicKey: Buffer.from(user.publicKey.toBytes()).toString('base64')
  }
}
```

- [ ] **Step 5: Add its test**

In `src/interface-adapters/http/serialization.test.ts`, add this import alongside the existing ones:

```ts
import { toUserJson } from './serialization.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
```

(Note: `toUserJson` should be added to the existing `import { toDocumentJson, toSignatureJson, decodeBase64 } from './serialization.js'` line rather than a separate import statement — combine them into one import.)

Add this new `describe` block after the existing `describe('toSignatureJson', ...)` block:

```ts
describe('toUserJson', () => {
  it('serializes a User with base64-encoded publicKey', () => {
    const user = User.create({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: PublicKey.create(new Uint8Array(32).fill(7)).value
    }).value

    const json = toUserJson(user)

    expect(json).toEqual({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
    })
  })
})
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- errorMapping.test.ts serialization.test.ts`
Expected: PASS — 10 tests in the first file, 4 in the second (was 3).

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/interface-adapters/http/errorMapping.ts src/interface-adapters/http/errorMapping.test.ts src/interface-adapters/http/serialization.ts src/interface-adapters/http/serialization.test.ts
git commit -m "feat: map DuplicateEmailError/InvalidUserError to HTTP status, add toUserJson"
```

---

### Task 5: Registration route and wiring

**Files:**
- Create: `src/interface-adapters/http/routes/users.ts`
- Modify: `src/infrastructure/composition.ts`
- Modify: `src/infrastructure/composition.test.ts`
- Modify: `src/interface-adapters/http/app.ts`
- Create: `src/interface-adapters/http/users.integration.test.ts`

**Interfaces:**
- Consumes: `CreateUserUseCase` (Task 3), `mapDomainErrorToResponse`/`toUserJson`/`decodeBase64` (Task 4 and existing), `Dependencies` from `composition.ts`.
- Produces: `createUsersRoutes(dependencies: Dependencies): Hono`, mounted onto `app.ts`. `Dependencies` gains `createUserUseCase: CreateUserUseCase`. Final task of this plan.

- [ ] **Step 1: Update composition.ts**

Replace the contents of `src/infrastructure/composition.ts` with:

```ts
import { DiskFileStorage } from './DiskFileStorage.js'
import { RandomIdGenerator } from './RandomIdGenerator.js'
import { SystemClock } from './SystemClock.js'
import { Ed25519CryptoProvider } from './Ed25519CryptoProvider.js'
import { PostgresDocumentRepository } from './db/PostgresDocumentRepository.js'
import { PostgresUserRepository } from './db/PostgresUserRepository.js'
import { PostgresSignatureRepository } from './db/PostgresSignatureRepository.js'
import { SignatureChainService } from '../domain/services/SignatureChainService.js'
import { CreateUserUseCase } from '../use-cases/create-user/CreateUserUseCase.js'
import { UploadDocumentUseCase } from '../use-cases/upload-document/UploadDocumentUseCase.js'
import { SignDocumentUseCase } from '../use-cases/sign-document/SignDocumentUseCase.js'
import { VerifyDocumentUseCase } from '../use-cases/verify-document/VerifyDocumentUseCase.js'

export interface Dependencies {
  createUserUseCase: CreateUserUseCase
  uploadDocumentUseCase: UploadDocumentUseCase
  signDocumentUseCase: SignDocumentUseCase
  verifyDocumentUseCase: VerifyDocumentUseCase
}

export function createDependencies(): Dependencies {
  const documentRepository = new PostgresDocumentRepository()
  const userRepository = new PostgresUserRepository()
  const signatureRepository = new PostgresSignatureRepository()
  const fileStorage = new DiskFileStorage()
  const idGenerator = new RandomIdGenerator()
  const clock = new SystemClock()
  const crypto = new Ed25519CryptoProvider()
  const signatureChainService = new SignatureChainService(crypto)

  const createUserUseCase = new CreateUserUseCase(idGenerator, userRepository)
  const uploadDocumentUseCase = new UploadDocumentUseCase(crypto, fileStorage, idGenerator, documentRepository)
  const signDocumentUseCase = new SignDocumentUseCase(
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  const verifyDocumentUseCase = new VerifyDocumentUseCase(
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )

  return { createUserUseCase, uploadDocumentUseCase, signDocumentUseCase, verifyDocumentUseCase }
}
```

- [ ] **Step 2: Add a composition test for CreateUserUseCase**

In `src/infrastructure/composition.test.ts`, add this `it` block inside the existing `describe('createDependencies', ...)` block, after the `'wires a working UploadDocumentUseCase'` test:

```ts
  it('wires a working CreateUserUseCase', async () => {
    const { createUserUseCase } = createDependencies()

    const result = await createUserUseCase.execute({
      username: 'dave',
      email: `dave-${randomUUID()}@example.com`,
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.username).toBe('dave')
  })
```

Add this import at the top of the file, alongside the existing ones:

```ts
import { randomUUID } from 'node:crypto'
```

- [ ] **Step 3: Write the route**

Create `src/interface-adapters/http/routes/users.ts`:

```ts
import { Hono } from 'hono'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { toUserJson, decodeBase64 } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'

export function createUsersRoutes(dependencies: Dependencies): Hono {
  const users = new Hono()

  users.post('/users', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      body === null ||
      typeof body.username !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.publicKeyBytes !== 'string'
    ) {
      return c.json(
        { error: { type: 'ValidationError', message: 'username, email, and publicKeyBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.createUserUseCase.execute({
      username: body.username,
      email: body.email,
      publicKeyBytes: decodeBase64(body.publicKeyBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toUserJson(result.value), 201)
  })

  return users
}
```

- [ ] **Step 4: Mount the route in app.ts**

Replace the contents of `src/interface-adapters/http/app.ts` with:

```ts
import { Hono } from 'hono'
import { health } from './routes/health.js'
import { createDocumentsRoutes } from './routes/documents.js'
import { createUsersRoutes } from './routes/users.js'
import { createDependencies } from '../../infrastructure/composition.js'

export const app = new Hono()

const dependencies = createDependencies()

app.route('/', health)
app.route('/', createDocumentsRoutes(dependencies))
app.route('/', createUsersRoutes(dependencies))
```

- [ ] **Step 5: Write the integration test**

Create `src/interface-adapters/http/users.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { app } from './app.js'

describe('POST /users', () => {
  it('registers a new user and returns 201 with the serialized user', async () => {
    const email = `dave-${randomUUID()}@example.com`
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'dave',
        email,
        publicKeyBytes: Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.username).toBe('dave')
    expect(body.email).toBe(email)
    expect(typeof body.id).toBe('string')
    expect(typeof body.publicKey).toBe('string')
  })

  it('returns 409 when the email is already registered', async () => {
    const email = `duplicate-${randomUUID()}@example.com`
    const payload = {
      username: 'first',
      email,
      publicKeyBytes: Buffer.from(new Uint8Array(32).fill(1)).toString('base64')
    }
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, username: 'second' })
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.type).toBe('DuplicateEmailError')
  })

  it('returns 400 for a malformed public key', async () => {
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'dave',
        email: `dave-malformed-${randomUUID()}@example.com`,
        publicKeyBytes: Buffer.from(new Uint8Array(10)).toString('base64')
      })
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.type).toBe('InvalidValueError')
  })
})
```

(Uses randomly-generated emails per test run, same reasoning as Task 2's `PostgresUserRepository` tests. This test file — like `documents.integration.test.ts` — leaves the users it creates behind in the real database; that's an accepted, non-blocking gap, same as the already-known one where `composition.test.ts`/`documents.integration.test.ts` leave real files behind in `uploads/`.)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests pass. Total count is 143: 127 from the end of the DiskFileStorage sub-project, +1 from Task 1 (`DomainError.test.ts`), +4 from Task 2 (`InMemoryUserRepository.test.ts` and `PostgresUserRepository.test.ts`, 2 new tests each), +4 from Task 3 (`CreateUserUseCase.test.ts`), +3 from Task 4 (2 in `errorMapping.test.ts`, 1 in `serialization.test.ts`), +1 from Task 5's `composition.test.ts` addition, +3 from Task 5's new `users.integration.test.ts`.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 8: Manually verify with the running dev server**

Run: `npm run dev`

In a separate terminal, register a new user:
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"username":"dave","email":"dave-manual-test@example.com","publicKeyBytes":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="}'
```
Expected: `201` with a serialized user (that base64 string decodes to 32 bytes of `7`).

Try registering the same email again:
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"username":"dave2","email":"dave-manual-test@example.com","publicKeyBytes":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="}'
```
Expected: `409` with `{"error":{"type":"DuplicateEmailError",...}}`.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 9: Commit**

```bash
git add src/interface-adapters/http/routes/users.ts src/infrastructure/composition.ts src/infrastructure/composition.test.ts src/interface-adapters/http/app.ts src/interface-adapters/http/users.integration.test.ts
git commit -m "feat: add user registration endpoint (POST /users)"
```

---

## Post-plan state

After Task 5, the backend supports real user registration: `POST /users` creates a real user with a real (client-supplied) Ed25519 public key, enforcing email uniqueness. Combined with the existing `Sign`/`Verify` flows (which already work against any user found via `UserRepository.findById()`, unaffected by this change), the Flutter mobile app can now register real users instead of being limited to the 3 fixed seed accounts — unblocking real login/identity work in the app. `Sign`/`Verify` themselves are unchanged.
