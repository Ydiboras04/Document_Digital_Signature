import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/welcome/presentation/pages/welcome_page.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/next_page.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  testWidgets('shows the Start button when no identity is saved', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: WelcomePage()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Start'), findsOneWidget);
  });

  testWidgets(
    'navigates straight to the document list when an identity is already saved',
    (tester) async {
      final identityStorage = IdentityStorage();
      await identityStorage.save('user-123', [1, 2, 3], [4, 5, 6]);

      await tester.pumpWidget(
        MaterialApp(
          home: WelcomePage(identityStorage: identityStorage),
          routes: {'/next': (context) => const NextPage()},
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Documents'), findsOneWidget);
      expect(find.text('Start'), findsNothing);
    },
  );
}
