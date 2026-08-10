# Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-free Domain Core layer of SecureDoc Chain's backend — entities, value objects, and chained-signature business rules — as pure, independently-tested TypeScript.

**Architecture:** Clean Architecture domain layer. Entities and value objects are immutable, constructed only via static `create()` factories returning `Result<T, DomainError>`. A `CryptoProvider` port abstracts hashing/verification so the domain never touches a concrete crypto library. A `SignatureChainService` holds the chaining rules (no enforced signer order, one signature per user per document, chained signing payloads, full-chain verification).

**Tech Stack:** TypeScript (strict mode), Vitest for unit tests, Node.js. No framework, no database, no HTTP dependency in this layer.

## Global Constraints

- No exceptions thrown across the domain boundary — every fallible operation returns `Result<T, DomainError>`.
- All entities/value objects are immutable with private constructors; only `create()` factories construct instances.
- `domain/` has zero imports from any framework, ORM, or concrete crypto library — only the `CryptoProvider` interface (a port) may be referenced.
- `CryptoProvider` has no `sign()` method — signing happens on the mobile device; the backend only verifies.
- Signing payload rule: first signer's message is `hash(document.originalHash)`; every subsequent signer's message is `hash(document.originalHash + previousSignature.signatureData)`.
- One signature per user per document (enforced by `SignatureChainService.assertCanSign`).
- No enforced signer order — any user may sign at any time, chaining onto the current tip.
- Unit tests colocated with source as `*.test.ts`, no I/O, `CryptoProvider` faked in tests.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
src/
  domain/
    result/
      Result.ts
      Result.test.ts
    errors/
      DomainError.ts
      InvalidValueError.ts
      InvalidUserError.ts
      InvalidDocumentError.ts
      InvalidSignatureError.ts
      DuplicateSignatureError.ts
      BrokenChainError.ts
    value-objects/
      Hash.ts
      Hash.test.ts
      PublicKey.ts
      PublicKey.test.ts
      SignatureBytes.ts
      SignatureBytes.test.ts
    entities/
      User.ts
      User.test.ts
      Document.ts
      Document.test.ts
      Signature.ts
      Signature.test.ts
    ports/
      CryptoProvider.ts
    testing/
      FakeCryptoProvider.ts
    services/
      SignatureChainService.ts
      SignatureChainService.test.ts
```

---

### Task 1: Project setup & tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` (runs Vitest), `npm run typecheck` (runs `tsc --noEmit`) — every later task relies on these two commands existing.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "securedoc-chain-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 5: Verify tooling works**

Run: `npm test`
Expected: Vitest runs and reports "No test files found" (or passes with 0 tests) — not an error, just confirms the runner works before any source exists.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "chore: set up TypeScript + Vitest tooling"
```

---

### Task 2: Result type

**Files:**
- Create: `src/domain/result/Result.ts`
- Test: `src/domain/result/Result.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Result.ok<T, E>(value: T): Result<T, E>`, `Result.fail<T, E>(error: E): Result<T, E>`, instance methods `isOk(): boolean`, `isFail(): boolean`, getters `value: T` (throws if fail) and `error: E` (throws if ok). Every later task's `create()` factories and service methods return `Result<T, E>` built with these.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/result/Result.test.ts
import { describe, it, expect } from 'vitest'
import { Result } from './Result'

describe('Result', () => {
  it('ok() produces a successful result carrying the value', () => {
    const result = Result.ok<number, Error>(42)
    expect(result.isOk()).toBe(true)
    expect(result.isFail()).toBe(false)
    expect(result.value).toBe(42)
  })

  it('fail() produces a failed result carrying the error', () => {
    const error = new Error('boom')
    const result = Result.fail<number, Error>(error)
    expect(result.isOk()).toBe(false)
    expect(result.isFail()).toBe(true)
    expect(result.error).toBe(error)
  })

  it('accessing value on a failed result throws', () => {
    const result = Result.fail<number, Error>(new Error('boom'))
    expect(() => result.value).toThrow()
  })

  it('accessing error on a successful result throws', () => {
    const result = Result.ok<number, Error>(1)
    expect(() => result.error).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Result.test.ts`
Expected: FAIL — `./Result` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/result/Result.ts
export class Result<T, E> {
  private constructor(
    private readonly _isOk: boolean,
    private readonly _value: T | undefined,
    private readonly _error: E | undefined
  ) {}

  static ok<T, E>(value: T): Result<T, E> {
    return new Result<T, E>(true, value, undefined)
  }

