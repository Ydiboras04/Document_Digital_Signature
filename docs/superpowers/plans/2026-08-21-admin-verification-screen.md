# Admin Signature-Verification Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give administrators a screen that shows, by name, which signatures on a document actually verify cryptographically — as distinct from which signature rows merely exist in the database.

**Architecture:** `VerifyDocumentUseCase` already loads each signer's full `User` to obtain their public key and then discards the rest, so enriching its output with usernames and emails costs no extra query — its return type changes from `Signature[]` to `VerifiedSignatureDto[]`. The verify route gains the same handler-level admin check the upload route uses. On the Flutter side a new `VerificationPage` renders three visually distinct outcomes, reached from an admin-only button on the document details page.

**Tech Stack:** Existing stack only. Backend: Hono, Drizzle/Postgres, Vitest. Flutter: existing `http` and `dart:convert`. No new dependencies on either side.

**Spec:** `docs/superpowers/specs/2026-08-21-admin-verification-screen-design.md`

## Global Constraints

- Only `GET /documents/:documentId/verify` changes its access rules. `GET /documents`, `GET /documents/:documentId`, `POST /documents`, and `POST /documents/:documentId/signatures` keep their current behaviour.
- `ForbiddenError` is a **literal string** in the route's 403 body matching the existing `{ error: { type, message } }` envelope — **not** a new `DomainError` subclass. Authorization is a transport concern.
- The admin check goes in the **handler, not middleware** — Hono matches middleware on path, and this path shares its prefix with routes regular users need.
- Client-side role reading remains **UI only** and is never an enforcement point. A modified client can show the button and will receive `403`.
- Only signatures that **cryptographically verified** are ever displayed as verified.
- A permissions failure, a missing document, and a failed verification are **three visually distinct outcomes** in the UI — they must never be rendered alike.
- `{ valid: false, reason }` stays a `200`: the endpoint successfully determined the document does not verify. That is not an HTTP error.
- No new backend or Flutter dependencies.
- Domain and use-case layers stay transport-agnostic.
- The sub-project 1 handshake (including `SecureDocChain-auth-challenge-v1` domain separation) and the sub-project 2 role model are unchanged.

---

### Task 1: `VerifyDocumentUseCase` returns named signers

**Files:**
- Modify: `src/use-cases/verify-document/VerifyDocumentUseCase.ts`
- Test: `src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`

**Interfaces:**
- Consumes: `UserRepository.findById` (existing), `SignatureChainService.orderChain`/`verifyChain` (existing), `User.username`/`.email` (existing).
- Produces: `VerifiedSignatureDto` = `{ userId: string, username: string, email: string, signedAt: Date }`, and `VerifyDocumentUseCase.execute` returning `Promise<Result<VerifiedSignatureDto[], VerifyDocumentError>>`. Task 2's route depends on this shape.

The use case already loads the full `User` for every signer and keeps only `publicKey`. This task keeps the `User` too. No new query, no new port method.

- [ ] **Step 1: Update the one assertion that reads a `Signature` field, and add the enrichment test**

In `src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`, the first test (`verifies a valid multi-signer chain and returns it in order`) ends with an assertion on `s.id`, which the DTO does not carry. Change that single line from:

```ts
    expect(result.value.map((s) => s.id)).toEqual(['sig-1', 'sig-2'])
```

to:

```ts
    expect(result.value.map((s) => s.userId)).toEqual(['user-1', 'user-2'])
```

Chain order is still what is being asserted — `user-1` signed first — it is just read off a field the DTO has.

Every other test in the file is unaffected: the empty-chain test asserts `toEqual([])`, and the `DocumentNotFoundError`, `UserNotFoundError`, and tampered-signature tests all assert on failures. Leave them exactly as they are.

Then add this new test inside the existing `describe('VerifyDocumentUseCase', ...)` block:

```ts
  it('resolves each verified signature to the signer name and email', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const user = aUser('user-1', 1)
    userRepository.users.push(user)

    const message = crypto.hash(document.originalHash.toBytes())
    const signedAt = new Date('2026-08-10T00:00:00Z')
    signatureRepository.savedSignatures.push(
      Signature.create({
        id: 'sig-1',
        documentId: document.id,
        userId: user.id,
        previousSignatureId: null,
        signatureData: crypto.sign(user.publicKey, message),
        signedAt
      }).value
    )

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([
      {
        userId: 'user-1',
        username: user.username,
        email: user.email,
        signedAt
      }
    ])
  })
```

