import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_digital_sign/features/next/presentation/pages/next_page.dart';

void main() {
  testWidgets('shows list of PDF documents and opens document details', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: NextPage(),
      ),
    );

    expect(find.text('Documents'), findsOneWidget);
    expect(find.text('Contract_Proposal.pdf'), findsOneWidget);

    await tester.tap(find.text('Contract_Proposal.pdf'));
    await tester.pumpAndSettle();

    expect(find.text('Document Details'), findsOneWidget);
    expect(find.textContaining('Contract_Proposal.pdf'), findsWidgets);

    await tester.tap(find.text('Confirm Signature'));
    await tester.pumpAndSettle();

    expect(find.text('Signature Confirmed'), findsOneWidget);
  });
}
