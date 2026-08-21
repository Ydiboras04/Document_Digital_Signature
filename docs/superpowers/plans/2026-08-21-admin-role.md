# Admin Role and Upload Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `User` an `isAdmin` flag that only an out-of-band script can set, carry it in the session JWT, and reject document upload by anyone who is not an admin — on the server, with the Flutter app merely hiding a control it knows would fail.

**Architecture:** The role is a boolean on the domain `User` and a `is_admin` column on `users`, defaulted `false` everywhere. `CreateUserUseCase` hardcodes `false`, so no HTTP path can grant admin; promotion is a `npm run db:promote-admin` script calling a `PostgresUserRepository` method that nothing else routes to. `VerifyChallengeUseCase` already returns the full `User`, so `/auth/token` adds an `isAdmin` claim with no extra query, and the upload route authorises from that already-verified claim.

**Tech Stack:** Existing stack only. Backend: Drizzle/Postgres (one generated migration), Hono's built-in `hono/jwt`, Vitest. Flutter: `dart:convert` for the client-side claim decode — no new dependency on either side.

**Spec:** `docs/superpowers/specs/2026-08-21-admin-role-design.md`

## Global Constraints

- **No request can grant admin.** `CreateUserUseCase` hardcodes `isAdmin: false` and never reads a role from its input. Promotion exists only as a database-side script.
- Exactly two roles, represented as a **boolean** — no role enum.
- The role is **additive**: admins keep every regular-user capability, including signing.
- Only `POST /documents` gains an authorization check. `GET /documents`, `GET /documents/:documentId`, `POST /documents/:documentId/signatures`, and `GET /documents/:documentId/verify` keep their current behaviour for every authenticated user.
- Client-side role reading is **UI only** and is never an enforcement point. A modified client can show itself an upload button; it gets `403`.
- No new backend or Flutter dependencies.
- Domain and use-case layers stay transport-agnostic. Authorization lives in the route layer; `UploadDocumentUseCase` is untouched.
- The JWT's existing `sub`/`exp` claims and the whole sub-project 1 handshake — including the `SecureDocChain-auth-challenge-v1` domain separation — are unchanged.
- An absent or malformed `isAdmin` claim reads as `false` (fail-closed), so tokens issued before this change degrade to regular-user access.
- `ForbiddenError` is a literal string in the route's 403 response body matching the existing `{ error: { type, message } }` envelope — **not** a new `DomainError` subclass.

---

### Task 1: `User.isAdmin` and registration that can never grant it