Asserting against `user.username`/`user.email` rather than hardcoded strings ties the assertion to the actual `User` record, so it proves the values were resolved from the repository rather than fabricated.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`
Expected: FAIL on the new test — `execute` still returns `Signature[]`, whose entries carry `id`, `documentId`, `previousSignatureId`, and `signatureData`, so they will not `toEqual` the four-field DTO shape.

(The changed assertion in the first test will still *pass* at this point, because `Signature` also has a `userId` field. That is expected: it is being changed for forward compatibility with the DTO, not because it currently fails.)

- [ ] **Step 3: Return the enriched DTO**

In `src/use-cases/verify-document/VerifyDocumentUseCase.ts`:

Add the DTO interface after the existing `VerifyDocumentInput` interface:

```ts
export interface VerifiedSignatureDto {
  userId: string
  username: string
  email: string
  signedAt: Date
}
```

Add `User` to the imports:

```ts
import { User } from '../../domain/entities/User.js'
```

Change the method signature from `Promise<Result<Signature[], VerifyDocumentError>>` to:

```ts
  async execute(input: VerifyDocumentInput): Promise<Result<VerifiedSignatureDto[], VerifyDocumentError>> {
```

Replace the signer-loading loop so it retains the whole `User` alongside the public-key map the chain check needs:

```ts
    const usersById = new Map<string, User>()
    const publicKeysByUserId = new Map<string, PublicKey>()
    const uniqueUserIds = [...new Set(orderedSignatures.map((s) => s.userId))]
    for (const userId of uniqueUserIds) {
      const user = await this.userRepository.findById(userId)
      if (user === null) {
        return Result.fail(new UserNotFoundError(userId))
      }
      usersById.set(userId, user)
      publicKeysByUserId.set(userId, user.publicKey)
    }
```

And replace the final `return Result.ok(orderedSignatures)` with:

```ts
    // Reached only after verifyChain succeeded, so every entry here is a
    // signature that actually verified against its signer's public key --
    // which is the whole claim the verification screen makes.
    return Result.ok(
      orderedSignatures.map((signature) => {
        const user = usersById.get(signature.userId)!
        return {
          userId: signature.userId,
          username: user.username,
          email: user.email,
          signedAt: signature.signedAt
        }
      })
    )
```

If the `Signature` import becomes unused after this change, remove it; if it is still referenced, leave it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/use-cases/verify-document/VerifyDocumentUseCase.test.ts`
Expected: PASS — all pre-existing tests plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/verify-document/
git commit -m "feat: resolve verified signatures to signer name and email"
```

---

### Task 2: Admin-only verify route, enriched serialization, and a forgery test

**Files:**
- Modify: `src/interface-adapters/http/serialization.ts`
- Modify: `src/interface-adapters/http/routes/documents.ts`
- Test: `src/interface-adapters/http/documents.integration.test.ts` (add cases to the existing file)

**Interfaces:**
- Consumes: `VerifiedSignatureDto` (Task 1), `isAuthenticatedUserAdmin(c)` (existing, in `authContext.ts`), `authTokenFor`/`bearer` (existing test helpers), `aliceToken`/`bobToken` (already minted in the file's `beforeAll`; alice is the seeded admin, bob is not).
- Produces: `toVerifiedSignatureJson(dto): VerifiedSignatureJson` where `VerifiedSignatureJson` = `{ userId, username, email, signedAt }` with `signedAt` an ISO string; and `GET /documents/:documentId/verify` returning `403` to non-admins.

- [ ] **Step 1: Write the failing tests**

Add these to `src/interface-adapters/http/documents.integration.test.ts`, inside the existing `describe('GET /documents/:documentId/verify', ...)` block.

The three tests already in that block continue to pass unchanged — they use `aliceToken`, and alice is the seeded admin — so do not modify them.

```ts
  it('resolves signers to username and email for an admin', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toHaveLength(1)
    expect(body.signatures[0].userId).toBe('user-alice')
    expect(body.signatures[0].username).toBe('alice')
    expect(body.signatures[0].email).toBe('alice@example.com')
    expect(typeof body.signatures[0].signedAt).toBe('string')
    expect(body.signatures[0].signatureData).toBeUndefined()
  })

  it('rejects verification by a non-admin with 403', async () => {
    const document = await uploadADocument()

    const res = await app.request(`/documents/${document.id}/verify`, { headers: bearer(bobToken) })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.type).toBe('ForbiddenError')
  })

  it('reports valid: false when a stored signature does not actually verify', async () => {
    const document = await uploadADocument()

    // Write a signature row straight past the signing endpoint, carrying bytes
    // that were never produced by alice's key. This is the forgery case the
    // whole screen exists to catch: the row exists, so any check that merely
    // read the database would call this document signed.
    const forged = Signature.create({
      id: randomUUID(),
      documentId: document.id,
      userId: 'user-alice',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date()
    }).value
    await new PostgresSignatureRepository().save(forged)

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(false)
    expect(typeof body.reason).toBe('string')
  })
