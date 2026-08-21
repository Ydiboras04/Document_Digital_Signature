# Admin Signature-Verification Screen — Design

## Purpose

An administrator needs to answer one question about a document: *did this person really sign it?*

The system can already answer it. `GET /documents/:documentId/verify` re-runs the full Ed25519 signature-chain verification — every signature is checked against its signer's stored public key, and the chain links are checked for tampering — but nothing in the app surfaces that, and the endpoint returns raw `userId` UUIDs rather than names.

This sub-project surfaces it, resolves the identities, and restricts it to administrators.

The distinction it makes visible is the point of the whole product. "The database has a signature row for alice" and "alice's signature cryptographically verifies against alice's public key" are different claims, and only the second one means anything. Until now the app has only ever shown the first.

## Scope

**In scope:** enriching the verify response with usernames and emails; restricting the verify endpoint to admins; a `VerificationPage` in the Flutter app reachable from the document details screen; relabelling the details page's existing signature count so it cannot be confused with a verified count.

**Out of scope:** verifying a single named user in isolation (the screen shows all verified signers and the admin reads off the one they care about — considered and rejected during brainstorming as strictly less informative); any UI for managing roles; exporting or printing verification results; re-verifying automatically on a schedule; changing who may list, read, upload, or sign.

## Position in the Decomposition

Sub-project 3 of three, and the one the other two existed to make possible:

1. **Authentication** — prove the caller is who they claim. **Complete.**
2. **Admin role + upload authorization** — a role the server can enforce. **Complete.**
3. **Admin signature-verification screen** (this spec).

## Access: Admin Only

`GET /documents/:documentId/verify` becomes admin-only, using the same `isAuthenticatedUserAdmin(c)` check the upload route already uses, returning `403` in the existing `{ error: { type, message } }` envelope with the literal type `ForbiddenError`. As before, no new `DomainError` subclass — authorization is a transport concern.

The check lives **in the handler, not in middleware**, for the same reason as the upload route: Hono matches middleware on path, and this path shares its prefix with routes regular users need.

**Why restrict it now, when sub-project 2 deliberately left it open:** enriching the response with usernames and emails changes what leaking it costs. Today the endpoint returns opaque UUIDs; after this change it returns a roster of real email addresses. Leaving it open would hand every registered user a way to enumerate everyone else's contact details. The restriction is not merely "the admin asked for an admin feature" — it is what keeps a new disclosure contained.

Regular users lose nothing they currently have in the app: no screen consumes this endpoint today.

## The Enriched Response

`VerifyDocumentUseCase` already loads each signer's full `User` — it fetches them to obtain `publicKey` for the chain check and then discards everything else. Enrichment therefore costs no extra query.

Its return type changes from `Result<Signature[], VerifyDocumentError>` to `Result<VerifiedSignatureDto[], VerifyDocumentError>`, where:

```ts
interface VerifiedSignatureDto {
  userId: string
  username: string
  email: string
  signedAt: Date
}
```

The route serializes that instead of calling `toSignatureJson`, which also drops `signatureData` from the response. The UI has no use for the raw signature bytes, and there is no reason to ship them.

Success stays `200 { valid: true, signatures: [...] }`. A chain that fails verification stays `200 { valid: false, reason: string }` — unchanged, because that is not an error in the HTTP sense; the endpoint successfully determined that the document does not verify. A missing document stays `404`.

Only signatures that **actually verified** appear in the list. That is already true of the existing use case — it returns the ordered chain only after `verifyChain` succeeds — and it is the property the screen depends on.

## Flutter Side

### `DocumentApi.verifyDocument`

Added to the existing port, with the usual real/fake pair:

```dart
sealed class VerificationResult {}
class VerificationValid extends VerificationResult {
  final List<VerifiedSigner> signers;
}
class VerificationInvalid extends VerificationResult {
  final String reason;
}

class VerifiedSigner {
  final String userId;
  final String username;
  final String email;
  final DateTime signedAt;
}
```

