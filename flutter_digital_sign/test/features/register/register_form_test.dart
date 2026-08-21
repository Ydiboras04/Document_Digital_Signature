import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/register/presentation/widgets/register_form.dart';
import 'package:flutter_digital_sign/core/network/user_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import '../../core/network/fake_user_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  testWidgets(
    'successful registration saves identity and navigates to the document list',
    (tester) async {
      final fakeUserApi = FakeUserApi();
      final identityStorage = IdentityStorage();

      await tester.pumpWidget(
        MaterialApp(
          home: RegisterForm(userApi: fakeUserApi, identityStorage: identityStorage),
          // A trivial placeholder stands in for NextPage here: this test only
          // needs to confirm that registration navigated to the document list
          // destination. Routing to the real NextPage would build a live
          // AuthSession(authApi: HttpAuthApi()) and attempt a network call
          // inside `flutter test`.
          routes: {'/next': (context) => const Scaffold(body: Text('Documents'))},
        ),
      );

      await tester.enterText(find.byType(TextField).first, 'dave');
      await tester.enterText(find.byType(TextField).last, 'dave@example.com');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Register'));
      await tester.pumpAndSettle();

      expect(fakeUserApi.calls, hasLength(1));
      expect(fakeUserApi.calls.first.username, 'dave');
      expect(fakeUserApi.calls.first.email, 'dave@example.com');

      final savedIdentity = await identityStorage.load();
      expect(savedIdentity, isNotNull);
      expect(savedIdentity!.userId, 'fake-user-id');

      expect(find.text('Documents'), findsOneWidget);
    },
  );

  testWidgets(
    'duplicate email failure shows an error and does not navigate',
    (tester) async {
      final fakeUserApi = FakeUserApi()
        ..onRegister = (username, email, publicKeyBytes) =>
            RegisterFailure('Email $email is already registered');
      final identityStorage = IdentityStorage();

      await tester.pumpWidget(
        MaterialApp(
          home: RegisterForm(userApi: fakeUserApi, identityStorage: identityStorage),
          routes: {'/next': (context) => const Scaffold(body: Text('Documents'))},
        ),
      );

      await tester.enterText(find.byType(TextField).first, 'dave');
      await tester.enterText(find.byType(TextField).last, 'dave@example.com');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Register'));
      await tester.pumpAndSettle();

      expect(find.textContaining('already registered'), findsOneWidget);
      expect(find.text('Documents'), findsNothing);

      final savedIdentity = await identityStorage.load();
      expect(savedIdentity, isNull);
    },
  );
}