```

Add whatever imports these need to the top of the file, alongside the existing ones:

```ts
import { randomUUID } from 'node:crypto'
import { PostgresSignatureRepository } from '../../infrastructure/db/PostgresSignatureRepository.js'
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
```

If `bobToken` is not already minted in the file's `beforeAll`, add it there following the existing pattern: `bobToken = await authTokenFor('user-bob', ed25519TestKeys.bob)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interface-adapters/http/documents.integration.test.ts`
Expected: FAIL — the response carries `signatureData` and no `username`, bob's verify returns `200` instead of `403`, and the forged-signature test fails to compile or run until the imports are added.

- [ ] **Step 3: Add the serializer**

In `src/interface-adapters/http/serialization.ts`, add this import alongside the existing ones:

```ts
import { VerifiedSignatureDto } from '../../use-cases/verify-document/VerifyDocumentUseCase.js'
```

and add this interface and function after the existing `toSignatureJson`:

```ts
export interface VerifiedSignatureJson {
  userId: string
  username: string
  email: string
  signedAt: string
}

/**
 * Deliberately omits the raw signature bytes: the verification screen has no
 * use for them, and there is no reason to ship key material-adjacent data to
 * a client that cannot do anything with it.
 */
export function toVerifiedSignatureJson(dto: VerifiedSignatureDto): VerifiedSignatureJson {
  return {
    userId: dto.userId,
    username: dto.username,
    email: dto.email,
    signedAt: dto.signedAt.toISOString()
  }
}
```

Leave `toSignatureJson` in place — `POST /documents/:documentId/signatures` still uses it.

- [ ] **Step 4: Gate the route and use the new serializer**

In `src/interface-adapters/http/routes/documents.ts`, add `toVerifiedSignatureJson` to the existing import from `'../serialization.js'`, then replace the verify handler's body so it starts with the admin check and ends with the new serializer:

```ts
  documents.get('/documents/:documentId/verify', async (c) => {
    if (!isAuthenticatedUserAdmin(c)) {
      return c.json(
        { error: { type: 'ForbiddenError', message: 'Only an administrator may verify document signatures' } },
        403
      )
    }

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

    return c.json({ valid: true, signatures: result.value.map(toVerifiedSignatureJson) }, 200)
  })
```

`isAuthenticatedUserAdmin` is already imported in this file for the upload route — do not add a duplicate import. Every other route in the file stays exactly as it is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/interface-adapters/http/documents.integration.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 6: Run the full backend suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/interface-adapters/http/serialization.ts src/interface-adapters/http/routes/documents.ts src/interface-adapters/http/documents.integration.test.ts
git commit -m "feat: restrict verification to admins and return named signers"
```

---

### Task 3: `DocumentApi.verifyDocument` on the Flutter side

**Files:**
- Modify: `flutter_digital_sign/lib/core/network/document_api.dart`
- Modify: `flutter_digital_sign/test/core/network/fake_document_api.dart`
- Test: `flutter_digital_sign/test/core/network/http_document_api_test.dart` (add cases to the existing file)