`verifyDocument(String documentId) -> Future<VerificationResult>` maps `valid: true` to `VerificationValid` and `valid: false` to `VerificationInvalid`, following the sealed-result convention already used by `UploadResult` and `SignResult`.

### `VerificationPage`

Three states:

- **Verified, with signers** — a green header and a list, each entry showing username, email, and signing time: `alice — alice@example.com — signed 21 Aug 2026 07:08`.
- **Verified, no signers** — the document is intact but nobody has signed it yet. Distinct from failure, and must not be rendered as one.
- **Failed** — a red header and the server's `reason` verbatim.

The header wording says **"cryptographically verified"** explicitly rather than just "signatures", for the reason in the next section.

### Reaching it, and the honesty fix

A **"Verify signatures"** button on `DocumentDetailsPage`, shown only when `AuthSession.isAdmin()` is true. That requires threading `AuthSession` into `DocumentDetailsPage`, exactly as sub-project 2 threaded it into `NextContent`. The same hazard applies: `signing_flow_test.dart` constructs `DocumentDetailsPage` directly, so those tests must supply a fake-backed session or they will attempt live network calls inside `flutter test`.

As with the upload control, hiding the button is a **UI affordance, not a boundary** — a modified client can show it and will receive `403`.

`DocumentDetailsPage` currently displays `Signatures: N`, sourced from `GET /documents/:id` — that is a count of **database rows**. The verification screen lists only signatures that cryptographically verified. Those numbers are normally equal, and the case where they diverge is precisely what this feature exists to catch. Two similar-looking numbers with no distinguishing label would actively mislead in exactly the situation that matters most, so the details page's label becomes **"Signatures on record"**.

## Error Handling

- **Non-admin calls verify** → `403`; the button is not shown to them, and the Flutter client surfaces the server's message rather than presenting it as a verification failure. A permissions problem and a forged signature must never look alike.
- **Document not found** → `404`, surfaced as an inline error.
- **Chain fails verification** → `200 { valid: false, reason }`, rendered as the failed state with the reason shown verbatim.
- **Network failure** → an inline error with a Retry affordance, consistent with the document list's existing treatment.
- **Stale identity (`UnknownIdentityException`)** → the existing recovery path: clear the stored identity and route to registration.

## Testing

**Backend.** `VerifyDocumentUseCase` unit tests asserting the enriched fields come from the real `User` records. Integration tests: an admin gets `200` with resolved usernames and emails; a non-admin gets `403`; a missing document gets `404`.

And the assertion this whole feature rests on: **an integration test that writes a signature row with garbage bytes directly through the repository and asserts `verify` returns `valid: false`.** Nothing currently tests that. Without it, an endpoint quietly reduced to a database read would pass every other test in the suite while silently reporting forged signatures as genuine — which is the one failure this product cannot tolerate.

**Flutter.** `MockClient` tests for `verifyDocument` parsing both response shapes. Widget tests for all three `VerificationPage` states, and for the button being absent for a non-admin and present for an admin.

## Global Constraints

- Only `GET /documents/:documentId/verify` changes its access rules. `GET /documents`, `GET /documents/:documentId`, `POST /documents`, and `POST /documents/:documentId/signatures` keep their current behaviour.
- `ForbiddenError` is a literal string in the route's 403 body matching the existing envelope — not a new `DomainError` subclass.
- Client-side role reading remains UI only and is never an enforcement point.
- Only signatures that cryptographically verified are ever displayed as verified.
- A permissions failure, a missing document, and a failed verification are three visually distinct outcomes in the UI.
- No new backend or Flutter dependencies.
- Domain and use-case layers stay transport-agnostic; authorization lives in the route layer.
- The sub-project 1 handshake (including the `SecureDocChain-auth-challenge-v1` domain separation) and the sub-project 2 role model are unchanged.