**Files:**
- Modify: `src/domain/entities/User.ts`
- Modify: `src/use-cases/create-user/CreateUserUseCase.ts`
- Test: `src/use-cases/create-user/CreateUserUseCase.test.ts` (add a case to the existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `UserProps.isAdmin?: boolean` (optional, defaults `false`) and the `User.isAdmin: boolean` getter. Tasks 2, 4 depend on this.

**Why `isAdmin` is optional in `UserProps`:** every existing `User.create({ id, username, email, publicKey })` call site across the codebase and its tests keeps compiling untouched, and each yields a non-admin. Making it required would force a mechanical edit through dozens of unrelated tests for no behavioural gain, and would make "forgot to pass it" a compile error rather than the safe default.

- [ ] **Step 1: Write the failing test**

Add to the existing `src/use-cases/create-user/CreateUserUseCase.test.ts`, inside its existing top-level `describe` block:

```ts
  it('always creates a non-admin user, even though admin exists as a concept', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(32).fill(4)
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.isAdmin).toBe(false)
  })
```

If the existing file's helper is not named `setup()` or does not return `{ useCase }`, adapt this one line to match the file's existing convention — read the file first and follow whatever it already does to build the use case.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/use-cases/create-user/CreateUserUseCase.test.ts`
Expected: FAIL — `Property 'isAdmin' does not exist on type 'User'`.

- [ ] **Step 3: Add `isAdmin` to the `User` entity**

In `src/domain/entities/User.ts`, add the optional prop to the interface:

```ts
export interface UserProps {
  id: string
  username: string
  email: string
  publicKey: PublicKey
  isAdmin?: boolean
}
```

and add this getter to the `User` class, after the existing `publicKey` getter:

```ts
  /**
   * Defaults to false when unset: a user is never an administrator unless
   * something says so explicitly. Only the promotion script can set it.
   */
  get isAdmin(): boolean {
    return this.props.isAdmin ?? false
  }
```

Leave `User.create`'s validation untouched — a boolean with a safe default needs none.

- [ ] **Step 4: Make registration explicit about it**

In `src/use-cases/create-user/CreateUserUseCase.ts`, add the field to the `User.create` call so the intent is stated in code rather than relied upon as a default:

```ts
    const userResult = User.create({
      id: this.idGenerator.generate(),
      username: input.username,
      email: input.email,
      publicKey: publicKeyResult.value,
      // Hardcoded, never read from input: registration is a public endpoint,
      // so any role it could accept, anyone could claim.
      isAdmin: false
    })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/use-cases/create-user/CreateUserUseCase.test.ts`
Expected: PASS — the existing tests plus the new one.

- [ ] **Step 6: Commit**

```bash
git add src/domain/entities/User.ts src/use-cases/create-user/CreateUserUseCase.ts src/use-cases/create-user/CreateUserUseCase.test.ts
git commit -m "feat: add User.isAdmin, defaulting false and never set by registration"
```

---

### Task 2: Persist the role, and give the seed fixtures explicit roles

**Files:**
- Modify: `src/infrastructure/db/schema.ts`
- Create: `drizzle/<generated>.sql` (produced by `drizzle-kit generate` — do not hand-write)
- Modify: `src/infrastructure/db/PostgresUserRepository.ts`
- Modify: `src/infrastructure/db/testSupport.ts`
- Modify: `src/infrastructure/db/seed.ts`
- Test: `src/infrastructure/db/PostgresUserRepository.test.ts` (add cases to the existing file)

**Interfaces:**
- Consumes: `User.isAdmin` (Task 1).
- Produces: the `users.is_admin` column; `PostgresUserRepository` round-tripping `isAdmin` through `save`/`findById`/`findByEmail`; and `PostgresUserRepository.setAdminStatus(userId: string, isAdmin: boolean): Promise<void>`. Task 3's script and Task 4's integration tests depend on these. `ensureSeedUsers()` now guarantees `user-alice` is an admin and `user-bob`/`user-carol` are not.

**Why `setAdminStatus` is on `PostgresUserRepository` and not on the `UserRepository` port:** the port exists to serve use cases, and promotion is an operations concern with no use case behind it. Adding it to the port would force `FakeUserRepository` and every other implementer to carry a method no use case ever calls. The script is infrastructure calling infrastructure.

**Why `ensureSeedUsers` needs an explicit update, not just new insert values:** it uses `onConflictDoNothing()`, and `user-alice` already exists in the developer's database from earlier sub-projects. New `values(...)` would be ignored for her row, leaving her non-admin — which would make every pre-existing upload test in `documents.integration.test.ts` start returning `403`. The explicit update is what makes this idempotent against an already-populated database.

- [ ] **Step 1: Write the failing tests**

Add to the existing `src/infrastructure/db/PostgresUserRepository.test.ts`, inside its existing `describe('PostgresUserRepository', ...)` block:

```ts
  it('round-trips a non-admin user', async () => {
    const repository = new PostgresUserRepository()
    const email = `dave-${randomUUID()}@example.com`
    const user = User.create({
      id: randomUUID(),
      username: 'dave',
      email,
      publicKey: PublicKey.create(new Uint8Array(32).fill(7)).value
    }).value

    await repository.save(user)

    expect((await repository.findByEmail(email))!.isAdmin).toBe(false)
  })

  it('round-trips an admin user', async () => {
    const repository = new PostgresUserRepository()
    const email = `erin-${randomUUID()}@example.com`
    const user = User.create({
      id: randomUUID(),
      username: 'erin',
      email,
      publicKey: PublicKey.create(new Uint8Array(32).fill(8)).value,
      isAdmin: true
    }).value

    await repository.save(user)

    expect((await repository.findByEmail(email))!.isAdmin).toBe(true)
  })

  it('setAdminStatus promotes and demotes an existing user', async () => {
    const repository = new PostgresUserRepository()
    const email = `frank-${randomUUID()}@example.com`
    const id = randomUUID()
    await repository.save(
      User.create({
        id,
        username: 'frank',
        email,
        publicKey: PublicKey.create(new Uint8Array(32).fill(9)).value
      }).value
    )

    await repository.setAdminStatus(id, true)
    expect((await repository.findById(id))!.isAdmin).toBe(true)

    await repository.setAdminStatus(id, false)
    expect((await repository.findById(id))!.isAdmin).toBe(false)
  })

  it('setAdminStatus on an unknown id is a no-op rather than an error', async () => {
    const repository = new PostgresUserRepository()

    await expect(repository.setAdminStatus(randomUUID(), true)).resolves.toBeUndefined()
  })

  it('seeds alice as an admin and bob as a regular user', async () => {
    const repository = new PostgresUserRepository()

    expect((await repository.findById('user-alice'))!.isAdmin).toBe(true)
    expect((await repository.findById('user-bob'))!.isAdmin).toBe(false)
  })
```

That no-op test documents a real hazard rather than a triviality: `setAdminStatus` updating zero rows is indistinguishable from success at this layer, which is exactly why the script in Task 3 resolves the user *before* calling it instead of relying on this method to report a miss.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/infrastructure/db/PostgresUserRepository.test.ts`
Expected: FAIL — `setAdminStatus` does not exist, and `isAdmin` is not persisted.

- [ ] **Step 3: Add the column to the schema**

In `src/infrastructure/db/schema.ts`, add the column to the existing `users` table. Add `boolean` to the existing import from `drizzle-orm/pg-core`:

```ts
import { pgTable, text, timestamp, customType, boolean } from 'drizzle-orm/pg-core'
```

and add the column as the last field of `users`:

```ts
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false)
})
```

The `default(false)` is what makes this migration safe against the rows already in the database — every existing user becomes a non-admin.

- [ ] **Step 4: Generate and apply the migration**

Run: `npx drizzle-kit generate`
Expected: a new file appears under `drizzle/`. Read it and confirm it is an `ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;` — if it contains anything that drops or recreates a table, stop and report BLOCKED rather than applying it.

Run: `npx drizzle-kit migrate`
Expected: applies cleanly.

- [ ] **Step 5: Persist and read the flag**

In `src/infrastructure/db/PostgresUserRepository.ts`, add `isAdmin: row.isAdmin` to the `User.create({...})` object in **both** `findById` and `findByEmail`, and add `isAdmin: user.isAdmin` to the `db.insert(users).values({...})` object in `save`. Then add this method to the class:

```ts
  /**
   * The only code in the system that can grant admin. Deliberately not on the
   * UserRepository port: promotion is an operations concern with no use case
   * behind it, reached only by the db:promote-admin script.
   */
  async setAdminStatus(userId: string, isAdmin: boolean): Promise<void> {
    await db.update(users).set({ isAdmin }).where(eq(users.id, userId))
  }
```

- [ ] **Step 6: Give the seed fixtures explicit roles**

In `src/infrastructure/db/testSupport.ts`, add `inArray` to the drizzle import and add `eq`:

```ts
import { eq, inArray } from 'drizzle-orm'
```

and replace the body of `ensureSeedUsers` with:

```ts
export async function ensureSeedUsers(): Promise<void> {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: ed25519TestKeys.alice.publicKeyBytes },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: ed25519TestKeys.bob.publicKeyBytes },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: ed25519TestKeys.carol.publicKeyBytes }
    ])
    .onConflictDoNothing()

  // Roles are set explicitly rather than through the insert above, because
  // onConflictDoNothing leaves pre-existing rows untouched and these fixtures
  // predate the is_admin column. Alice is the admin fixture; the integration
  // tests upload as her, and bob is the non-admin the 403 tests use.
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, 'user-alice'))
  await db.update(users).set({ isAdmin: false }).where(inArray(users.id, ['user-bob', 'user-carol']))
}
```

Apply the identical role-assignment block to `src/infrastructure/db/seed.ts` after its insert, adding the same `import { eq, inArray } from 'drizzle-orm'` and changing its log line to `console.log('Seeded 3 test users (alice is an admin).')`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/infrastructure/db/PostgresUserRepository.test.ts`
Expected: PASS — the 4 pre-existing tests plus the 4 new ones.

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/db/schema.ts drizzle/ src/infrastructure/db/PostgresUserRepository.ts src/infrastructure/db/PostgresUserRepository.test.ts src/infrastructure/db/testSupport.ts src/infrastructure/db/seed.ts
git commit -m "feat: persist User.isAdmin and seed alice as the admin fixture"
```

---

### Task 3: The promotion script

**Files:**
- Create: `src/infrastructure/db/promoteAdmin.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PostgresUserRepository.findByEmail` (existing) and `.setAdminStatus` (Task 2).
- Produces: `npm run db:promote-admin -- <email>`. Nothing in the codebase imports this file.

- [ ] **Step 1: Write the script**

Create `src/infrastructure/db/promoteAdmin.ts`:

```ts
import { PostgresUserRepository } from './PostgresUserRepository.js'

/**
 * Grants admin out-of-band. This exists as a script rather than an endpoint
 * because registration is public: any admin-granting path reachable over HTTP
 * would be reachable by everyone.
 *
 * Usage: npm run db:promote-admin -- alice@example.com
 */
async function promoteAdmin(): Promise<void> {
  const email = process.argv[2]
  if (email === undefined || email.length === 0) {
    console.error('Usage: npm run db:promote-admin -- <email>')
    process.exit(1)
  }

  const repository = new PostgresUserRepository()
  const user = await repository.findByEmail(email)
  if (user === null) {
    // Exiting non-zero matters here: a silent no-op on a typo'd address would
    // leave the operator believing they had granted access they had not.
    console.error(`No user found with email ${email}. Nobody was promoted.`)
    process.exit(1)
  }

  if (user.isAdmin) {
    console.log(`${user.username} <${email}> is already an admin. Nothing to do.`)
    process.exit(0)
  }

  await repository.setAdminStatus(user.id, true)
  console.log(`Promoted ${user.username} <${email}> to admin.`)
  process.exit(0)
}

promoteAdmin()
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add this line to `"scripts"`, after the existing `"db:seed"` entry:

```json
    "db:promote-admin": "tsx --env-file=.env src/infrastructure/db/promoteAdmin.ts"
```

Remember to add a comma to the end of the preceding `db:seed` line so the JSON stays valid.

- [ ] **Step 3: Verify all three paths by hand**

This script is an operator tool with no automated test — its behaviour is three `console` branches around one already-tested repository call (`setAdminStatus`, covered in Task 2), and it calls `process.exit`, which is awkward to assert against without restructuring the script purely for testability. Exercise it directly instead.

Note on spec coverage: the spec asks for "a `PostgresUserRepository` test for the promotion method, including the unknown-email case." The repository method takes a *userId*, not an email, so the unknown-**id** case is covered automatically in Task 2, and the unknown-**email** case — the one an operator actually hits, by typo — lives here, since resolving an email to a user is the script's job. Both halves are covered; they just sit either side of the layer boundary.

Run: `npm run db:promote-admin`
Expected: prints the usage line, exits non-zero.

Run: `npm run db:promote-admin -- nobody@example.com`
Expected: prints `No user found with email nobody@example.com. Nobody was promoted.`, exits non-zero.

Run: `npm run db:promote-admin -- alice@example.com`
Expected: prints that alice is already an admin (Task 2's seed made her one), exits zero.

Confirm the flag directly:
```bash
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "SELECT username, is_admin FROM users ORDER BY username;"
```
Expected: `alice | t`, with `bob` and `carol` showing `f`.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/db/promoteAdmin.ts package.json
git commit -m "feat: add db:promote-admin script"
```

---

### Task 4: The `isAdmin` claim and upload authorization

**Files:**
- Modify: `src/interface-adapters/http/routes/auth.ts`
- Modify: `src/interface-adapters/http/authContext.ts`
- Modify: `src/interface-adapters/http/routes/documents.ts`
- Test: `src/interface-adapters/http/auth.integration.test.ts` (add a case to the existing file)
- Test: `src/interface-adapters/http/documents.integration.test.ts` (add cases to the existing file)

**Interfaces:**
- Consumes: `User.isAdmin` (Task 1), the seeded roles from `ensureSeedUsers` (Task 2), `authTokenFor(userId, keyPair)` and `bearer(token)` from the existing `src/interface-adapters/http/authTestSupport.ts`.
- Produces: an `isAdmin` claim on every issued JWT; `isAuthenticatedUserAdmin(c: Context): boolean`; `POST /documents` returning `403` for non-admins. Task 5's Flutter client reads the same claim.

- [ ] **Step 1: Write the failing tests**

Add to `src/interface-adapters/http/auth.integration.test.ts`, inside the existing `describe('POST /auth/token', ...)` block:

```ts
  it('carries the isAdmin claim, true for an admin', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signChallenge(ed25519TestKeys.alice, new Uint8Array(Buffer.from(challenge, 'base64')))

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    const { token } = await res.json()
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(payload.isAdmin).toBe(true)
  })

  it('carries the isAdmin claim, false for a regular user', async () => {
    const challengeRes = await requestChallenge('user-bob')
    const { challenge } = await challengeRes.json()
    const signature = signChallenge(ed25519TestKeys.bob, new Uint8Array(Buffer.from(challenge, 'base64')))

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-bob',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    const { token } = await res.json()
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(payload.isAdmin).toBe(false)
  })
```

**Read the existing file first** and reuse whatever it already uses to build a correctly domain-separated signature — sub-project 1 added a prefix-and-hash step, so the helper may be named `signChallenge`, or the file may inline `authChallengeMessage` plus `Ed25519CryptoProvider.hash`. Match what is there; do **not** sign the raw challenge, which is now explicitly rejected. Likewise reuse the file's existing `requestChallenge` helper if present.

Add to `src/interface-adapters/http/documents.integration.test.ts` a new top-level `describe` block (the file already mints `aliceToken` and `bobToken` in its `beforeAll` — reuse them):

```ts
describe('upload authorization', () => {
  it('rejects an upload from a non-admin with 403', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(bobToken),
      body: JSON.stringify({
        title: 'Contract',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.type).toBe('ForbiddenError')
  })

  it('allows an upload from an admin', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({
        title: 'Contract',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(201)
  })

  it('still lets a non-admin list, read, sign, and verify', async () => {
    const document = await uploadADocument()

    const listRes = await app.request('/documents', { headers: bearer(bobToken) })
    expect(listRes.status).toBe(200)

    const detailRes = await app.request(`/documents/${document.id}`, { headers: bearer(bobToken) })
    expect(detailRes.status).toBe(200)
    const detail = await detailRes.json()

    const signatureBytes = signWithTestKey(
      ed25519TestKeys.bob,
      new Uint8Array(Buffer.from(detail.signingPayload, 'base64'))
    )
    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(bobToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })
    expect(signRes.status).toBe(201)

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(bobToken) })
    expect(verifyRes.status).toBe(200)
  })
})
```

That third test is the most important one in this task: the likeliest defect in this change is over-restriction, and it is the only test that would catch the admin check being applied to the wrong route.

If `bobToken` is not already minted in the file's `beforeAll`, add it there alongside `aliceToken`, following the existing pattern (`await authTokenFor('user-bob', ed25519TestKeys.bob)`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interface-adapters/http/auth.integration.test.ts src/interface-adapters/http/documents.integration.test.ts`
Expected: FAIL — no `isAdmin` claim is issued (`undefined`, not `true`/`false`), and bob's upload returns `201` instead of `403`.

- [ ] **Step 3: Add the claim**

In `src/interface-adapters/http/routes/auth.ts`, add the claim to the `sign(...)` payload. `result.value` is the full `User` returned by `VerifyChallengeUseCase`, so no extra query is needed:

```ts
    const token = await sign(
      {
        sub: result.value.id,
        isAdmin: result.value.isAdmin,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
      },
      dependencies.jwtSecret
    )
```

- [ ] **Step 4: Add the context helper**

In `src/interface-adapters/http/authContext.ts`, add this function beside the existing `getAuthenticatedUserId`:

```ts
/**
 * Reads the admin claim from the already-verified JWT payload.
 *
 * An absent or non-boolean claim reads as false, so tokens issued before the
 * claim existed degrade to regular-user access rather than to admin.
 */
export function isAuthenticatedUserAdmin(c: Context): boolean {
  const payload = c.get('jwtPayload') as { isAdmin?: unknown } | undefined
  return payload?.isAdmin === true
}
```

- [ ] **Step 5: Enforce it on upload only**

In `src/interface-adapters/http/routes/documents.ts`, add `isAuthenticatedUserAdmin` to the existing import from `'../authContext.js'`, then add the check as the first thing the upload handler does after resolving the uploader:

```ts
  documents.post('/documents', async (c) => {
    const uploaderId = getAuthenticatedUserId(c)
    if (!isAuthenticatedUserAdmin(c)) {
      return c.json(
        { error: { type: 'ForbiddenError', message: 'Only an administrator may upload documents' } },
        403
      )
    }
```

Leave the rest of that handler, and every other route in the file, exactly as it is. The check goes in the handler rather than in middleware because Hono matches middleware on path, and `POST /documents` shares its path with `GET /documents` — a path-mounted guard would lock regular users out of the document list.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/interface-adapters/http/auth.integration.test.ts src/interface-adapters/http/documents.integration.test.ts`
Expected: PASS, including every pre-existing test in both files.

- [ ] **Step 7: Run the full backend suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/interface-adapters/http/routes/auth.ts src/interface-adapters/http/authContext.ts src/interface-adapters/http/routes/documents.ts src/interface-adapters/http/auth.integration.test.ts src/interface-adapters/http/documents.integration.test.ts
git commit -m "feat: carry isAdmin in the JWT and restrict upload to admins"
```

---

### Task 5: `AuthSession.isAdmin()` on the Flutter side

**Files:**
- Modify: `flutter_digital_sign/lib/core/auth/auth_session.dart`
- Create: `flutter_digital_sign/test/core/auth/jwt_test_helper.dart` (test helper, no tests of its own)
- Test: `flutter_digital_sign/test/core/auth/auth_session_test.dart` (add cases to the existing file)

**Interfaces:**
- Consumes: `AuthSession.token()` (existing), `dart:convert`.
- Produces: `AuthSession.isAdmin() -> Future<bool>`; and `unsignedJwt(Map<String, dynamic> payload) -> String` from the test helper. Task 6 depends on both.

- [ ] **Step 1: Write the test helper**

Create `flutter_digital_sign/test/core/auth/jwt_test_helper.dart`:

```dart
import 'dart:convert';

/// Builds a realistically-shaped JWT with a genuine base64url payload.
///
/// The signature segment is a placeholder: the client never verifies it, it
/// only reads claims for UI decisions. `FakeAuthApi`'s default of returning a
/// bare string like 'fake-token' cannot be decoded, so tests that exercise
/// claim-reading need this instead of a stub.
String unsignedJwt(Map<String, dynamic> payload) {
  String segment(Map<String, dynamic> json) =>
      base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');

  return '${segment({'alg': 'HS256', 'typ': 'JWT'})}.${segment(payload)}.signature';
}
```

- [ ] **Step 2: Write the failing tests**

Add to `flutter_digital_sign/test/core/auth/auth_session_test.dart`. Add this import alongside the existing ones:

```dart
import 'jwt_test_helper.dart';
```

and add these tests inside the existing `void main() { ... }` block. They reuse the file's existing `storageWithIdentity()` helper — read the file first and match whatever it is actually called:

```dart
  test('isAdmin is true when the token claims it', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => unsignedJwt({'sub': 'user-1', 'isAdmin': true}));
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    expect(await session.isAdmin(), isTrue);
  });

  test('isAdmin is false when the token denies it', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => unsignedJwt({'sub': 'user-1', 'isAdmin': false}));
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    expect(await session.isAdmin(), isFalse);
  });

  test('isAdmin is false when the token carries no claim at all', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => unsignedJwt({'sub': 'user-1'}));
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    expect(await session.isAdmin(), isFalse);
  });

  test('isAdmin is false for a token that is not decodable at all', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => 'not-a-jwt');
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    expect(await session.isAdmin(), isFalse);
  });

  test('isAdmin reuses the cached token rather than re-handshaking', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => unsignedJwt({'sub': 'user-1', 'isAdmin': true}));
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    await session.token();
    await session.isAdmin();

    expect(fakeAuthApi.challengeCalls, hasLength(1));
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/auth/auth_session_test.dart`
Expected: FAIL — `The method 'isAdmin' isn't defined for the type 'AuthSession'`.

- [ ] **Step 4: Implement `isAdmin()`**

In `flutter_digital_sign/lib/core/auth/auth_session.dart`, add this method to `AuthSession`, after `token()` and before `invalidate()`:

```dart
  /// Reads the `isAdmin` claim from the current session token.
  ///
  /// This is a UI affordance, not a security boundary: the signature is never
  /// checked here, and a modified client could return true regardless. The
  /// server enforces the restriction and returns 403. All this does is avoid
  /// offering an action we know would fail.
  ///
  /// Anything unreadable -- wrong shape, bad base64, absent claim -- is false,
  /// so the failure direction is always toward fewer capabilities.
  Future<bool> isAdmin() async {
    final jwt = await token();
    final parts = jwt.split('.');
    if (parts.length != 3) {
      return false;
    }
    try {
      final decoded = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
      final payload = jsonDecode(decoded) as Map<String, dynamic>;
      return payload['isAdmin'] == true;
    } catch (_) {
      return false;
    }
  }
```

`base64Url.normalize` restores the padding that JWT segments omit; without it, decoding throws on most real tokens.

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/core/auth/auth_session_test.dart`
Expected: PASS — the 5 pre-existing tests plus the 5 new ones.

- [ ] **Step 6: Commit**

```bash
git add flutter_digital_sign/lib/core/auth/auth_session.dart flutter_digital_sign/test/core/auth/jwt_test_helper.dart flutter_digital_sign/test/core/auth/auth_session_test.dart
git commit -m "feat: read the isAdmin claim client-side for UI gating"
```

---

### Task 6: Hide the upload control from non-admins

**Files:**
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/next_page.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`
- Test: `flutter_digital_sign/test/document_selection_test.dart` (replace the whole file)

**Interfaces:**
- Consumes: `AuthSession.isAdmin()` and `unsignedJwt(...)` (Task 5), `FakeAuthApi` (existing), `AuthSession` (existing).
- Produces: `NextPage({documentApi, identityStorage, authSession})` — all optional — and `NextContent({required documentApi, required identityStorage, required authSession})`.

**Why every existing `NextPage` widget test must change:** `NextContent` now needs an `AuthSession`. If a test omits it, `NextPage` builds a real one wrapping `HttpAuthApi`, and `isAdmin()` would attempt a live network call inside `flutter test`. Passing a fake-backed session is what keeps these tests hermetic — which is why the whole test file is given below rather than a set of edits.

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `flutter_digital_sign/test/document_selection_test.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/next_page.dart';
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'package:flutter_digital_sign/core/network/auth_api.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'core/auth/jwt_test_helper.dart';
import 'core/network/fake_auth_api.dart';
import 'core/network/fake_document_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<void> saveIdentity() async {
    await IdentityStorage().save('user-1', [1, 2, 3], List.generate(32, (i) => i));
  }

  /// A session backed by a fake handshake, issuing a token with the given role.
  /// Widget tests must never fall back to the real HttpAuthApi.
  AuthSession sessionFor({required bool isAdmin}) {
    final authApi = FakeAuthApi()
      ..onExchangeForToken =
          ((userId, signature) => unsignedJwt({'sub': 'user-1', 'isAdmin': isAdmin}));
    return AuthSession(authApi: authApi, identityStorage: IdentityStorage());
  }

  Widget appWith(FakeDocumentApi api, {required bool isAdmin}) {
    return MaterialApp(
      home: NextPage(
        documentApi: api,
        identityStorage: IdentityStorage(),
        authSession: sessionFor(isAdmin: isAdmin),
      ),
    );
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

    await tester.pumpWidget(appWith(fakeApi, isAdmin: false));
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

    await tester.pumpWidget(appWith(fakeApi, isAdmin: false));
    await tester.pumpAndSettle();

    expect(find.text('Signed'), findsOneWidget);
  });

  testWidgets('hides the upload control from a non-admin', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()..onListDocuments = () => [];

    await tester.pumpWidget(appWith(fakeApi, isAdmin: false));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.upload_file), findsNothing);
  });

  testWidgets('shows the upload control to an admin', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()..onListDocuments = () => [];

    await tester.pumpWidget(appWith(fakeApi, isAdmin: true));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.upload_file), findsOneWidget);
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

    await tester.pumpWidget(appWith(fakeApi, isAdmin: false));
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

  testWidgets('recovers to registration when the server does not know this identity', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onListDocuments = () => throw UnknownIdentityException();

    await tester.pumpWidget(
      MaterialApp(
        routes: {
          '/register': (context) => const Scaffold(body: Text('Register page')),
        },
        home: NextPage(
          documentApi: fakeApi,
          identityStorage: IdentityStorage(),
          authSession: sessionFor(isAdmin: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Register page'), findsOneWidget);
    expect(await IdentityStorage().load(), isNull);
  });
}
```

Note the cascade parenthesisation in the first test: a cascade section whose value is an arrow function must be wrapped in parentheses when another `..` section follows it, or the arrow body swallows the next section and the file will not compile. The later tests need no parentheses because their cascade is the last one.

If the existing stale-identity test in this file differs in its assertions (for example if it also checks for a snackbar message), keep that file's version of those assertions rather than the ones written above — read the current file before replacing it, and preserve any assertion that is not about the role.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/document_selection_test.dart`
Expected: FAIL — `NextPage` has no `authSession` parameter.

- [ ] **Step 3: Thread `AuthSession` through `NextPage`**

In `flutter_digital_sign/lib/features/next/presentation/pages/next_page.dart`, add an optional `authSession` field and build the real one only when it is absent. Read the file first: it already builds an `AuthSession` inline when constructing its default `HttpDocumentApi`, and that same instance must be the one passed to `NextContent`, so both share one cached token.

```dart
class NextPage extends StatefulWidget {
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;
  final AuthSession? authSession;

  const NextPage({super.key, this.documentApi, this.identityStorage, this.authSession});

  @override
  State<NextPage> createState() => _NextPageState();
}

class _NextPageState extends State<NextPage> {
  late final DocumentApi _documentApi;
  late final IdentityStorage _identityStorage;
  late final AuthSession _authSession;

  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _authSession = widget.authSession ??
        AuthSession(authApi: HttpAuthApi(), identityStorage: _identityStorage);
    _documentApi = widget.documentApi ?? HttpDocumentApi(authSession: _authSession);
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
        authSession: _authSession,
      ),
    );
  }
}
```

- [ ] **Step 4: Gate the control in `NextContent`**

In `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`:

Add the import for `AuthSession`:

```dart
import '../../../../core/auth/auth_session.dart';
```

Add the required field to the widget, alongside the existing `documentApi` and `identityStorage`:

```dart
  final AuthSession authSession;
```
and `required this.authSession,` to its constructor parameter list.

Add this state field beside the existing `_documents` / `_errorMessage` / `_userId`:

```dart
  bool _isAdmin = false;
```

Inside `_loadDocuments`, in the existing `try` block, resolve the role in the same pass as the list so one failure path covers both — replace the two lines that fetch documents and call `setState` with:

```dart
      final admin = await widget.authSession.isAdmin();
      final documents = await widget.documentApi.listDocuments();
      if (!mounted) return;
      setState(() {
        _isAdmin = admin;
        _documents = documents;
        _errorMessage = null;
      });
```

Leave the surrounding `on UnknownIdentityException` and `catch` arms untouched — putting the `isAdmin()` call inside the same `try` means a stale identity surfacing from it lands in the same recovery path.

Finally, make the upload button conditional. In `build`, change the `IconButton` in the header `Row` to:

```dart
              if (_isAdmin)
                IconButton(
                  icon: const Icon(Icons.upload_file),
                  onPressed: _upload,
                ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/document_selection_test.dart`
Expected: PASS — 6 tests.

- [ ] **Step 6: Run the full Flutter suite and analysis**

Run: `flutter test`
Expected: PASS — every test file, including `signing_flow_test.dart`, which constructs `DocumentDetailsPage` directly and is unaffected by these changes.

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 7: Manually verify against the real backend**

Start the backend from the repo root: `npm run dev`.

Confirm the server-side rule directly, which is the one that matters:

```bash
# Alice is the seeded admin; bob is not.
curl -s -o /dev/null -w "no token -> %{http_code}\n" -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" -d '{"title":"x","fileBytes":""}'
```
Expected: `401` (authentication still runs before authorization).

Then run the app (`flutter run -d chrome`, or `-d windows` if the Visual Studio C++ workload has since been installed) and confirm: a freshly registered user sees the document list with **no** upload icon. Then promote them —

```bash
npm run db:promote-admin -- <the email you registered with>
```

— fully restart the app (the role rides in a token cached for up to an hour, so a hot reload will not pick it up) and confirm the upload icon now appears and uploading works.

That restart requirement is expected behaviour, not a defect: it is the staleness trade-off the spec accepted in exchange for not querying the database on every request.

- [ ] **Step 8: Commit**

```bash
git add flutter_digital_sign/lib/features/next/ flutter_digital_sign/test/document_selection_test.dart
git commit -m "feat: hide the upload control from non-admins"
```

---

## Post-plan state

`User` carries an `isAdmin` flag that no HTTP request can set — registration hardcodes `false`, and the only code that grants admin is a repository method reached solely by `npm run db:promote-admin`. The session JWT carries the role, so the upload route authorises from a signature the client cannot forge, and every other endpoint is unchanged: admins and regular users alike still list, read, sign, and verify. The Flutter app hides the upload control from non-admins as a courtesy, while the actual restriction lives entirely on the server.

Sub-project 3 (the admin signature-verification screen) can now assume both a provable identity and a meaningful role.