**Interfaces:**
- Consumes: the response shapes from Task 2; `AuthSession` and the existing `_send` retry helper in `HttpDocumentApi`.
- Produces: `VerifiedSigner` (`userId`, `username`, `email`, `signedAt`), sealed `VerificationResult` with `VerificationValid(List<VerifiedSigner> signers)` and `VerificationInvalid(String reason)`, and `DocumentApi.verifyDocument(String documentId) -> Future<VerificationResult>` on the port, `HttpDocumentApi`, and `FakeDocumentApi`. Tasks 4 and 5 depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Add to `flutter_digital_sign/test/core/network/http_document_api_test.dart`, following the file's existing conventions (it already has an `aSession()` helper that builds an `AuthSession` backed by `FakeAuthApi`; reuse it exactly as the other groups do):

```dart
  group('HttpDocumentApi.verifyDocument', () {
    test('returns VerificationValid with the named signers', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1/verify');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        return http.Response(
          jsonEncode({
            'valid': true,
            'signatures': [
              {
                'userId': 'user-alice',
                'username': 'alice',
                'email': 'alice@example.com',
                'signedAt': '2026-08-21T07:08:00.000Z',
              }
            ],
          }),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.verifyDocument('doc-1');

      expect(result, isA<VerificationValid>());
      final signers = (result as VerificationValid).signers;
      expect(signers, hasLength(1));
      expect(signers.first.username, 'alice');
      expect(signers.first.email, 'alice@example.com');
      expect(signers.first.userId, 'user-alice');
      expect(signers.first.signedAt, DateTime.utc(2026, 8, 21, 7, 8));
    });

    test('returns VerificationValid with no signers for an unsigned document', () async {
      final mockClient = MockClient((request) async {
        return http.Response(jsonEncode({'valid': true, 'signatures': []}), 200);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.verifyDocument('doc-1');

      expect(result, isA<VerificationValid>());
      expect((result as VerificationValid).signers, isEmpty);
    });

    test('returns VerificationInvalid with the reason when the chain does not verify', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({'valid': false, 'reason': 'cryptographic verification failed'}),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.verifyDocument('doc-1');

      expect(result, isA<VerificationInvalid>());
      expect((result as VerificationInvalid).reason, 'cryptographic verification failed');
    });

    test('throws on a 403 rather than reporting it as a failed verification', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'ForbiddenError', 'message': 'Only an administrator may verify document signatures'}
          }),
          403,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      expect(() => api.verifyDocument('doc-1'), throwsA(isA<Exception>()));
    });
  });
```

That last test pins a constraint from the spec: a permissions problem and a forged signature must never look alike. Mapping a `403` to `VerificationInvalid` would tell an admin a document had been tampered with when in fact they simply lacked access.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/network/http_document_api_test.dart`
Expected: FAIL — `verifyDocument` is not defined on `HttpDocumentApi`.

- [ ] **Step 3: Add the types and the port method**

In `flutter_digital_sign/lib/core/network/document_api.dart`, add these types near the other result types (after `SignResult`'s subclasses):

```dart
class VerifiedSigner {
  final String userId;
  final String username;
  final String email;
  final DateTime signedAt;

  VerifiedSigner({
    required this.userId,
    required this.username,
    required this.email,
    required this.signedAt,
  });

  factory VerifiedSigner.fromJson(Map<String, dynamic> json) {
    return VerifiedSigner(
      userId: json['userId'] as String,
      username: json['username'] as String,
      email: json['email'] as String,
      signedAt: DateTime.parse(json['signedAt'] as String),
    );
  }
}

sealed class VerificationResult {}

/// The chain verified. [signers] contains only signatures that actually
/// verified against their signer's public key -- never merely stored rows.
class VerificationValid extends VerificationResult {
  final List<VerifiedSigner> signers;
  VerificationValid(this.signers);
}

class VerificationInvalid extends VerificationResult {
  final String reason;
  VerificationInvalid(this.reason);
}
```

Add the method to the `DocumentApi` abstract class:

```dart
  Future<VerificationResult> verifyDocument(String documentId);
