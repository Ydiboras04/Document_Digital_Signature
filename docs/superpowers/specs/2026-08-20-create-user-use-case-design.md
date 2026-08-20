# CreateUserUseCase and Registration Endpoint — Design Spec

Date: 2026-08-20
Status: Approved

## Purpose

Add real user registration to the backend: a `CreateUserUseCase` and a
`POST /users` HTTP route, so the system is no longer limited to the 3
fixed seed users (`alice`/`bob`/`carol`). This unblocks the Flutter mobile
app, which needs to be able to register a real user — generating an
Ed25519 keypair on-device and sending only the public key to the server —
before any real login/identity work in the app can begin.

This follows the exact same shape as `UploadDocumentUseCase`/
`SignDocumentUseCase`, and is small enough to build the use case and wire
it into HTTP in one sub-project, unlike the original three use cases
(Upload/Sign/Verify), which were deliberately split from their HTTP
wiring.

## Scope

Uniqueness is enforced on **email only**, matching the existing database
schema exactly — `users.email` already has a `UNIQUE` constraint; `username`
does not, and nothing in the domain currently treats username as an
identifier. No schema migration is needed.

## Domain Layer: New Error

```
src/domain/errors/DuplicateEmailError.ts
```

```ts
export class DuplicateEmailError extends DomainError {
  constructor(email: string) {
    super(`Email ${email} is already registered`)
  }
}
```

No existing domain error fits "email already registered" — the closest,
`DuplicateSignatureError`, is specific to signatures.

## Port Changes: UserRepository

`UserRepository` (currently read-only — `findById()` only) gains:

```ts
save(user: User): Promise<void>
findByEmail(email: string): Promise<User | null>
```

Implemented in all three existing `UserRepository` implementations:
- `PostgresUserRepository` — real `INSERT`/`SELECT WHERE email = ...`.
- `InMemoryUserRepository` — array push / array find.
- `FakeUserRepository` (`src/use-cases/testing/`) — same pattern against
  its existing public `users: User[]` array, which tests already push
  fixtures into directly.

## CreateUserUseCase

```
src/use-cases/create-user/CreateUserUseCase.ts
src/use-cases/create-user/CreateUserUseCase.test.ts
```

**Input:**
```ts
interface CreateUserInput {
  username: string
  email: string
  publicKeyBytes: Uint8Array
}
```

**`execute(input): Promise<Result<User, CreateUserError>>`**

where `CreateUserError = DuplicateEmailError | InvalidValueError | InvalidUserError`
— entirely reused/new domain errors, no use-case-specific wrapper.

Steps:
1. `userRepository.findByEmail(input.email)`. If found, return
   `Result.fail(new DuplicateEmailError(input.email))`.
2. `PublicKey.create(input.publicKeyBytes)`. If it fails (not exactly 32
   bytes), propagate its `InvalidValueError` as-is.
3. `User.create({ id: idGenerator.generate(), username: input.username, email: input.email, publicKey })`.
   If it fails (empty username, malformed email), propagate its
   `InvalidUserError` as-is — this reuses `User.create()`'s existing
   email-format regex validation rather than duplicating it in the use
   case.
4. `userRepository.save(user)`, then return `Result.ok(user)`.

Constructor dependencies: `IdGenerator`, `UserRepository` — both already
exist.

## HTTP Route

`POST /users` in `src/interface-adapters/http/routes/users.ts` (new file,
mirroring `routes/documents.ts`'s factory-function pattern), mounted onto
`app.ts` alongside the existing `documents` routes.

- Body: `{ username: string, email: string, publicKeyBytes: string }` —
  `publicKeyBytes` is base64 (same convention as `fileBytes`/
  `signatureBytes` on the existing routes).
- Basic request validation (missing/wrong-type fields → `400`), same
  pattern as the existing routes.
- Success: `201` with a serialized user:
  ```ts
  { id: string; username: string; email: string; publicKey: string }
  // publicKey is base64
  ```
  via a new `toUserJson()` in `serialization.ts`.
- Failure: routed through the existing `mapDomainErrorToResponse()`, which
  gains one new table entry: `DuplicateEmailError` → `409` (matching
  `DuplicateSignatureError`'s precedent for "this thing already exists").

## Testing

- `CreateUserUseCase.test.ts`: successful registration, duplicate email
  rejection, malformed public key (wrong byte length), invalid
  username/email format.
- `PostgresUserRepository.test.ts` / `InMemoryUserRepository.test.ts`:
  new test cases for `save()` and `findByEmail()`.
- A new integration test file (or an addition to the existing
  `documents.integration.test.ts` pattern) for `POST /users`: successful
  registration (201), duplicate email (409), malformed public key (400 —
  reaches `mapDomainErrorToResponse` via `InvalidValueError`).

## Out of Scope

- Any authentication/session mechanism (login tokens, passwords) — this
  is registration only. The app identifies itself to the server by
  `userId` on Sign/Verify calls, same as today's seed-user flow; adding
  real auth is a separate future concern.
- Changing how `Sign`/`Verify` look up users — they already use
  `UserRepository.findById()`, unaffected by this change.
- The Flutter mobile app itself — this sub-project only unblocks it.
