import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/verification_page.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import '../../core/network/fake_document_api.dart';

void main() {
  Widget pageWith(FakeDocumentApi api) {
    return MaterialApp(
      home: VerificationPage(
        // Keyed by the fake so that pumping a second, different api at the
        // same widget location creates a fresh State (and re-runs initState)
        // instead of Flutter reusing the old one via didUpdateWidget.
        key: ValueKey(api),
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
    expect(
      find.textContaining('Could not reach the server to verify this document.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.textContaining('No signatures'), findsOneWidget);
    expect(calls, 2);
  });

  testWidgets('shows the server message with no Retry when the caller lacks permission', (tester) async {
    final fakeApi = FakeDocumentApi()
      ..onVerifyDocument = (documentId) => throw VerificationRequestException(
            403,
            'Only an administrator may verify document signatures',
          );

    await tester.pumpWidget(pageWith(fakeApi));
    await tester.pumpAndSettle();

    expect(find.textContaining('Only an administrator may verify document signatures'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
    expect(find.textContaining('Verification failed'), findsNothing);
    expect(
      find.textContaining('Could not reach the server to verify this document.'),
      findsNothing,
    );
  });

  testWidgets('shows a not-found message with no Retry for a missing document', (tester) async {
    final fakeApi = FakeDocumentApi()
      ..onVerifyDocument = (documentId) => throw VerificationRequestException(
            404,
            'Document doc-1 was not found',
          );

    await tester.pumpWidget(pageWith(fakeApi));
    await tester.pumpAndSettle();

    expect(find.textContaining('Document doc-1 was not found'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
    expect(find.textContaining('Verification failed'), findsNothing);
    expect(
      find.textContaining('Could not reach the server to verify this document.'),
      findsNothing,
    );
  });

  testWidgets('a permissions error and an unreachable server do not render alike', (tester) async {
    final forbiddenApi = FakeDocumentApi()
      ..onVerifyDocument =
          (documentId) => throw VerificationRequestException(403, 'Only an administrator may verify document signatures');
    await tester.pumpWidget(pageWith(forbiddenApi));
    await tester.pumpAndSettle();
    final forbiddenMessage =
        (find.textContaining('administrator').evaluate().single.widget as Text).data;

    final unreachableApi = FakeDocumentApi()..onVerifyDocument = (documentId) => throw Exception('network blip');
    await tester.pumpWidget(pageWith(unreachableApi));
    await tester.pumpAndSettle();
    final unreachableMessage = (find.textContaining('reach the server').evaluate().single.widget as Text).data;

    expect(forbiddenMessage, isNot(equals(unreachableMessage)));
  });
}