```

- [ ] **Step 4: Implement it on `HttpDocumentApi`**

Add this method to `HttpDocumentApi`, alongside the others, using the existing `_send` helper so it inherits the bearer header and the one-shot 401 retry:

```dart
  @override
  Future<VerificationResult> verifyDocument(String documentId) async {
    final response = await _send(
      (token) => _client.get(Uri.parse('$baseUrl/documents/$documentId/verify'), headers: _headers(token)),
    );

    // A 403 or 404 is not a verification outcome. Reporting either as
    // VerificationInvalid would tell an admin a document was tampered with
    // when the real problem was access or a bad id.
    if (response.statusCode != 200) {
      throw Exception('Failed to verify document');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (body['valid'] == true) {
      final signatures = (body['signatures'] as List)
          .map((s) => VerifiedSigner.fromJson(s as Map<String, dynamic>))
          .toList();
      return VerificationValid(signatures);
    }

    return VerificationInvalid(body['reason'] as String? ?? 'Verification failed');
  }
```

- [ ] **Step 5: Add it to `FakeDocumentApi`**

In `flutter_digital_sign/test/core/network/fake_document_api.dart`, add the callback field alongside the existing ones:

```dart
  VerificationResult Function(String documentId)? onVerifyDocument;
```

the call-tracking list alongside the existing ones:

```dart
  final List<String> verifyCalls = [];
```

and the method:

```dart
  @override
  Future<VerificationResult> verifyDocument(String documentId) async {
    verifyCalls.add(documentId);
    return onVerifyDocument!.call(documentId);
  }
```

Force-unwrapping matches the file's existing treatment of `onGetDocument`: there is no sensible default `VerificationResult`, so a test that reaches this without configuring it has a bug worth surfacing loudly.

- [ ] **Step 6: Run tests and analysis**

Run: `flutter test test/core/network/http_document_api_test.dart`
Expected: PASS — the 4 new tests plus every pre-existing test in the file.

Run: `flutter analyze lib/core/network/document_api.dart test/core/network/`
Expected: no issues found.

- [ ] **Step 7: Commit**

```bash
git add flutter_digital_sign/lib/core/network/document_api.dart flutter_digital_sign/test/core/network/fake_document_api.dart flutter_digital_sign/test/core/network/http_document_api_test.dart
git commit -m "feat: add DocumentApi.verifyDocument"
```

---

### Task 4: `VerificationPage`

**Files:**
- Create: `flutter_digital_sign/lib/features/next/presentation/pages/verification_page.dart`
- Test: `flutter_digital_sign/test/features/verification/verification_page_test.dart`

**Interfaces:**
- Consumes: `DocumentApi`, `VerificationResult`, `VerificationValid`, `VerificationInvalid`, `VerifiedSigner` (Task 3), `FakeDocumentApi` (Task 3, test only).
- Produces: `VerificationPage({required String documentId, required String documentTitle, required DocumentApi documentApi})`. Task 5 navigates to it.

`documentApi` is required rather than optional-with-a-default here because the only caller (Task 5's details page) already holds a configured instance, and a page that silently builds its own would be one more place constructing a second `AuthSession`.

- [ ] **Step 1: Write the failing tests**

Create `flutter_digital_sign/test/features/verification/verification_page_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/verification_page.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import '../../core/network/fake_document_api.dart';

void main() {
  Widget pageWith(FakeDocumentApi api) {
    return MaterialApp(
      home: VerificationPage(
        documentId: 'doc-1',
        documentTitle: 'Contract_Proposal.pdf',
        documentApi: api,
      ),
    );
  }

  testWidgets('lists the cryptographically verified signers by name', (tester) async {
    final fakeApi = FakeDocumentApi()
      ..onVerifyDocument = (documentId) => VerificationValid([
            VerifiedSigner(
              userId: 'user-alice',
              username: 'alice',
              email: 'alice@example.com',
              signedAt: DateTime.utc(2026, 8, 21, 7, 8),
            ),
          ]);

    await tester.pumpWidget(pageWith(fakeApi));
    await tester.pumpAndSettle();

    expect(fakeApi.verifyCalls, ['doc-1']);
    expect(find.textContaining('alice'), findsWidgets);
    expect(find.textContaining('alice@example.com'), findsOneWidget);
    expect(find.textContaining('verified'), findsWidgets);
  });

  testWidgets('shows a distinct empty state when the document is intact but unsigned', (tester) async {
    final fakeApi = FakeDocumentApi()..onVerifyDocument = (documentId) => VerificationValid([]);

    await tester.pumpWidget(pageWith(fakeApi));
    await tester.pumpAndSettle();

    expect(find.textContaining('No signatures'), findsOneWidget);
    expect(find.textContaining('failed'), findsNothing);
  });

  testWidgets('shows the failure reason when verification does not pass', (tester) async {
    final fakeApi = FakeDocumentApi()
      ..onVerifyDocument = (documentId) => VerificationInvalid('cryptographic verification failed');

    await tester.pumpWidget(pageWith(fakeApi));
    await tester.pumpAndSettle();

    expect(find.textContaining('Verification failed'), findsOneWidget);
    expect(find.textContaining('cryptographic verification failed'), findsOneWidget);
  });

  testWidgets('shows an error with Retry when the request itself fails', (tester) async {
    var calls = 0;
    final fakeApi = FakeDocumentApi()
      ..onVerifyDocument = (documentId) {
        calls++;
        if (calls == 1) {
          throw Exception('network blip');
        }
        return VerificationValid([]);
      };

    await tester.pumpWidget(pageWith(fakeApi));
    await tester.pumpAndSettle();

    expect(find.text('Retry'), findsOneWidget);
    expect(find.textContaining('Verification failed'), findsNothing);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.textContaining('No signatures'), findsOneWidget);
    expect(calls, 2);
  });
}
```

The third and fourth tests together pin the spec's rule that a failed verification and a failed *request* must not look alike: one says "Verification failed", the other must not.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/features/verification/verification_page_test.dart`
Expected: FAIL — `verification_page.dart` does not exist.

