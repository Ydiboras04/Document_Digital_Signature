import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/next_page.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'core/network/fake_document_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<void> saveIdentity() async {
    await IdentityStorage().save('user-1', [1, 2, 3], [4, 5, 6]);
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

    await tester.pumpWidget(
      MaterialApp(
        home: NextPage(documentApi: fakeApi, identityStorage: IdentityStorage()),
      ),
    );
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

    await tester.pumpWidget(
      MaterialApp(
        home: NextPage(documentApi: fakeApi, identityStorage: IdentityStorage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Signed'), findsOneWidget);
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

    await tester.pumpWidget(
      MaterialApp(
        home: NextPage(documentApi: fakeApi, identityStorage: IdentityStorage()),
      ),
    );
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
}
