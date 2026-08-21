import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/app/routes/app_routes.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/document_details_page.dart';
import 'package:flutter_digital_sign/core/network/auth_api.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'core/auth/jwt_test_helper.dart';
import 'core/network/fake_auth_api.dart';
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

  /// A session backed by a fake handshake, issuing a token with the given role.
  /// Every DocumentDetailsPage construction must pass one: without it the page
  /// builds a real AuthSession over HttpAuthApi and attempts a network call.
  AuthSession sessionFor({required bool isAdmin}) {
    final authApi = FakeAuthApi()
      ..onExchangeForToken =
          ((userId, signature) => unsignedJwt({'sub': 'user-1', 'isAdmin': isAdmin}));
    return AuthSession(authApi: authApi, identityStorage: IdentityStorage());
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
          authSession: sessionFor(isAdmin: false),
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

  testWidgets('recovers from a stale identity while loading the document', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = (documentId) => throw UnknownIdentityException();

    await tester.pumpWidget(
      MaterialApp(
        routes: {
          AppRoutes.register: (context) => const Scaffold(body: Text('Register Page')),
        },
        home: DocumentDetailsPage(
          documentId: 'doc-1',
          documentApi: fakeApi,
          identityStorage: IdentityStorage(),
          authSession: sessionFor(isAdmin: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Register Page'), findsOneWidget);
    expect(
      find.text('This device\'s identity is no longer recognised. Please register again.'),
      findsOneWidget,
    );
    expect(await IdentityStorage().load(), isNull);
  });

  testWidgets('recovers from a stale identity while signing', (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onGetDocument = ((documentId) => DocumentDetail(
            id: 'doc-1',
            title: 'Contract_Proposal.pdf',
            uploaderId: 'user-2',
            signatures: [],
            signedByUser: false,
            signingPayload: [1, 2, 3],
          ))
      ..onSubmitSignature = ((documentId, signatureBytes) => throw UnknownIdentityException());

    await tester.pumpWidget(
      MaterialApp(
        routes: {
          AppRoutes.register: (context) => const Scaffold(body: Text('Register Page')),
        },
        home: DocumentDetailsPage(
          documentId: 'doc-1',
          documentApi: fakeApi,
          identityStorage: IdentityStorage(),
          authSession: sessionFor(isAdmin: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Confirm Signature'));
    await tester.pumpAndSettle();

    expect(find.text('Register Page'), findsOneWidget);
    expect(find.text('Failed to sign document.'), findsNothing);
    expect(await IdentityStorage().load(), isNull);
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
          authSession: sessionFor(isAdmin: false),
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
              authSession: sessionFor(isAdmin: false),
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
        authSession: sessionFor(isAdmin: false),
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
          authSession: sessionFor(isAdmin: false),
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
}