- [ ] **Step 3: Write the page**

Create `flutter_digital_sign/lib/features/next/presentation/pages/verification_page.dart`:

```dart
import 'package:flutter/material.dart';
import '../../../../core/network/document_api.dart';

/// Shows which signatures on a document actually verify cryptographically.
///
/// This is deliberately distinct from the signature count on the details page,
/// which counts stored rows. A row exists whether or not its signature is
/// genuine; only what this screen lists has been checked against the signer's
/// public key.
class VerificationPage extends StatefulWidget {
  final String documentId;
  final String documentTitle;
  final DocumentApi documentApi;

  const VerificationPage({
    super.key,
    required this.documentId,
    required this.documentTitle,
    required this.documentApi,
  });

  @override
  State<VerificationPage> createState() => _VerificationPageState();
}

class _VerificationPageState extends State<VerificationPage> {
  VerificationResult? _result;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _verify();
  }

  Future<void> _verify() async {
    setState(() {
      _result = null;
      _errorMessage = null;
    });
    try {
      final result = await widget.documentApi.verifyDocument(widget.documentId);
      if (!mounted) return;
      setState(() {
        _result = result;
      });
    } catch (_) {
      // Deliberately NOT rendered as a verification failure: the request did
      // not complete, so we know nothing about the document either way.
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Could not reach the server to verify this document.';
      });
    }
  }

  String _formatSignedAt(DateTime signedAt) {
    String two(int n) => n.toString().padLeft(2, '0');
    final local = signedAt.toLocal();
    return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Signature Verification')),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: _body(),
      ),
    );
  }

  Widget _body() {
    final errorMessage = _errorMessage;
    if (errorMessage != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(errorMessage, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _verify, child: const Text('Retry')),
          ],
        ),
      );
    }

    final result = _result;
    if (result == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return switch (result) {
      VerificationInvalid(reason: final reason) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.gpp_bad, color: Colors.red, size: 32),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Verification failed',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.red),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(widget.documentTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            Text(reason),
          ],
        ),
      VerificationValid(signers: final signers) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.verified_user, color: Colors.green, size: 32),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    signers.isEmpty ? 'Document intact' : 'Signatures cryptographically verified',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(widget.documentTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 20),
            if (signers.isEmpty)
              const Text('No signatures on this document yet.')
            else
              Expanded(
                child: ListView.separated(
                  itemCount: signers.length,
                  separatorBuilder: (context, index) => const Divider(),
                  itemBuilder: (context, index) {
                    final signer = signers[index];
                    return ListTile(
                      leading: const Icon(Icons.check_circle, color: Colors.green),
                      title: Text(signer.username),
                      subtitle: Text('${signer.email}\nsigned ${_formatSignedAt(signer.signedAt)}'),
                      isThreeLine: true,
                    );
                  },
                ),
              ),
          ],
        ),
    };
  }
}
```

