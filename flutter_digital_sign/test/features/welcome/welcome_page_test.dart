import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/welcome/presentation/pages/welcome_page.dart';
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
          // A trivial placeholder stands in for NextPage here: this test only
          // needs to confirm WelcomePage navigated somewhere and stopped
          // showing 'Start'. Routing to the real NextPage would build a live
          // AuthSession(authApi: HttpAuthApi()) and attempt a network call
          // inside `flutter test`.
          routes: {'/next': (context) => const Scaffold(body: Text('Documents'))},
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Documents'), findsOneWidget);
      expect(find.text('Start'), findsNothing);
    },
  );
}
