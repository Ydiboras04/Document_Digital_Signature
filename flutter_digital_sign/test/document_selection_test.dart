import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/app/routes/app_routes.dart';
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

  testWidgets('recovers from a stale identity by clearing it and returning to registration',
      (tester) async {
    await saveIdentity();
    final fakeApi = FakeDocumentApi()
      ..onListDocuments = () {
        throw UnknownIdentityException();
      };

    await tester.pumpWidget(
      MaterialApp(
        routes: {
          AppRoutes.register: (context) => const Scaffold(body: Text('Register Page')),
        },
        home: NextPage(
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
}