  static fail<T, E>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error)
  }

  isOk(): boolean {
    return this._isOk
  }

  isFail(): boolean {
    return !this._isOk
  }

  get value(): T {
    if (!this._isOk) {
      throw new Error('Cannot access value of a failed Result')
    }
    return this._value as T
  }

  get error(): E {
    if (this._isOk) {
      throw new Error('Cannot access error of a successful Result')
    }
    return this._error as E
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Result.test.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/result/Result.ts src/domain/result/Result.test.ts
git commit -m "feat: add Result type for domain error handling"
```

---

### Task 3: Domain error hierarchy

**Files:**
- Create: `src/domain/errors/DomainError.ts`
- Create: `src/domain/errors/InvalidValueError.ts`
- Create: `src/domain/errors/InvalidUserError.ts`
- Create: `src/domain/errors/InvalidDocumentError.ts`
- Create: `src/domain/errors/InvalidSignatureError.ts`
- Create: `src/domain/errors/DuplicateSignatureError.ts`
- Create: `src/domain/errors/BrokenChainError.ts`
- Test: `src/domain/errors/DomainError.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `abstract class DomainError extends Error` with `name` set to the concrete subclass name; `InvalidValueError(field: string, reason: string)`; `InvalidUserError(reason: string)`; `InvalidDocumentError(reason: string)`; `InvalidSignatureError(reason: string)`; `DuplicateSignatureError(userId: string)`; `BrokenChainError(signatureId: string, reason: string)`. Later value-object and entity `create()` factories fail with these.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/errors/DomainError.test.ts
import { describe, it, expect } from 'vitest'
import { InvalidValueError } from './InvalidValueError'
import { DuplicateSignatureError } from './DuplicateSignatureError'
import { BrokenChainError } from './BrokenChainError'

describe('DomainError subclasses', () => {
  it('InvalidValueError carries field and reason in its message and name', () => {
    const error = new InvalidValueError('Hash', 'must be 32 bytes')
    expect(error.name).toBe('InvalidValueError')
    expect(error.message).toContain('Hash')
    expect(error.message).toContain('must be 32 bytes')
    expect(error).toBeInstanceOf(Error)
  })

  it('DuplicateSignatureError carries the offending userId', () => {
    const error = new DuplicateSignatureError('user-123')
    expect(error.name).toBe('DuplicateSignatureError')
    expect(error.message).toContain('user-123')
  })

  it('BrokenChainError carries the offending signatureId and reason', () => {
    const error = new BrokenChainError('sig-456', 'cryptographic verification failed')
    expect(error.name).toBe('BrokenChainError')
    expect(error.message).toContain('sig-456')
    expect(error.message).toContain('cryptographic verification failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DomainError.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/errors/DomainError.ts
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}
```

```ts
// src/domain/errors/InvalidValueError.ts
import { DomainError } from './DomainError'

export class InvalidValueError extends DomainError {
  constructor(field: string, reason: string) {
    super(`Invalid ${field}: ${reason}`)
  }
}
```

```ts
// src/domain/errors/InvalidUserError.ts
import { DomainError } from './DomainError'

export class InvalidUserError extends DomainError {
  constructor(reason: string) {
    super(`Invalid User: ${reason}`)
  }
}
```

```ts
// src/domain/errors/InvalidDocumentError.ts
import { DomainError } from './DomainError'

export class InvalidDocumentError extends DomainError {
  constructor(reason: string) {
    super(`Invalid Document: ${reason}`)
  }
}
```

```ts
// src/domain/errors/InvalidSignatureError.ts
import { DomainError } from './DomainError'

export class InvalidSignatureError extends DomainError {
  constructor(reason: string) {
    super(`Invalid Signature: ${reason}`)
  }
}
```

```ts
// src/domain/errors/DuplicateSignatureError.ts
import { DomainError } from './DomainError'

export class DuplicateSignatureError extends DomainError {
  constructor(userId: string) {
    super(`User ${userId} has already signed this document`)
  }
}
```

```ts
// src/domain/errors/BrokenChainError.ts
import { DomainError } from './DomainError'

export class BrokenChainError extends DomainError {
  constructor(signatureId: string, reason: string) {
    super(`Signature chain broken at signature ${signatureId}: ${reason}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DomainError.test.ts`
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/errors
git commit -m "feat: add domain error hierarchy"
```

---

### Task 4: Hash value object

**Files:**
- Create: `src/domain/value-objects/Hash.ts`
- Test: `src/domain/value-objects/Hash.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `InvalidValueError` (Task 3)
- Produces: `Hash.create(bytes: Uint8Array): Result<Hash, InvalidValueError>`; instance methods `toBytes(): Uint8Array`, `toHex(): string`, `equals(other: Hash): boolean`. Used by `Document`, `CryptoProvider`, and `SignatureChainService` in later tasks.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/value-objects/Hash.test.ts
import { describe, it, expect } from 'vitest'
import { Hash } from './Hash'

describe('Hash', () => {
  it('creates a valid 32-byte hash', () => {
    const bytes = new Uint8Array(32).fill(1)
    const result = Hash.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects a hash that is not 32 bytes', () => {
    const result = Hash.create(new Uint8Array(10))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('32 bytes')
  })

  it('toHex renders lowercase hex', () => {
    const bytes = new Uint8Array([0, 255, 16])
    const result = Hash.create(new Uint8Array(32).fill(0).map((_, i) => (i < 3 ? bytes[i] : 0)))
    expect(result.value.toHex().startsWith('00ff10')).toBe(true)
  })

  it('equals compares by byte value', () => {
    const a = Hash.create(new Uint8Array(32).fill(7)).value
    const b = Hash.create(new Uint8Array(32).fill(7)).value
    const c = Hash.create(new Uint8Array(32).fill(8)).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Hash.test.ts`
Expected: FAIL — `./Hash` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/value-objects/Hash.ts
import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

const SHA256_BYTE_LENGTH = 32

export class Hash {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<Hash, InvalidValueError> {
    if (bytes.length !== SHA256_BYTE_LENGTH) {
      return Result.fail(
        new InvalidValueError('Hash', `must be exactly ${SHA256_BYTE_LENGTH} bytes (SHA-256 output), got ${bytes.length}`)
      )
    }
    return Result.ok(new Hash(bytes))
  }

  toBytes(): Uint8Array {
    return this.bytes
  }

  toHex(): string {
    return Array.from(this.bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  equals(other: Hash): boolean {
    return this.toHex() === other.toHex()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Hash.test.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/value-objects/Hash.ts src/domain/value-objects/Hash.test.ts
git commit -m "feat: add Hash value object"
```

---

### Task 5: PublicKey value object

**Files:**
- Create: `src/domain/value-objects/PublicKey.ts`
- Test: `src/domain/value-objects/PublicKey.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `InvalidValueError` (Task 3)
- Produces: `PublicKey.create(bytes: Uint8Array): Result<PublicKey, InvalidValueError>`; instance method `toBytes(): Uint8Array`. Used by `User` and `CryptoProvider.verify()` in later tasks.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/value-objects/PublicKey.test.ts
import { describe, it, expect } from 'vitest'
import { PublicKey } from './PublicKey'

describe('PublicKey', () => {
  it('creates a valid public key from non-empty bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const result = PublicKey.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = PublicKey.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('PublicKey')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PublicKey.test.ts`
Expected: FAIL — `./PublicKey` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/value-objects/PublicKey.ts
import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

export class PublicKey {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<PublicKey, InvalidValueError> {
    if (bytes.length === 0) {
      return Result.fail(new InvalidValueError('PublicKey', 'must not be empty'))
    }
    return Result.ok(new PublicKey(bytes))
  }

  toBytes(): Uint8Array {
    return this.bytes
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PublicKey.test.ts`
Expected: PASS, 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/value-objects/PublicKey.ts src/domain/value-objects/PublicKey.test.ts
git commit -m "feat: add PublicKey value object"
```

---

### Task 6: SignatureBytes value object

**Files:**
- Create: `src/domain/value-objects/SignatureBytes.ts`
- Test: `src/domain/value-objects/SignatureBytes.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `InvalidValueError` (Task 3)
- Produces: `SignatureBytes.create(bytes: Uint8Array): Result<SignatureBytes, InvalidValueError>`; instance method `toBytes(): Uint8Array`. Used by `Signature` entity, `CryptoProvider.verify()`, and `SignatureChainService`.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/value-objects/SignatureBytes.test.ts
import { describe, it, expect } from 'vitest'
import { SignatureBytes } from './SignatureBytes'

describe('SignatureBytes', () => {
  it('creates valid signature bytes from a non-empty array', () => {
    const bytes = new Uint8Array([9, 8, 7])
    const result = SignatureBytes.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = SignatureBytes.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('SignatureBytes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SignatureBytes.test.ts`
Expected: FAIL — `./SignatureBytes` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/value-objects/SignatureBytes.ts
import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

export class SignatureBytes {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<SignatureBytes, InvalidValueError> {
    if (bytes.length === 0) {
      return Result.fail(new InvalidValueError('SignatureBytes', 'must not be empty'))
    }
    return Result.ok(new SignatureBytes(bytes))
  }

  toBytes(): Uint8Array {
    return this.bytes
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- SignatureBytes.test.ts`
Expected: PASS, 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/value-objects/SignatureBytes.ts src/domain/value-objects/SignatureBytes.test.ts
git commit -m "feat: add SignatureBytes value object"
```

---

### Task 7: User entity

**Files:**
- Create: `src/domain/entities/User.ts`
- Test: `src/domain/entities/User.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `InvalidUserError` (Task 3), `PublicKey` (Task 5)
- Produces: `User.create(props: { id: string; username: string; email: string; publicKey: PublicKey }): Result<User, InvalidUserError>`; getters `id`, `username`, `email`, `publicKey`.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/entities/User.test.ts
import { describe, it, expect } from 'vitest'
import { User } from './User'
import { PublicKey } from '../value-objects/PublicKey'

function aPublicKey(): PublicKey {
  return PublicKey.create(new Uint8Array([1, 2, 3])).value
}

describe('User', () => {
  it('creates a valid user', () => {
    const result = User.create({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: aPublicKey()
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.username).toBe('alice')
    expect(result.value.email).toBe('alice@example.com')
  })

  it('rejects an empty id', () => {
    const result = User.create({ id: '', username: 'alice', email: 'alice@example.com', publicKey: aPublicKey() })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty username', () => {
    const result = User.create({ id: 'user-1', username: '  ', email: 'alice@example.com', publicKey: aPublicKey() })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = User.create({ id: 'user-1', username: 'alice', email: 'not-an-email', publicKey: aPublicKey() })
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('email')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- User.test.ts`
Expected: FAIL — `./User` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/entities/User.ts
import { Result } from '../result/Result'
import { InvalidUserError } from '../errors/InvalidUserError'
import { PublicKey } from '../value-objects/PublicKey'

export interface UserProps {
  id: string
  username: string
  email: string
  publicKey: PublicKey
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(props: UserProps): Result<User, InvalidUserError> {
    if (!props.id) {
      return Result.fail(new InvalidUserError('id must not be empty'))
    }
    if (!props.username || props.username.trim().length === 0) {
      return Result.fail(new InvalidUserError('username must not be empty'))
    }
    if (!EMAIL_PATTERN.test(props.email)) {
      return Result.fail(new InvalidUserError(`invalid email: ${props.email}`))
    }
    return Result.ok(new User(props))
  }

  get id(): string {
    return this.props.id
  }

  get username(): string {
    return this.props.username
  }

  get email(): string {
    return this.props.email
  }

  get publicKey(): PublicKey {
    return this.props.publicKey
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- User.test.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/User.ts src/domain/entities/User.test.ts
git commit -m "feat: add User entity"
```

---

### Task 8: Document entity

**Files:**
- Create: `src/domain/entities/Document.ts`
- Test: `src/domain/entities/Document.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `InvalidDocumentError` (Task 3), `Hash` (Task 4)
- Produces: `Document.create(props: { id: string; title: string; filePath: string; originalHash: Hash; uploaderId: string }): Result<Document, InvalidDocumentError>`; getters `id`, `title`, `filePath`, `originalHash`, `uploaderId`. Used by `SignatureChainService` in Task 11/12.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/entities/Document.test.ts
import { describe, it, expect } from 'vitest'
import { Document } from './Document'
import { Hash } from '../value-objects/Hash'

function aHash(): Hash {
  return Hash.create(new Uint8Array(32).fill(1)).value
}

describe('Document', () => {
  it('creates a valid document', () => {
    const result = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: 'user-1'
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.title).toBe('Contract')
  })

  it('rejects an empty title', () => {
    const result = Document.create({
      id: 'doc-1',
      title: '  ',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: 'user-1'
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty filePath', () => {
    const result = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: '',
      originalHash: aHash(),
      uploaderId: 'user-1'
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty uploaderId', () => {
    const result = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: ''
    })
    expect(result.isFail()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Document.test.ts`
Expected: FAIL — `./Document` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/entities/Document.ts
import { Result } from '../result/Result'
import { InvalidDocumentError } from '../errors/InvalidDocumentError'
import { Hash } from '../value-objects/Hash'

export interface DocumentProps {
  id: string
  title: string
  filePath: string
  originalHash: Hash
  uploaderId: string
}

export class Document {
  private constructor(private readonly props: DocumentProps) {}

  static create(props: DocumentProps): Result<Document, InvalidDocumentError> {
    if (!props.id) {
      return Result.fail(new InvalidDocumentError('id must not be empty'))
    }
    if (!props.title || props.title.trim().length === 0) {
      return Result.fail(new InvalidDocumentError('title must not be empty'))
    }
    if (!props.filePath || props.filePath.trim().length === 0) {
      return Result.fail(new InvalidDocumentError('filePath must not be empty'))
    }
    if (!props.uploaderId) {
      return Result.fail(new InvalidDocumentError('uploaderId must not be empty'))
    }
    return Result.ok(new Document(props))
  }

  get id(): string {
    return this.props.id
  }

  get title(): string {
    return this.props.title
  }

  get filePath(): string {
    return this.props.filePath
  }

  get originalHash(): Hash {
    return this.props.originalHash
  }

  get uploaderId(): string {
    return this.props.uploaderId
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Document.test.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/Document.ts src/domain/entities/Document.test.ts
git commit -m "feat: add Document entity"
```

---

### Task 9: Signature entity

**Files:**
- Create: `src/domain/entities/Signature.ts`
- Test: `src/domain/entities/Signature.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `InvalidSignatureError` (Task 3), `SignatureBytes` (Task 6)
- Produces: `Signature.create(props: { id: string; documentId: string; userId: string; previousSignatureId: string | null; signatureData: SignatureBytes; signedAt: Date }): Result<Signature, InvalidSignatureError>`; getters `id`, `documentId`, `userId`, `previousSignatureId`, `signatureData`, `signedAt`. Used by `SignatureChainService` in Task 11/12.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/entities/Signature.test.ts
import { describe, it, expect } from 'vitest'
import { Signature } from './Signature'
import { SignatureBytes } from '../value-objects/SignatureBytes'

function someBytes(): SignatureBytes {
  return SignatureBytes.create(new Uint8Array([1, 2, 3])).value
}

describe('Signature', () => {
  it('creates a valid first-in-chain signature (previousSignatureId is null)', () => {
    const result = Signature.create({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date('2026-08-10T00:00:00Z')
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.previousSignatureId).toBeNull()
  })

  it('creates a valid subsequent signature referencing a previous one', () => {
    const result = Signature.create({
      id: 'sig-2',
      documentId: 'doc-1',
      userId: 'user-2',
      previousSignatureId: 'sig-1',
      signatureData: someBytes(),
      signedAt: new Date('2026-08-10T00:01:00Z')
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.previousSignatureId).toBe('sig-1')
  })

  it('rejects an empty id', () => {
    const result = Signature.create({
      id: '',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date()
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty documentId', () => {
    const result = Signature.create({
      id: 'sig-1',
      documentId: '',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date()
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty userId', () => {
    const result = Signature.create({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: '',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date()
    })
    expect(result.isFail()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Signature.test.ts`
Expected: FAIL — `./Signature` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/entities/Signature.ts
import { Result } from '../result/Result'
import { InvalidSignatureError } from '../errors/InvalidSignatureError'
import { SignatureBytes } from '../value-objects/SignatureBytes'

export interface SignatureProps {
  id: string
  documentId: string
  userId: string
  previousSignatureId: string | null
  signatureData: SignatureBytes
  signedAt: Date
}

export class Signature {
  private constructor(private readonly props: SignatureProps) {}

  static create(props: SignatureProps): Result<Signature, InvalidSignatureError> {
    if (!props.id) {
      return Result.fail(new InvalidSignatureError('id must not be empty'))
    }
    if (!props.documentId) {
      return Result.fail(new InvalidSignatureError('documentId must not be empty'))
    }
    if (!props.userId) {
      return Result.fail(new InvalidSignatureError('userId must not be empty'))
    }
    return Result.ok(new Signature(props))
  }

  get id(): string {
    return this.props.id
  }

  get documentId(): string {
    return this.props.documentId
  }

  get userId(): string {
    return this.props.userId
  }

  get previousSignatureId(): string | null {
    return this.props.previousSignatureId
  }

  get signatureData(): SignatureBytes {
    return this.props.signatureData
  }

  get signedAt(): Date {
    return this.props.signedAt
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Signature.test.ts`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/Signature.ts src/domain/entities/Signature.test.ts
git commit -m "feat: add Signature entity"
```

---

### Task 10: CryptoProvider port and test fake

**Files:**
- Create: `src/domain/ports/CryptoProvider.ts`
- Create: `src/domain/testing/FakeCryptoProvider.ts`

**Interfaces:**
- Consumes: `Hash` (Task 4), `PublicKey` (Task 5), `SignatureBytes` (Task 6)
- Produces: `interface CryptoProvider { hash(data: Uint8Array): Hash; verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean }`; `class FakeCryptoProvider implements CryptoProvider` with a deterministic in-memory hash and a controllable `verify()` for use by `SignatureChainService` tests (Task 11/12).

This task has no runtime behavior of its own (an interface plus a test double), so its "test" is that the fake type-checks against the interface and behaves deterministically — verified via `typecheck` and a short assertion script, not a full test suite entry.

- [ ] **Step 1: Write the interface**

```ts
// src/domain/ports/CryptoProvider.ts
import { Hash } from '../value-objects/Hash'
import { PublicKey } from '../value-objects/PublicKey'
import { SignatureBytes } from '../value-objects/SignatureBytes'

export interface CryptoProvider {
  hash(data: Uint8Array): Hash
  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean
}
```

- [ ] **Step 2: Write the fake implementation**

```ts
// src/domain/testing/FakeCryptoProvider.ts
import { CryptoProvider } from '../ports/CryptoProvider'
import { Hash } from '../value-objects/Hash'
import { PublicKey } from '../value-objects/PublicKey'
import { SignatureBytes } from '../value-objects/SignatureBytes'

/**
 * Deterministic in-memory CryptoProvider for domain tests.
 * hash() is a simple 32-byte fold of the input, not cryptographically secure.
 * verify() returns true iff the signature bytes equal hash(publicKey.bytes + message.bytes) --
 * tests build matching "signatures" with `sign()` below.
 */
export class FakeCryptoProvider implements CryptoProvider {
  hash(data: Uint8Array): Hash {
    const out = new Uint8Array(32)
    for (let i = 0; i < data.length; i++) {
      out[i % 32] ^= data[i]
    }
    return Hash.create(out).value
  }

  sign(publicKey: PublicKey, message: Hash): SignatureBytes {
    const combined = new Uint8Array(publicKey.toBytes().length + message.toBytes().length)
    combined.set(publicKey.toBytes(), 0)
    combined.set(message.toBytes(), publicKey.toBytes().length)
    return SignatureBytes.create(this.hash(combined).toBytes()).value
  }

  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean {
    const expected = this.sign(publicKey, message)
    return Buffer.from(expected.toBytes()).equals(Buffer.from(signature.toBytes()))
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/domain/ports/CryptoProvider.ts src/domain/testing/FakeCryptoProvider.ts
git commit -m "feat: add CryptoProvider port and FakeCryptoProvider test double"
```

---

### Task 11: SignatureChainService — duplicate prevention and payload construction

**Files:**
- Create: `src/domain/services/SignatureChainService.ts`
- Test: `src/domain/services/SignatureChainService.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 2), `DuplicateSignatureError` (Task 3), `Document` (Task 8), `Signature` (Task 9), `CryptoProvider` (Task 10), `FakeCryptoProvider` (Task 10)
- Produces: `class SignatureChainService { constructor(crypto: CryptoProvider); assertCanSign(existingSignatures: Signature[], userId: string): Result<true, DuplicateSignatureError>; buildSigningPayload(document: Document, previousSignature: Signature | null): Hash }`. `verifyChain` is added in Task 12 on this same class.

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/services/SignatureChainService.test.ts
import { describe, it, expect } from 'vitest'
import { SignatureChainService } from './SignatureChainService'
import { FakeCryptoProvider } from '../testing/FakeCryptoProvider'
import { Document } from '../entities/Document'
import { Signature } from '../entities/Signature'
import { Hash } from '../value-objects/Hash'
import { SignatureBytes } from '../value-objects/SignatureBytes'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function aSignature(overrides: Partial<{ id: string; userId: string; previousSignatureId: string | null }> = {}): Signature {
  return Signature.create({
    id: overrides.id ?? 'sig-1',
    documentId: 'doc-1',
    userId: overrides.userId ?? 'user-1',
    previousSignatureId: overrides.previousSignatureId ?? null,
    signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('SignatureChainService.assertCanSign', () => {
  it('allows a user who has not yet signed', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.assertCanSign([aSignature({ userId: 'user-2' })], 'user-1')
    expect(result.isOk()).toBe(true)
  })

  it('rejects a user who has already signed', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.assertCanSign([aSignature({ userId: 'user-1' })], 'user-1')
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('user-1')
  })
})

describe('SignatureChainService.buildSigningPayload', () => {
  it('for the first signer, hashes just the document hash', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()

    const payload = service.buildSigningPayload(document, null)

    expect(payload.equals(crypto.hash(document.originalHash.toBytes()))).toBe(true)
  })

  it('for a subsequent signer, hashes documentHash + previousSignature.signatureData', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const previous = aSignature({ id: 'sig-1', userId: 'user-1' })

    const payload = service.buildSigningPayload(document, previous)

    const expectedInput = new Uint8Array(
      document.originalHash.toBytes().length + previous.signatureData.toBytes().length
    )
    expectedInput.set(document.originalHash.toBytes(), 0)
    expectedInput.set(previous.signatureData.toBytes(), document.originalHash.toBytes().length)

    expect(payload.equals(crypto.hash(expectedInput))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SignatureChainService.test.ts`
Expected: FAIL — `./SignatureChainService` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/services/SignatureChainService.ts
import { Result } from '../result/Result'
import { DuplicateSignatureError } from '../errors/DuplicateSignatureError'
import { Document } from '../entities/Document'
import { Signature } from '../entities/Signature'
import { Hash } from '../value-objects/Hash'
import { CryptoProvider } from '../ports/CryptoProvider'

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

export class SignatureChainService {
  constructor(private readonly crypto: CryptoProvider) {}

  assertCanSign(existingSignatures: Signature[], userId: string): Result<true, DuplicateSignatureError> {
    const alreadySigned = existingSignatures.some((s) => s.userId === userId)
    if (alreadySigned) {
      return Result.fail(new DuplicateSignatureError(userId))
    }
    return Result.ok(true)
  }

  buildSigningPayload(document: Document, previousSignature: Signature | null): Hash {
    if (previousSignature === null) {
      return this.crypto.hash(document.originalHash.toBytes())
    }
    const combined = concatBytes(document.originalHash.toBytes(), previousSignature.signatureData.toBytes())
    return this.crypto.hash(combined)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- SignatureChainService.test.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/services/SignatureChainService.ts src/domain/services/SignatureChainService.test.ts
git commit -m "feat: add SignatureChainService duplicate check and payload construction"
```

---

### Task 12: SignatureChainService — full chain verification

**Files:**
- Modify: `src/domain/services/SignatureChainService.ts`
- Modify: `src/domain/services/SignatureChainService.test.ts`

**Interfaces:**
- Consumes: everything from Task 11, plus `BrokenChainError` (Task 3), `PublicKey` (Task 5)
- Produces: `verifyChain(document: Document, orderedSignatures: Signature[], publicKeysByUserId: Map<string, PublicKey>): Result<true, BrokenChainError>` added to `SignatureChainService`. This is the final public surface of the domain core for this plan.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/services/SignatureChainService.test.ts`:

```ts
import { PublicKey } from '../value-objects/PublicKey'
import { BrokenChainError } from '../errors/BrokenChainError'

function buildValidChain(crypto: FakeCryptoProvider, document: Document, userIds: string[]) {
  const publicKeysByUserId = new Map<string, PublicKey>()
  const signatures: Signature[] = []
  let previous: Signature | null = null

  for (const [index, userId] of userIds.entries()) {
    const publicKey = PublicKey.create(new Uint8Array([index + 1, index + 2, index + 3])).value
    publicKeysByUserId.set(userId, publicKey)

    const message =
      previous === null
        ? crypto.hash(document.originalHash.toBytes())
        : crypto.hash(
            (() => {
              const combined = new Uint8Array(
                document.originalHash.toBytes().length + previous!.signatureData.toBytes().length
              )
              combined.set(document.originalHash.toBytes(), 0)
              combined.set(previous!.signatureData.toBytes(), document.originalHash.toBytes().length)
              return combined
            })()
          )

    const signatureData = crypto.sign(publicKey, message)
    const signature = Signature.create({
      id: `sig-${index + 1}`,
      documentId: document.id,
      userId,
      previousSignatureId: previous?.id ?? null,
      signatureData,
      signedAt: new Date(2026, 7, 10, 0, index)
    }).value

    signatures.push(signature)
    previous = signature
  }

  return { signatures, publicKeysByUserId }
}

describe('SignatureChainService.verifyChain', () => {
  it('verifies a valid chain of three signatures', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2', 'user-3'])

    const result = service.verifyChain(document, signatures, publicKeysByUserId)

    expect(result.isOk()).toBe(true)
  })

  it('fails when a signature was tampered with (verification mismatch)', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2'])

    const tampered = Signature.create({
      id: signatures[1].id,
      documentId: signatures[1].documentId,
      userId: signatures[1].userId,
      previousSignatureId: signatures[1].previousSignatureId,
      signatureData: SignatureBytes.create(new Uint8Array([9, 9, 9, 9])).value,
      signedAt: signatures[1].signedAt
    }).value
    const chainWithTamperedSignature = [signatures[0], tampered]

    const result = service.verifyChain(document, chainWithTamperedSignature, publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
    expect(result.error.message).toContain(tampered.id)
  })

  it('fails when previousSignatureId does not match actual chain order', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2'])

    const misordered = Signature.create({
      id: signatures[1].id,
      documentId: signatures[1].documentId,
      userId: signatures[1].userId,
      previousSignatureId: 'sig-does-not-exist',
      signatureData: signatures[1].signatureData,
      signedAt: signatures[1].signedAt
    }).value

    const result = service.verifyChain(document, [signatures[0], misordered], publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })

  it('fails when no public key is registered for a signer', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1'])
    publicKeysByUserId.delete('user-1')

    const result = service.verifyChain(document, signatures, publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('user-1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SignatureChainService.test.ts`
Expected: FAIL — `service.verifyChain is not a function`.

- [ ] **Step 3: Add `verifyChain` to the implementation**

Add to `src/domain/services/SignatureChainService.ts` (inside the `SignatureChainService` class, and add the two new imports at the top):

```ts
// add to the top imports:
import { BrokenChainError } from '../errors/BrokenChainError'
import { PublicKey } from '../value-objects/PublicKey'
```

```ts
// add as a method on SignatureChainService, alongside assertCanSign and buildSigningPayload:
  verifyChain(
    document: Document,
    orderedSignatures: Signature[],
    publicKeysByUserId: Map<string, PublicKey>
  ): Result<true, BrokenChainError> {
    let previous: Signature | null = null

    for (const signature of orderedSignatures) {
      const expectedPreviousId = previous === null ? null : previous.id
      if (signature.previousSignatureId !== expectedPreviousId) {
        return Result.fail(
          new BrokenChainError(signature.id, 'previousSignatureId does not match actual chain order')
        )
      }

      const publicKey = publicKeysByUserId.get(signature.userId)
      if (!publicKey) {
        return Result.fail(new BrokenChainError(signature.id, `no public key found for user ${signature.userId}`))
      }

      const message = this.buildSigningPayload(document, previous)
      const isValid = this.crypto.verify(publicKey, message, signature.signatureData)
      if (!isValid) {
        return Result.fail(new BrokenChainError(signature.id, 'cryptographic verification failed'))
      }

      previous = signature
    }

    return Result.ok(true)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- SignatureChainService.test.ts`
Expected: PASS, 8 tests passing (4 from Task 11 + 4 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: All tests across every file pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/services/SignatureChainService.ts src/domain/services/SignatureChainService.test.ts
git commit -m "feat: add full signature chain verification"
```

---

## Self-Review Notes

- **Spec coverage:** Result type (Task 2), DomainError hierarchy (Task 3), Hash/PublicKey/SignatureBytes value objects (Tasks 4-6), User/Document/Signature entities (Tasks 7-9), CryptoProvider port with no `sign()` (Task 10), duplicate prevention + payload construction + full chain verification (Tasks 11-12) — every section of the spec maps to a task.
- **No enforced signer order** is reflected in `verifyChain`: order is derived from the `previousSignatureId` links actually present in `orderedSignatures`, not from any external sequence — any user could have signed at any time.
- **Type consistency checked:** `Hash`, `PublicKey`, `SignatureBytes`, `Document`, `Signature`, `CryptoProvider`, and `Result<T, E>` signatures are used identically across Tasks 8-12 (verified getter names `originalHash`, `signatureData`, `previousSignatureId` match between entity definitions and service usage).
- **Out of scope**, per the design spec, remains out of scope: no use cases, no Hono controllers, no PostgreSQL, no concrete (non-fake) `CryptoProvider`, no Flutter app.
