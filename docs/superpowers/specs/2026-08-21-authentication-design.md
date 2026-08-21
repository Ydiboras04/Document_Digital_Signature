# Authentication (Challenge–Response with Ed25519, JWT Sessions) — Design

## Purpose

SecureDoc Chain currently has no authentication of any kind. Every endpoint trusts a client-supplied `userId` — sent in a request body (`POST /documents`, `POST /documents/:documentId/signatures`) or a query string (`GET /documents`, `GET /documents/:documentId`). Any caller can act as any user simply by naming them.

This has been an accepted constraint until now. It stops being acceptable the moment roles are introduced: the planned admin role (admin-only document upload, admin-only signature verification) is a privilege boundary, and a privilege boundary that a client can cross by editing a JSON field is decoration rather than security.

This sub-project makes identity provable. It introduces no passwords: every registered user already holds an Ed25519 private key in device secure storage, generated during registration and never transmitted. That key is a stronger credential than a password, and this design uses it directly.

## Scope

**In scope:** a challenge–response handshake proving possession of the private key; short-lived JWT session tokens; JWT verification middleware on the backend; removal of client-supplied `userId` from every endpoint that currently accepts one; a Flutter `AuthApi` + `AuthSession` with transparent re-authentication; recovery handling for a device holding an identity the server no longer knows.

**Out of scope (separate, later sub-projects):** the admin role itself and any role-based authorization (sub-project 2 — this design deliberately puts no role claim in the JWT); the admin signature-verification screen (sub-project 3); token revocation; refresh tokens; rate limiting; multi-device support for a single user.

## Position in the Decomposition

This is sub-project 1 of three, agreed during brainstorming:

1. **Authentication** (this spec) — prove the caller is who they claim.
2. **Admin role + authorization** — add the role to the domain, restrict upload to admins, hide it in the UI.
3. **Admin signature-verification screen** — "has this specific user really signed this document?"

Sub-projects 2 and 3 depend on this one. Building 3 first would produce UI-only gating, which was explicitly considered and rejected.

## The Handshake

Two new public endpoints, mounted in a new `src/interface-adapters/http/routes/auth.ts` following the existing route-module pattern.

### `POST /auth/challenge`

Request: `{ "userId": string }`. Response `200`: `{ "challenge": string }` (base64).

The server generates a cryptographically random **32-byte** nonce, stores it keyed by `userId` with a 2-minute TTL, and returns it.

The 32-byte width is deliberate and load-bearing: the existing `Hash` value object accepts exactly 32 bytes, and the existing `CryptoProvider.verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes)` port therefore verifies a 32-byte challenge with no changes whatsoever. No new crypto port, no new value object, and the same `Ed25519CryptoProvider` already used for document signatures.

If `userId` is missing or not a string, `400`. If no such user exists, `404` with `UserNotFoundError` via the existing `mapDomainErrorToResponse`.

Challenges live in an in-memory store (a `Map<string, {challenge: Uint8Array, expiresAt: Date}>` behind a `ChallengeStore` port, so tests use a fake and the production adapter is a plain in-memory implementation). Losing them on server restart is harmless: they are 2-minute-lived and a client simply requests a fresh one.

### `POST /auth/token`

Request: `{ "userId": string, "signature": string }` (base64, 64 bytes). Response `200`: `{ "token": string }`.

The server looks up the pending challenge for `userId`, **deletes it immediately** (single-use, whether verification then succeeds or fails, so a captured signature cannot be replayed), and verifies the signature against the user's stored public key via `CryptoProvider.verify`.

On success it issues a JWT with payload `{ sub: userId, exp: <now + 1 hour> }`, signed HS256 with `JWT_SECRET` read from `.env`, using Hono's built-in `sign` helper from `hono/jwt` (Hono 4.13.1 — no new dependency).

Failure cases: no pending challenge or expired → `401`; signature does not verify → `401`; unknown user → `404`; malformed body → `400`. The `401` responses deliberately do not distinguish "no challenge" from "bad signature".

### `JWT_SECRET`

