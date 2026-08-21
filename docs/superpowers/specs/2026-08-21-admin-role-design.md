# Admin Role and Upload Authorization — Design

## Purpose

SecureDoc Chain currently gives every authenticated user identical capabilities: anyone can upload a document, and anyone can sign one. The intended model is narrower — one administrator supplies the documents, and everyone else signs them.

Sub-project 1 (authentication) made identity provable: callers prove possession of their Ed25519 private key through a challenge–response handshake and carry a JWT whose `sub` claim the server derives `userId` from, rather than accepting it from the request. That is what makes a role restriction worth building. Before it, an "admin-only" rule was a suggestion any client could ignore by naming a different user.

This sub-project adds the role and enforces it on the one endpoint that needs it.

## Scope

**In scope:** an `isAdmin` flag on the domain `User` and the `users` table; an out-of-band promotion script; an `isAdmin` claim on the session JWT; server-side rejection of document upload by non-admins; hiding the upload control in the Flutter app for non-admins.

**Out of scope:** the admin signature-verification screen (sub-project 3); any UI for managing roles; more than two roles; per-document permissions or ownership rules beyond the existing ones; demoting an admin through the API; changing who may list, read, sign, or verify documents.

## Position in the Decomposition

Sub-project 2 of three, agreed during brainstorming:

1. **Authentication** — prove the caller is who they claim. **Complete.**
2. **Admin role + upload authorization** (this spec).
3. **Admin signature-verification screen** — "has this specific user really signed this document?"

## The Role Model

The role is **purely additive**: an admin is a regular user who may additionally upload. Admins list, read, sign, and verify exactly as regular users do, so there is one application experience with one extra control rather than two divergent ones.

There are exactly two roles, represented as a boolean rather than an enum. A boolean is honest about what exists today; introducing a role enum now would be speculative structure for a third role nobody has asked for.

## Bootstrapping: How an Admin Comes to Exist

Registration (`POST /users`) is necessarily public — it is how anyone first obtains an identity — so any admin-granting path reachable from HTTP would be reachable by everyone. Therefore **no request can grant admin**.

`CreateUserUseCase` hardcodes `isAdmin: false`. This is stronger than validating an incoming field and ignoring it: registration never reads a role from its input at all, so there is no field to forget to sanitise later.

Promotion happens out-of-band through a script:

```
npm run db:promote-admin -- alice@example.com
```

It resolves the user through the existing `UserRepository.findByEmail`, sets the flag through a new repository method, and exits with a clear non-zero failure if no user has that email — a silent no-op on a typo'd address would be the worst outcome here, since the operator would believe they had granted access they had not.

That repository method is the only code in the system capable of granting admin, and nothing routes to it from the HTTP layer.

**Consequence accepted:** creating an admin requires database access. That is the point. Anyone who can already reach the database could set the flag by hand anyway, so the script grants no capability that did not already exist; it only makes the existing one convenient and safe to use.

## Where the Role Lives at Request Time

The JWT gains an `isAdmin` claim, issued alongside the existing `sub` and `exp`.

`VerifyChallengeUseCase` already returns the full `User` rather than just an id — sub-project 1 chose that deliberately in anticipation of this — so `/auth/token` reads `user.isAdmin` from a record it already holds. No extra query, no new use case.

The server then authorises from the claim in the token it has already verified, rather than re-reading the user from Postgres on every request.

**Trade-off, accepted:** a promotion or demotion takes effect only when the affected user's token is reissued — within one hour, or immediately if they restart the app. Promotion is a rare, deliberate, operator-initiated act, so bounded staleness costs little; a database read on every protected request would cost more, permanently, to make a rare event instantaneous.

**Fail-closed by construction:** a token issued before this change carries no `isAdmin` claim, so it reads as `false` and its holder is treated as a regular user. The worst case during the changeover is that an admin briefly cannot upload until their token refreshes — never that a regular user can.

## Enforcement

Only `POST /documents` changes. `GET /documents`, `GET /documents/:documentId`, `POST /documents/:documentId/signatures`, and `GET /documents/:documentId/verify` keep their current behaviour for every authenticated user.

