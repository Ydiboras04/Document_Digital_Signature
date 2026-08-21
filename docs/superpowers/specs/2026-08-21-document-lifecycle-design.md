# Real Document Lifecycle (Upload, List, Sign, Read-Only) — Design

## Purpose

The Flutter app's document list, details, and signing screens are currently static mockups: hardcoded document names, fake owner/hash/status text, and no backend calls. This design replaces them with a real end-to-end flow — upload a real file, list real documents from Postgres, sign with the user's real on-device Ed25519 private key, and verify against the backend's existing signature-chain logic — while fixing two related UX problems:

1. After signing, "Back to Documents" currently does `Navigator.popUntil(isFirst)`, which lands on the Welcome screen (which then auto-redirects back to the document list) instead of returning directly.
2. There's no way for the app to know "has the current user already signed this document" — so a user can currently attempt to re-sign a document they've already signed (blocked server-side by `DuplicateSignatureError`, but with no supporting read-only UI).

## Scope

**In scope:** real document upload, real document list (with per-document "signed by me" state), real document detail view, real signing against the backend's existing signature-chain crypto, corrected post-sign navigation.

**Out of scope (future sub-projects):** document verification UI (the `GET /documents/:id/verify` endpoint already exists and is unused by any planned screen here — it's superseded for this scope by the new detail endpoint, but a dedicated "verify this document's whole chain" screen is not part of this plan), multi-user document sharing/notifications, "Login" for returning users (explicitly dropped from scope in brainstorming — there is no password/OTP auth in this system; identity is a private key that lives only on the device that generated it during registration and cannot be recovered elsewhere).

## Backend Additions

The backend already has `POST /documents` (upload) and `POST /documents/:id/signatures` (sign) and enforces per-user duplicate-signature prevention (`DuplicateSignatureError`) and signature chaining (`SignatureChainService`) at the domain level. Two read endpoints are missing and get added, following the existing use-case/route pattern (`src/use-cases/<name>/`, `src/interface-adapters/http/routes/documents.ts`):

### `DocumentRepository.findAll()`

New port method added to `src/use-cases/ports/DocumentRepository.ts`:
```ts
export interface DocumentRepository {
  save(document: Document): Promise<void>
  findById(id: string): Promise<Document | null>
  findAll(): Promise<Document[]>
}
```
Implemented in both `FakeDocumentRepository` (in-memory, for tests) and `PostgresDocumentRepository` (a plain `SELECT * FROM documents`).

### `GET /documents?userId=<id>`

New `ListDocumentsUseCase` (`src/use-cases/list-documents/ListDocumentsUseCase.ts`), constructed from `DocumentRepository` and `SignatureRepository`. For each document, it fetches that document's signatures and computes `signedByUser = signatures.some(s => s.userId === input.userId)`.

Input: `{ userId: string }`. Output: `Result<DocumentSummary[], never>` where:
```ts
interface DocumentSummary {
  id: string
  title: string
  uploaderId: string
  signedByUser: boolean
}
```

Route: `documents.get('/documents', ...)` — reads `userId` from the query string (`c.req.query('userId')`), 400s if missing, otherwise calls the use case and returns `200` with the JSON array.

### `GET /documents/:documentId?userId=<id>`

New `GetDocumentUseCase` (`src/use-cases/get-document/GetDocumentUseCase.ts`), constructed from `DocumentRepository`, `SignatureRepository`, and `SignatureChainService` (the same three dependencies `SignDocumentUseCase` already uses for the chain logic, minus `CryptoProvider`/`IdGenerator`/`Clock`/`UserRepository` since this use case never writes anything or verifies a supplied signature — it only computes what the *next* signature's payload would be).

Input: `{ documentId: string, userId: string }`. Output: `Result<DocumentDetail, DocumentNotFoundError>` where:
```ts
interface DocumentDetail {
  id: string
  title: string
  uploaderId: string
  signatures: Array<{ userId: string; signedAt: Date }>
  signedByUser: boolean
  signingPayload: string | null // base64, null when signedByUser is true
}
```

Logic: load the document (404 if missing), load its signatures, compute `signedByUser` the same way as the list use case. If `signedByUser` is `false`, compute `signingPayload` via the existing `SignatureChainService.buildSigningPayload(document, signatureChainService.findTip(signatures))` — the exact same call `SignDocumentUseCase` already makes before verifying a submitted signature — and base64-encode the resulting `Hash`'s bytes. If `signedByUser` is `true`, `signingPayload` is `null` (nothing left to sign).

This is the key design choice: **the Flutter client never reimplements the SHA-256 chain-hashing logic.** It only ever signs bytes the server hands it, using the same `SignatureChainService` method the server already uses internally to verify. This keeps the chaining logic in exactly one place and eliminates any risk of the two codebases' hash computations silently drifting apart.

Route: `documents.get('/documents/:documentId', ...)` — reads `userId` from the query string, 400s if missing, 404s via the existing `mapDomainErrorToResponse` if the use case returns `DocumentNotFoundError`, otherwise `200` with the JSON body.

### Composition root

`src/infrastructure/composition.ts` gains `listDocumentsUseCase` and `getDocumentUseCase` on the `Dependencies` interface, wired the same way `signDocumentUseCase`/`verifyDocumentUseCase` already are.

## Flutter Additions

### `DocumentApi` (port), mirroring `UserApi`

New file `lib/core/network/document_api.dart`:
```dart
class DocumentSummary {
  final String id;
  final String title;
  final String uploaderId;
  final bool signedByUser;
}

class DocumentDetail {
  final String id;
  final String title;
  final String uploaderId;
  final List<({String userId, DateTime signedAt})> signatures;
  final bool signedByUser;
  final List<int>? signingPayload; // null when signedByUser is true
}

sealed class UploadResult {}
class UploadSuccess extends UploadResult { final String documentId; }
class UploadFailure extends UploadResult { final String message; }

sealed class SignResult {}
class SignSuccess extends SignResult {}
class SignFailure extends SignResult { final String message; }

abstract class DocumentApi {
  Future<List<DocumentSummary>> listDocuments(String userId);
  Future<DocumentDetail> getDocument(String documentId, String userId);
  Future<UploadResult> uploadDocument(String title, String uploaderId, List<int> fileBytes);
  Future<SignResult> submitSignature(String documentId, String userId, List<int> signatureBytes);
}
```
`HttpDocumentApi` implements this against the real backend (same `base64Encode`/`jsonDecode` conventions as `HttpUserApi`). `FakeDocumentApi` (test helper under `test/core/network/`, not `lib/`) implements it as an in-memory double, following the existing `FakeUserApi` pattern (records calls, configurable via callback overrides).

### File picking

`file_picker: ^8.1.0` (or latest compatible) is added to `pubspec.yaml` for the upload flow — the only new external dependency this sub-project introduces.

### Screen changes

- **`NextPage`**: becomes stateful with real data. On `initState`, loads the current `userId` via `IdentityStorage().load()` (if null — meaning no identity, which shouldn't be reachable given Welcome's existing guard — falls back to redirecting to Welcome), then calls `DocumentApi.listDocuments(userId)`. Shows a loading spinner, then the list; each row shows a lock icon and "Signed" label when `signedByUser` is true. A `FloatingActionButton` opens `file_picker`, prompts for a title (a simple text-entry dialog), calls `uploadDocument`, and refreshes the list on success. Tapping a row calls `Navigator.pushNamed(context, AppRoutes.documentDetails, arguments: {'documentId': document.id})` and refreshes the list when that navigation returns (in case the user signed and came back), via `.then((_) => _loadDocuments())`.
- **`DocumentDetailsPage`**: constructor takes `documentId` (was `documentName`). On `initState`, loads `userId` from `IdentityStorage`, calls `DocumentApi.getDocument(documentId, userId)`. If `signedByUser` is `true`: renders a read-only view (title, uploader, list of who's signed and when — no button). If `false`: renders the existing "Confirm Signature" button; on tap, it loads the stored private key seed via `IdentityStorage`, reconstructs the keypair with `Ed25519().newKeyPairFromSeed(seed)` (verified against the installed `cryptography` package source — this is the standard way to rehydrate a `SimpleKeyPair` from a stored 32-byte seed), signs `detail.signingPayload!` with `Ed25519().sign(payload, keyPair: keyPair)`, and calls `DocumentApi.submitSignature(documentId, userId, signature.bytes)`. On success, navigates to `SigningConfirmationPage` (by name, passing `documentId`); on failure, shows the error inline (same pattern as `RegisterForm`'s `_errorMessage`).
- **`SigningConfirmationPage`**: unchanged visually. "Back to Documents" changes from `Navigator.popUntil(context, (route) => route.isFirst)` to `Navigator.popUntil(context, ModalRoute.withName(AppRoutes.next))` — this is the fix for the reported navigation bug. This only works because `NextPage`, `DocumentDetailsPage`, and `SigningConfirmationPage` are now all reached via `pushNamed` (previously they were pushed with raw `MaterialPageRoute`, making their route names unavailable to `popUntil`/`ModalRoute.withName`).

### `app_routes.dart`

The existing (currently dead) `documentDetails`/`signingConfirmation` cases change their expected argument key from `'documentName'` to `'documentId'`, and both `NextPage` calls in `generateRoute`/`routes` stay as-is otherwise. `NextPage` itself starts being reached via `pushNamed`/`pushReplacementNamed` consistently (it already is, from Welcome and from `RegisterForm`).

## Error Handling

- **Upload failure** (network error, validation error from backend): shown as a `SnackBar` on `NextPage`, list is not modified.
- **List load failure**: `NextPage` shows an inline error message with a "Retry" button instead of the list.
- **Detail load failure** (e.g. document was deleted, 404): `DocumentDetailsPage` shows an inline error message; no sign button.
- **Sign failure** (e.g. `DuplicateSignatureError` if a race let two taps through, or a network error): shown inline on `DocumentDetailsPage`, same as the registration form's error pattern — the page does not navigate away.

## Testing

Same TDD pattern established for registration:

- **Backend**: `ListDocumentsUseCase.test.ts` and `GetDocumentUseCase.test.ts`, using `FakeDocumentRepository`/`FakeSignatureRepository`, following the existing style of `SignDocumentUseCase.test.ts`/`VerifyDocumentUseCase.test.ts`. Integration test additions to `documents.integration.test.ts` (if it exists) or a new one, covering the two new routes against a real Postgres instance — matching the existing integration-test pattern used for the other document/user routes.
- **Flutter**:
  - `test/core/network/http_document_api_test.dart` — `MockClient`-based tests for `HttpDocumentApi`, mirroring `http_user_api_test.dart`.
  - `test/core/network/fake_document_api.dart` — test helper, no tests of its own, mirroring `fake_user_api.dart`.
  - `test/features/next/...` (or wherever the rewritten list/detail/confirmation widget tests land) replace `document_selection_test.dart`/`signing_flow_test.dart`, since those currently assert on hardcoded mock text (`'Contract_Proposal.pdf'`, etc.) that won't exist once the list is real. New tests use `FakeDocumentApi` + `FlutterSecureStorage.setMockInitialValues` (for `IdentityStorage`), following the exact pattern established in `register_form_test.dart`.

## Global Constraints (carried from the existing project)

- No password/auth mechanism anywhere — this sub-project does not add one. Identity remains "whatever private key is stored in `IdentityStorage` on this device."
- Windows desktop is the target platform; `file_picker` must support Windows desktop (it does).
- Exact package APIs (`Ed25519().newKeyPairFromSeed`, `Ed25519().sign`) are verified against the installed `cryptography` 2.9.0 source before the implementation plan is written, not guessed.
