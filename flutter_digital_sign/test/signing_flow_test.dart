import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_digital_sign/features/next/presentation/pages/document_details_page.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/signing_confirmation_page.dart';

void main() {
  testWidgets('shows selected PDF details and confirmation page', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: DocumentDetailsPage(
          documentName: 'Contract_Proposal.pdf',
        ),
      ),
    );

    expect(find.text('Document Details'), findsOneWidget);
    expect(find.text('Contract_Proposal.pdf'), findsWidgets);

    await tester.tap(find.text('Confirm Signature'));
    await tester.pumpAndSettle();

    expect(find.text('Signature Confirmed'), findsOneWidget);
    expect(find.text('Your document has been signed successfully.'), findsOneWidget);
  });

  testWidgets('confirmation page renders a success message', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SigningConfirmationPage(
          documentName: 'Invoice_2026_08.pdf',
        ),
      ),
    );

    expect(find.text('Signature Confirmed'), findsOneWidget);
    expect(find.text('Invoice_2026_08.pdf'), findsWidgets);
  });
}