A new required environment variable in `.env` (which is gitignored). The server must fail fast at startup with a clear message if it is absent, rather than signing tokens with `undefined`.

## What Becomes Protected

Public: `GET /health`, `POST /users` (registration — necessarily public, it is how a user first obtains an identity), `POST /auth/challenge`, `POST /auth/token`.

Protected by JWT middleware: `GET /documents`, `GET /documents/:documentId`, `POST /documents`, `POST /documents/:documentId/signatures`, `GET /documents/:documentId/verify`.

Middleware uses Hono's `jwt({ secret })` from `hono/jwt`, which rejects absent/malformed/expired tokens with `401` before the handler runs, and exposes the verified payload via `c.get('jwtPayload')`. A thin helper (`getAuthenticatedUserId(c)`) reads `sub` from it so handlers do not each reach into the payload shape.

## Removing Client-Supplied `userId`

This is the change that turns authentication into enforcement. Once the token proves identity, accepting `userId` from the client would leave the old impersonation path wide open beside the new secure one.

| Endpoint | Before | After |
|---|---|---|
| `GET /documents` | `?userId=X` | no parameter; `userId` from token |
| `GET /documents/:documentId` | `?userId=X` | no parameter; `userId` from token |
| `POST /documents` | body `{title, uploaderId, fileBytes}` | body `{title, fileBytes}`; `uploaderId` from token |
| `POST /documents/:documentId/signatures` | body `{userId, signatureBytes}` | body `{signatureBytes}`; `userId` from token |

The use cases beneath (`ListDocumentsUseCase`, `GetDocumentUseCase`, `UploadDocumentUseCase`, `SignDocumentUseCase`) keep their current input shapes — they still receive a `userId`/`uploaderId` field. Only the route layer changes, sourcing that value from the token instead of the request. This keeps the domain and use-case layers unaware of transport concerns, consistent with the existing architecture, and means their unit tests need no changes.

The integration tests for these endpoints do change: each must now obtain a real token first. A shared test helper (`authTokenFor(userId)`) performs the real handshake against the app using the existing `ed25519TestKeys` fixtures, so integration tests exercise the genuine flow rather than minting tokens behind the server's back.

## Flutter Side

### `AuthApi`

New `lib/core/network/auth_api.dart`, mirroring the established `UserApi`/`DocumentApi` pattern exactly (abstract port, `HttpAuthApi` real implementation with injectable `http.Client`, `FakeAuthApi` test double under `test/`):

```dart
abstract class AuthApi {
  Future<List<int>> requestChallenge(String userId);
  Future<String> exchangeForToken(String userId, List<int> signature);
}
```

### `AuthSession`

New `lib/core/auth/auth_session.dart` owning the handshake and the cached token:

```dart
Future<String> token();  // returns cached token, or performs the handshake
void invalidate();       // drops the cached token
```

On a cache miss, `token()` reads `userId` and `privateKeyBytes` from the existing `IdentityStorage`, requests a challenge, signs it with the existing `Ed25519KeyPair.sign(...)`, exchanges it for a JWT, caches it in memory, and returns it.

**Amendment (domain separation).** The client does not sign the raw challenge. It signs `sha256(utf8("SecureDocChain-auth-challenge-v1") + challenge)`, and the server verifies over the identical digest. Without this, an auth signature and a document signature are indistinguishable — both are a 64-byte Ed25519 signature over 32 bytes made by the same key — so a hostile `POST /auth/challenge` response could serve a document's `signingPayload` as the "challenge" and harvest a chain-valid document signature from a user who never consented. The defence has to be client-side, because the client cannot tell an honest challenge from a malicious one. The 32-byte width of the nonce is still load-bearing in the sense the section below describes: the signed message remains a 32-byte `Hash`, produced by the existing `CryptoProvider.hash`, so `CryptoProvider.verify` is still used unchanged. Auth digests are `sha256` over `32 + 32` bytes with a fixed non-numeric prefix, and document payloads are `sha256` over 32 or 64 bytes, so the two can never collide.