The check lives **in the upload route handler, not in middleware**. Hono middleware matches on path, and `POST /documents` shares its path with `GET /documents`; a path-mounted admin guard would also gate the document list and lock regular users out of the one screen they most need. Method-aware mounting would work but hides an important rule in the wiring, where the next person adding a `/documents` route would not see it.

`src/interface-adapters/http/authContext.ts` gains `isAuthenticatedUserAdmin(c): boolean` beside the existing `getAuthenticatedUserId(c)`, reading the claim from the verified payload and treating an absent claim as `false`. The upload handler calls it first and returns `403` in the existing error envelope (`{ error: { type, message } }`) when it is false.

`403` rather than `404`: hiding the endpoint's existence buys nothing here, because every authenticated user can already see the documents it produces.

Authorization is a transport concern, so it stays in the route layer. No new domain error type is introduced, and `UploadDocumentUseCase` is untouched — consistent with sub-project 1, where the JWT middleware likewise returns `401` without involving the domain.

## Flutter Side

`AuthSession` gains `Future<bool> isAdmin()`, which ensures a token exists and decodes its payload — base64url plus `jsonDecode`, using `dart:convert` only, with no signature verification and no new package. `NextContent` hides the upload control when it returns false.

**This is a UI affordance, not a security boundary, and the distinction matters.** A modified client can show itself an upload button; it will receive `403` when it uses it. The app is only declining to offer an action it knows will fail. Every actual restriction is enforced server-side from a signature the client cannot forge.

This creates one testing wrinkle. `FakeAuthApi` currently returns arbitrary strings such as `'fake-token'`, which will not decode. The test helper must mint realistically-shaped unsigned JWTs — `header.payload.signature` with a genuine base64url-encoded JSON payload — so tests exercise the parsing the client really performs rather than a stub that cannot fail the same way.

## Error Handling

- **Non-admin uploads** → `403` with type `ForbiddenError`. Note that `ForbiddenError` here is a literal string in the route's response body, matching the shape `mapDomainErrorToResponse` produces — **not** a new `DomainError` subclass. No domain error type is added, for the reason given under Enforcement: authorization is a transport concern. The Flutter upload path surfaces the server's message in the existing snackbar, which already handles `UploadFailure`.
- **Token predating this change** → treated as non-admin (see fail-closed above).
- **Malformed or absent `isAdmin` claim** → `false`.
- **Promotion script, unknown email** → non-zero exit with a message naming the address.
- Authentication failures are unchanged: still `401` from the existing middleware, still indistinguishable across causes.

## Testing

Following the pattern established across previous sub-projects.

**Backend.** A `CreateUserUseCase` test asserting registration always produces `isAdmin: false`. A `PostgresUserRepository` test for round-tripping the flag and for the promotion method, including the unknown-email case. Integration tests: a non-admin's `POST /documents` returns `403`; an admin's returns `201`; and both roles can still list, read, sign, and verify — the last group matters most, because the likeliest defect in this change is over-restriction rather than under-restriction. One test asserting a token issued for an admin actually carries `isAdmin: true`.

**Flutter.** `AuthSession.isAdmin()` against a token claiming `true`, one claiming `false`, and one carrying no claim at all. A widget test asserting the upload control is absent for a non-admin and present for an admin.

## Global Constraints

- No request can grant admin. `CreateUserUseCase` hardcodes `isAdmin: false`, and promotion exists only as a database-side script.
- Exactly two roles, as a boolean — no role enum.
- The role is additive: admins retain every regular-user capability.
- Only `POST /documents` gains an authorization check; no other endpoint's access rules change.
- Client-side role reading is for UI only and is never relied upon for enforcement.
- No new backend or Flutter dependencies: the JWT claim uses Hono's existing `hono/jwt`, and the client-side decode uses `dart:convert`.
- Domain and use-case layers stay transport-agnostic. Authorization lives in the route layer; `UploadDocumentUseCase` is unchanged.
- The JWT's existing claims (`sub`, `exp`) and the sub-project 1 handshake — including the `SecureDocChain-auth-challenge-v1` domain separation — are unchanged.