**Note on one spec case this page deliberately does not special-case.** The spec's Error Handling section lists `UnknownIdentityException` → clear the identity and route to registration. This page folds that into the generic error-with-Retry branch instead, on purpose: `VerificationPage` is only reachable after `DocumentDetailsPage` has already successfully loaded the document, which exercises the same auth path and would itself have triggered recovery. Handling it here would mean threading `IdentityStorage` and navigation into a leaf page for a case that cannot realistically arrive at it. If a reviewer disagrees, the fix is to pass `IdentityStorage` in and mirror `NextContent._recoverFromStaleIdentity` — but do not add that speculatively.

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/features/verification/verification_page_test.dart`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add flutter_digital_sign/lib/features/next/presentation/pages/verification_page.dart flutter_digital_sign/test/features/verification/
git commit -m "feat: add VerificationPage"
```

---

### Task 5: Reach it from the details page, admin-only, and relabel the row count

**Files:**
- Modify: `flutter_digital_sign/lib/features/next/presentation/pages/document_details_page.dart`
- Modify: `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`
- Test: `flutter_digital_sign/test/signing_flow_test.dart` (modify the existing file)

**Interfaces:**
- Consumes: `VerificationPage` (Task 4), `AuthSession.isAdmin()` (existing), `FakeAuthApi` and `unsignedJwt(...)` (existing test helpers at `test/core/network/fake_auth_api.dart` and `test/core/auth/jwt_test_helper.dart`).
- Produces: `DocumentDetailsPage({required String documentId, DocumentApi? documentApi, IdentityStorage? identityStorage, AuthSession? authSession})`.

- [ ] **Step 1: Write the failing tests**

In `flutter_digital_sign/test/signing_flow_test.dart`, add these imports alongside the existing ones:

```dart
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'core/auth/jwt_test_helper.dart';
import 'core/network/fake_auth_api.dart';
```

Add this helper inside `void main() { ... }`, next to the file's existing `saveIdentity()` helper:

```dart
  /// A session backed by a fake handshake, issuing a token with the given role.
  /// Every DocumentDetailsPage construction must pass one: without it the page
  /// builds a real AuthSession over HttpAuthApi and attempts a network call.
  AuthSession sessionFor({required bool isAdmin}) {
    final authApi = FakeAuthApi()
      ..onExchangeForToken =
          ((userId, signature) => unsignedJwt({'sub': 'user-1', 'isAdmin': isAdmin}));
    return AuthSession(authApi: authApi, identityStorage: IdentityStorage());
  }
```

Then add `authSession: sessionFor(isAdmin: false),` as an argument to **every** existing `DocumentDetailsPage(...)` construction in the file — read the file and add it to each one; the parameter name is unique so there is no ambiguity about where it goes. Change nothing else about those tests.

Finally add these two new tests:

```dart
  testWidgets('offers verification to an admin', (tester) async {
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
          authSession: sessionFor(isAdmin: true),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Verify signatures'), findsOneWidget);
  });

  testWidgets('hides verification from a non-admin', (tester) async {
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
          authSession: sessionFor(isAdmin: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Verify signatures'), findsNothing);
  });

  testWidgets('labels the details count as stored rows, not verified signatures', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId) => DocumentDetail(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-2',
            signatures: [DocumentSignature(userId: 'user-9', signedAt: DateTime.utc(2026, 8, 20))],
            signedByUser: false,
            signingPayload: [1, 2, 3],
          );

    await tester.pumpWidget(
      MaterialApp(
        home: DocumentDetailsPage(
          documentId: 'doc-1',
          documentApi: fakeApi,
          identityStorage: IdentityStorage(),
          authSession: sessionFor(isAdmin: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Signatures on record'), findsOneWidget);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/signing_flow_test.dart`