The token is held **in memory only** — deliberately not written to `IdentityStorage`. Re-authenticating costs one round trip and requires no user interaction, so persisting a bearer token would add attack surface and buy nothing. The cost is a single silent handshake per app launch.

### Token attachment and retry

`HttpDocumentApi` gains an `AuthSession` dependency. Each method obtains a token, sends it as `Authorization: Bearer <token>`, and on a `401` calls `invalidate()` and retries the request exactly once. A second `401` surfaces as a failure. This one-retry rule is what makes the 1-hour expiry invisible.

A rejected alternative, recorded so it is not revisited: wrapping this in an `http.BaseClient` subclass so `HttpDocumentApi` would need no changes at all. It was rejected because retrying requires re-sending the request body, and streamed request bodies can only be consumed once; explicit retry inside the API methods is less elegant but correct and directly testable.

`DocumentApi`'s method signatures also lose their now-redundant `userId` parameters, matching the endpoint changes above: `listDocuments()`, `getDocument(documentId)`, `uploadDocument(title, fileBytes)`, `submitSignature(documentId, signatureBytes)`. Callers (`NextContent`, `DocumentDetailsPage`) simplify accordingly — they no longer need to read `userId` from `IdentityStorage` purely to pass it to the API, though `NextContent` still loads the identity to detect its absence.

### Stale-identity recovery

A device can hold an identity the server no longer recognises — the clearest case being a wiped or rebuilt database while `IdentityStorage` still holds the old `userId`. `POST /auth/challenge` then returns `404`, and because that private key can never be re-associated with a server-side account, the only recovery is to discard it.

`AuthSession` surfaces this as a distinct, typed failure rather than a generic error. `IdentityStorage` gains a `clear()` method, and the UI, on encountering that specific failure, clears the stored identity and routes the user back to registration with an explanatory message. Treating this as a generic network error would strand the user in a permanently broken app with no path forward.

## Error Handling Summary

- **Missing/expired/invalid token on a protected endpoint** → `401` from middleware; the Flutter client retries once after re-authenticating, then surfaces the failure inline.
- **Challenge expired or absent at `/auth/token`** → `401`; the client requests a fresh challenge on its next attempt.
- **Signature does not verify** → `401`, indistinguishable from an expired challenge.
- **Unknown user at `/auth/challenge`** → `404`, handled by the client as stale-identity recovery (clear identity, return to registration).
- **`JWT_SECRET` absent at startup** → the server refuses to start, with a message naming the variable.

## Testing

Following the pattern established across the previous sub-projects.

**Backend.** Unit tests for the challenge-issuing and token-issuing use cases against a fake `ChallengeStore`, a `FakeUserRepository`, and the existing `FakeCryptoProvider` — covering success, unknown user, expired challenge, wrong signature, and the replay case (a nonce used twice must fail the second time). Integration tests against real Postgres for both `/auth/*` endpoints using the real `Ed25519CryptoProvider` and existing `ed25519TestKeys` fixtures, plus, for each protected endpoint, a test that it rejects a request with no token and one that it succeeds with a genuine token from a real handshake.

**Flutter.** `MockClient` tests for `HttpAuthApi`'s two calls. `AuthSession` tests against `FakeAuthApi` covering the cache hit path, the handshake path, `invalidate()` forcing a fresh handshake, and the stale-identity `404`. `MockClient` tests for `HttpDocumentApi` asserting the Bearer header is attached and that a `401` triggers exactly one retry (not zero, not a loop). Existing widget tests update to the new `DocumentApi` signatures.

## Global Constraints

- No passwords anywhere. The Ed25519 private key generated at registration remains the sole credential.
- No new backend dependencies: Hono 4.13.1's built-in `hono/jwt` provides both `sign` and the verification middleware.
- No new Flutter dependencies: `AuthSession` composes the existing `http`, `cryptography`, and `flutter_secure_storage` packages.
- The challenge is exactly 32 bytes so the existing `Hash` value object and `CryptoProvider.verify` port are reused unchanged.
- `JWT_SECRET` lives in `.env`, which is gitignored and must never be committed.
- Domain and use-case layers stay transport-agnostic: only the route layer learns about tokens.