Expected: FAIL — `DocumentDetailsPage` has no `authSession` parameter.

- [ ] **Step 3: Thread `AuthSession` into `DocumentDetailsPage` and add the button**

In `flutter_digital_sign/lib/features/next/presentation/pages/document_details_page.dart`:

Add the import for the new page:

```dart
import 'verification_page.dart';
```

Add the widget field alongside the existing `documentApi`/`identityStorage`:

```dart
  final AuthSession? authSession;
```
and `this.authSession,` to its constructor parameter list.

Add the state fields alongside the existing `_documentApi`/`_identityStorage`:

```dart
  late final AuthSession _authSession;
  bool _isAdmin = false;
```

Replace the `initState` body so the session is built once and shared with the API client, exactly as `NextPage` does:

```dart
  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _authSession = widget.authSession ??
        AuthSession(authApi: HttpAuthApi(), identityStorage: _identityStorage);
    _documentApi = widget.documentApi ?? HttpDocumentApi(authSession: _authSession);
    _load();
  }
```

In `_load`, resolve the role in the same `try` as the document fetch, so one failure path covers both. Replace the two lines that fetch the detail and call `setState` with:

```dart
      final admin = await _authSession.isAdmin();
      final detail = await _documentApi.getDocument(widget.documentId);
      if (!mounted) return;
      setState(() {
        _isAdmin = admin;
        _detail = detail;
      });
```

Change the signature-count row's label from `'Signatures'` to `'Signatures on record'`:

```dart
          _InfoRow(label: 'Signatures on record', value: '${detail.signatures.length}'),
```

Then add the admin-only button. In the `Column`'s children, immediately after the `_InfoRow` lines and before the `if (_errorMessage != null)` block, insert:

```dart
          if (_isAdmin) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.verified_user),
              label: const Text('Verify signatures'),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => VerificationPage(
                      documentId: widget.documentId,
                      documentTitle: detail.title,
                      documentApi: _documentApi,
                    ),
                  ),
                );
              },
            ),
          ],
```

- [ ] **Step 4: Pass the session through from the document list**

In `flutter_digital_sign/lib/features/next/presentation/widgets/next_content.dart`, the `DocumentDetailsPage(...)` construction inside the list tile's `onTap` currently passes `documentId`, `documentApi`, and `identityStorage`. Add one more argument so the details page reuses the list's session rather than building a second one:

```dart
                              authSession: widget.authSession,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/signing_flow_test.dart`
Expected: PASS — the pre-existing tests plus the 3 new ones.

- [ ] **Step 6: Run the full Flutter suite and analysis**

Run: `flutter test`
Expected: PASS — every test file.

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 7: Manually verify against the real backend**

Start the backend from the repo root: `npm run dev`.

Confirm the server-side rule first, which is the one that matters. Alice is the seeded admin, bob is not:

```bash
curl -s -o /dev/null -w "no token -> %{http_code}\n" http://localhost:3000/documents/any-id/verify
```
Expected: `401` — authentication still runs before authorization.

Then run the app (`flutter run -d chrome`, or `-d windows` if the Visual Studio C++ workload has since been installed) and confirm: a non-admin opening a document sees no "Verify signatures" button; an admin sees it, and tapping it lists the signers by name with a green header. If a document has no signatures, the screen says so rather than reporting a failure.

- [ ] **Step 8: Commit**

```bash
git add flutter_digital_sign/lib/features/next/ flutter_digital_sign/test/signing_flow_test.dart
git commit -m "feat: reach signature verification from the details page, admin only"
```

---

## Post-plan state

An administrator can open any document and see which signatures actually verify against their signers' public keys, listed by name and email — while the details page's row count is now labelled "Signatures on record" so the two can never be mistaken for each other. The verify endpoint is admin-only, so enriching it with real email addresses did not hand every registered user a roster of everyone else's. And an integration test now writes a forged signature straight past the signing endpoint and asserts the verification reports it, which is the single assertion that would fail if this endpoint were ever quietly reduced to a database read.

This completes the three-sub-project sequence: a provable identity, a role the server enforces, and a verification surface that means something because of both.
