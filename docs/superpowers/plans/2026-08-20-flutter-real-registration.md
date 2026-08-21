# Flutter Real Registration Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Flutter app's fake Login screen with a real registration flow: on-device Ed25519 keypair generation, a call to the backend's `POST /users`, and secure local storage of the resulting identity — with the Welcome screen skipping straight to the document list when an identity already exists.

**Architecture:** A thin port/adapter split for networking (`UserApi` abstract + `HttpUserApi` real + `FakeUserApi` test double), mirroring the pattern already used throughout the backend. `IdentityStorage` wraps `flutter_secure_storage` directly (no port needed — the package ships its own in-memory test-mock switch, verified against the installed package source before writing this plan).

**Tech Stack:** `http` ^1.6.0, `cryptography` ^2.9.0, `flutter_secure_storage` ^11.0.0 — all already added to `pubspec.yaml`/`pubspec.lock` during design research; Task 1 just verifies this. `flutter_test` for all tests (already the project's only test dependency).

**Spec:** `docs/superpowers/specs/2026-08-20-flutter-real-registration-design.md`

## Global Constraints

- Target platform is Windows desktop (`flutter run -d windows`) talking to `http://localhost:3000` — no network aliasing needed.
- No password field anywhere — the backend has no authentication mechanism, only registration.
- `lib/features/login/` is deleted entirely, not kept alongside the new `register` feature.
- Every exact API used below (`Ed25519()`, `SimpleKeyPair`, `SimplePublicKey.bytes`, `FlutterSecureStorage.write()`/`.read()`/`.setMockInitialValues()`, `http.testing.MockClient`) was verified against the actual installed package source before this plan was written — not guessed.
- All Dart files use the project's existing relative-import style (no `package:` imports between the project's own files, matching `login_form.dart`'s `import '../../../../app/routes/app_routes.dart';` pattern) — except test files, which use `package:flutter_digital_sign/...` imports to reach `lib/`, matching the existing `document_selection_test.dart`/`signing_flow_test.dart` convention.
- Before the final manual verification step (`flutter run -d windows`), Windows Developer Mode must be enabled for plugin symlink support (`flutter_secure_storage` has native Windows code) — run `start ms-settings:developers` and enable it if not already on. This is NOT needed for `flutter test`, which runs on a host test harness without building real platform plugins.

---

### Task 1: Ed25519KeyPair

**Files:**
- Create: `lib/core/crypto/ed25519_key_pair.dart`
- Test: `test/core/crypto/ed25519_key_pair_test.dart`

**Interfaces:**
- Consumes: `Ed25519`, `SimpleKeyPair`, `SimplePublicKey` from `package:cryptography/cryptography.dart`.
- Produces: `Ed25519KeyPair` with a static `generate() -> Future<Ed25519KeyPair>`, a `publicKeyBytes` field (`List<int>`, 32 bytes), and an `extractPrivateKeyBytes() -> Future<List<int>>` method (32-byte seed). Task 4's `RegisterForm` depends on this.

- [ ] **Step 1: Verify dependencies are present**

Run (from `flutter_digital_sign/`): `flutter pub get`
Expected: completes with no errors — `http`, `cryptography`, `flutter_secure_storage` are already in `pubspec.yaml` from design research.

- [ ] **Step 2: Write the failing tests**

Create `test/core/crypto/ed25519_key_pair_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_digital_sign/core/crypto/ed25519_key_pair.dart';

void main() {
  test('generates a 32-byte public key', () async {
    final keyPair = await Ed25519KeyPair.generate();

    expect(keyPair.publicKeyBytes.length, 32);
  });

  test('generates a 32-byte private key seed', () async {
    final keyPair = await Ed25519KeyPair.generate();

    final privateKeyBytes = await keyPair.extractPrivateKeyBytes();

    expect(privateKeyBytes.length, 32);
  });

  test('generates different key pairs on each call', () async {
    final first = await Ed25519KeyPair.generate();
    final second = await Ed25519KeyPair.generate();

    expect(first.publicKeyBytes, isNot(equals(second.publicKeyBytes)));
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `flutter_digital_sign/`): `flutter test test/core/crypto/ed25519_key_pair_test.dart`
Expected: FAIL — `Error: Couldn't resolve the package 'flutter_digital_sign'` or a "file not found" style error for `ed25519_key_pair.dart`, since it doesn't exist yet.

- [ ] **Step 4: Write the implementation**

Create `lib/core/crypto/ed25519_key_pair.dart`:

```dart
import 'package:cryptography/cryptography.dart';

class Ed25519KeyPair {
  final SimpleKeyPair _keyPair;
  final List<int> publicKeyBytes;

  Ed25519KeyPair._(this._keyPair, this.publicKeyBytes);

  static Future<Ed25519KeyPair> generate() async {
    final algorithm = Ed25519();
    final keyPair = await algorithm.newKeyPair();
    final publicKey = await keyPair.extractPublicKey();
    return Ed25519KeyPair._(keyPair, publicKey.bytes);
  }

  Future<List<int>> extractPrivateKeyBytes() {
    return _keyPair.extractPrivateKeyBytes();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/core/crypto/ed25519_key_pair_test.dart`
Expected: PASS — 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add flutter_digital_sign/pubspec.yaml flutter_digital_sign/pubspec.lock flutter_digital_sign/lib/core/crypto/ed25519_key_pair.dart flutter_digital_sign/test/core/crypto/ed25519_key_pair_test.dart
git commit -m "feat: add Ed25519KeyPair for on-device key generation"
```

---

### Task 2: UserApi, HttpUserApi, FakeUserApi

**Files:**
- Create: `lib/core/network/user_api.dart`
- Test: `test/core/network/http_user_api_test.dart`
- Create: `test/core/network/fake_user_api.dart` (test helper, not a test file with its own assertions — analogous to the backend's `Fake*` classes)

**Interfaces:**
- Consumes: `http.Client`, `http.Response` from `package:http/http.dart`; `MockClient` from `package:http/testing.dart` (test only).
- Produces: `RegisterResult` (sealed: `RegisterSuccess(String userId)` / `RegisterFailure(String message)`), `UserApi` (abstract, `register(username, email, publicKeyBytes) -> Future<RegisterResult>`), `HttpUserApi` (real implementation, constructor `({String baseUrl = 'http://localhost:3000', http.Client? client})`), `FakeUserApi` (test double, records calls, configurable via `onRegister`). Task 4's `RegisterForm`/`RegisterPage` and its tests depend on all of these.

- [ ] **Step 1: Write the failing tests**

Create `test/core/network/http_user_api_test.dart`:

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/network/user_api.dart';

void main() {
  group('HttpUserApi.register', () {
    test('returns RegisterSuccess with the userId on 201', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/users');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['username'], 'dave');
        expect(body['email'], 'dave@example.com');
        expect(body['publicKeyBytes'], base64Encode([1, 2, 3]));

        return http.Response(
          jsonEncode({
            'id': 'user-123',
            'username': 'dave',
            'email': 'dave@example.com',
            'publicKey': 'abc',
          }),
          201,
        );
      });
      final api = HttpUserApi(client: mockClient);

      final result = await api.register('dave', 'dave@example.com', [1, 2, 3]);

      expect(result, isA<RegisterSuccess>());
      expect((result as RegisterSuccess).userId, 'user-123');
    });

    test('returns RegisterFailure with the server message on 409', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {
              'type': 'DuplicateEmailError',
              'message': 'Email dave@example.com is already registered',
            },
          }),
          409,
        );
      });
      final api = HttpUserApi(client: mockClient);

      final result = await api.register('dave', 'dave@example.com', [1, 2, 3]);

      expect(result, isA<RegisterFailure>());
      expect(
        (result as RegisterFailure).message,
        'Email dave@example.com is already registered',
      );
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/core/network/http_user_api_test.dart`
Expected: FAIL — `user_api.dart` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/core/network/user_api.dart`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

sealed class RegisterResult {}

class RegisterSuccess extends RegisterResult {
  final String userId;
  RegisterSuccess(this.userId);
}

class RegisterFailure extends RegisterResult {
  final String message;
  RegisterFailure(this.message);
}

abstract class UserApi {
  Future<RegisterResult> register(
    String username,
    String email,
    List<int> publicKeyBytes,
  );
}

class HttpUserApi implements UserApi {
  final String baseUrl;
  final http.Client _client;

  HttpUserApi({this.baseUrl = 'http://localhost:3000', http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<RegisterResult> register(
    String username,
    String email,
    List<int> publicKeyBytes,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/users'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'username': username,
        'email': email,
        'publicKeyBytes': base64Encode(publicKeyBytes),
      }),
    );

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 201) {
      return RegisterSuccess(body['id'] as String);
    }

    final error = body['error'] as Map<String, dynamic>?;
    final message = error?['message'] as String? ?? 'Registration failed';
    return RegisterFailure(message);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/core/network/http_user_api_test.dart`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Write FakeUserApi**

Create `test/core/network/fake_user_api.dart`:

```dart
import 'package:flutter_digital_sign/core/network/user_api.dart';

class FakeUserApi implements UserApi {
  RegisterResult Function(String username, String email, List<int> publicKeyBytes)?
      onRegister;
  final List<({String username, String email, List<int> publicKeyBytes})> calls = [];

  @override
  Future<RegisterResult> register(
    String username,
    String email,
    List<int> publicKeyBytes,
  ) async {
    calls.add((username: username, email: email, publicKeyBytes: publicKeyBytes));
    return onRegister?.call(username, email, publicKeyBytes) ??
        RegisterSuccess('fake-user-id');
  }
}
```

- [ ] **Step 6: Run typecheck-equivalent (Dart analysis) and full test file**

Run: `flutter analyze lib/core/network/user_api.dart test/core/network/`
Expected: no issues found.

Run: `flutter test test/core/network/`
Expected: PASS — 2 tests passed (`fake_user_api.dart` has no `main()`/tests of its own — it's a helper, not a test file, same as the backend's `Fake*` classes).

- [ ] **Step 7: Commit**

```bash
git add flutter_digital_sign/lib/core/network/user_api.dart flutter_digital_sign/test/core/network/http_user_api_test.dart flutter_digital_sign/test/core/network/fake_user_api.dart
git commit -m "feat: add UserApi, HttpUserApi, and FakeUserApi"
```

---

### Task 3: IdentityStorage

**Files:**
- Create: `lib/core/storage/identity_storage.dart`
- Test: `test/core/storage/identity_storage_test.dart`

**Interfaces:**
- Consumes: `FlutterSecureStorage` from `package:flutter_secure_storage/flutter_secure_storage.dart`.
- Produces: `StoredIdentity` (`{userId, publicKeyBytes, privateKeyBytes}`), `IdentityStorage` with `save(userId, publicKeyBytes, privateKeyBytes) -> Future<void>` and `load() -> Future<StoredIdentity?>`. Task 4's `RegisterForm` and Task 5's `WelcomePage` both depend on this.

- [ ] **Step 1: Write the failing tests**

Create `test/core/storage/identity_storage_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('load returns null when nothing has been saved', () async {
    final storage = IdentityStorage();

    final identity = await storage.load();

    expect(identity, isNull);
  });

  test('load returns the saved identity after save', () async {
    final storage = IdentityStorage();

    await storage.save('user-123', [1, 2, 3], [4, 5, 6]);
    final identity = await storage.load();

    expect(identity, isNotNull);
    expect(identity!.userId, 'user-123');
    expect(identity.publicKeyBytes, [1, 2, 3]);
    expect(identity.privateKeyBytes, [4, 5, 6]);
  });
}
```

(`FlutterSecureStorage.setMockInitialValues({})` swaps in an in-memory test platform implementation — verified against the installed package source. No mocking library or extra abstraction needed for this class.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/core/storage/identity_storage_test.dart`
Expected: FAIL — `identity_storage.dart` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/core/storage/identity_storage.dart`:

```dart
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredIdentity {
  final String userId;
  final List<int> publicKeyBytes;
  final List<int> privateKeyBytes;

  StoredIdentity({
    required this.userId,
    required this.publicKeyBytes,
    required this.privateKeyBytes,
  });
}

class IdentityStorage {
  static const _userIdKey = 'identity_user_id';
  static const _publicKeyKey = 'identity_public_key';
  static const _privateKeyKey = 'identity_private_key';

  final FlutterSecureStorage _storage;

  IdentityStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  Future<void> save(
    String userId,
    List<int> publicKeyBytes,
    List<int> privateKeyBytes,
  ) async {
    await _storage.write(key: _userIdKey, value: userId);
    await _storage.write(key: _publicKeyKey, value: base64Encode(publicKeyBytes));
    await _storage.write(key: _privateKeyKey, value: base64Encode(privateKeyBytes));
  }

  Future<StoredIdentity?> load() async {
    final userId = await _storage.read(key: _userIdKey);
    final publicKeyB64 = await _storage.read(key: _publicKeyKey);
    final privateKeyB64 = await _storage.read(key: _privateKeyKey);

    if (userId == null || publicKeyB64 == null || privateKeyB64 == null) {
      return null;
    }

    return StoredIdentity(
      userId: userId,
      publicKeyBytes: base64Decode(publicKeyB64),
      privateKeyBytes: base64Decode(privateKeyB64),
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/core/storage/identity_storage_test.dart`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add flutter_digital_sign/lib/core/storage/identity_storage.dart flutter_digital_sign/test/core/storage/identity_storage_test.dart
git commit -m "feat: add IdentityStorage for secure on-device identity persistence"
```

---

### Task 4: RegisterPage and RegisterForm (replacing Login)

**Files:**
- Create: `lib/features/register/presentation/pages/register_page.dart`
- Create: `lib/features/register/presentation/widgets/register_form.dart`
- Test: `test/features/register/register_form_test.dart`
- Delete: `lib/features/login/presentation/pages/login_page.dart`
- Delete: `lib/features/login/presentation/widgets/login_form.dart`

**Interfaces:**
- Consumes: `Ed25519KeyPair` (Task 1), `UserApi`/`RegisterResult`/`RegisterSuccess`/`RegisterFailure` (Task 2), `IdentityStorage` (Task 3), `FakeUserApi` (Task 2, test only), `AppRoutes.next` (existing — `AppRoutes.register` is added in Task 6, so this task's test constructs its own minimal route map rather than depending on `AppRoutes.register` existing yet).
- Produces: `RegisterPage` (constructor `({UserApi? userApi, IdentityStorage? identityStorage})`), `RegisterForm` (constructor `({required UserApi userApi, required IdentityStorage identityStorage})`). Task 6 wires `RegisterPage` into `app_routes.dart`.

- [ ] **Step 1: Write the failing tests**

Create `test/features/register/register_form_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_digital_sign/features/register/presentation/widgets/register_form.dart';
import 'package:flutter_digital_sign/core/network/user_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'package:flutter_digital_sign/features/next/presentation/pages/next_page.dart';
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
          routes: {'/next': (context) => const NextPage()},
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
          routes: {'/next': (context) => const NextPage()},
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/features/register/register_form_test.dart`
Expected: FAIL — `register_form.dart` doesn't exist yet.

- [ ] **Step 3: Write RegisterForm**

Create `lib/features/register/presentation/widgets/register_form.dart`:

```dart
import 'package:flutter/material.dart';
import '../../../../core/crypto/ed25519_key_pair.dart';
import '../../../../core/network/user_api.dart';
import '../../../../core/storage/identity_storage.dart';

class RegisterForm extends StatefulWidget {
  final UserApi userApi;
  final IdentityStorage identityStorage;

  const RegisterForm({
    super.key,
    required this.userApi,
    required this.identityStorage,
  });

  @override
  State<RegisterForm> createState() => _RegisterFormState();
}

class _RegisterFormState extends State<RegisterForm> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  String? _errorMessage;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _usernameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final keyPair = await Ed25519KeyPair.generate();
    final privateKeyBytes = await keyPair.extractPrivateKeyBytes();

    final result = await widget.userApi.register(
      _usernameController.text,
      _emailController.text,
      keyPair.publicKeyBytes,
    );

    if (!mounted) return;

    switch (result) {
      case RegisterSuccess(userId: final userId):
        await widget.identityStorage.save(
          userId,
          keyPair.publicKeyBytes,
          privateKeyBytes,
        );
        if (!mounted) return;
        Navigator.pushReplacementNamed(context, '/next');
      case RegisterFailure(message: final message):
        setState(() {
          _isSubmitting = false;
          _errorMessage = message;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text(
            'Register',
            style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 32),
          TextField(
            controller: _usernameController,
            decoration: const InputDecoration(
              labelText: 'Username',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _emailController,
            decoration: const InputDecoration(
              labelText: 'Email',
              border: OutlineInputBorder(),
            ),
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 16),
            Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 32),
          ElevatedButton(
            onPressed: _isSubmitting ? null : _submit,
            child: const Text('Register', style: TextStyle(fontSize: 18)),
          ),
        ],
      ),
    );
  }
}
```

Note: this uses the literal route name `'/next'` rather than `AppRoutes.next`, because `AppRoutes` isn't modified until Task 6, and this task's own test constructs a minimal `routes: {'/next': ...}` map rather than depending on the full `AppRoutes` class. Task 6 does not need to change this literal — `AppRoutes.next` already equals `'/next'` today and stays that way; only the `login`/`register` route key changes in Task 6.

- [ ] **Step 4: Write RegisterPage**

Create `lib/features/register/presentation/pages/register_page.dart`:

```dart
import 'package:flutter/material.dart';
import '../widgets/register_form.dart';
import '../../../../core/network/user_api.dart';
import '../../../../core/storage/identity_storage.dart';

class RegisterPage extends StatelessWidget {
  final UserApi? userApi;
  final IdentityStorage? identityStorage;

  const RegisterPage({super.key, this.userApi, this.identityStorage});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RegisterForm(
        userApi: userApi ?? HttpUserApi(),
        identityStorage: identityStorage ?? IdentityStorage(),
      ),
    );
  }
}
```

- [ ] **Step 5: Delete the old Login feature**

```bash
rm flutter_digital_sign/lib/features/login/presentation/pages/login_page.dart
rm flutter_digital_sign/lib/features/login/presentation/widgets/login_form.dart
```

(Leave the now-empty `lib/features/login/` directory — Dart/Flutter doesn't track empty directories in git anyway; there's nothing to explicitly clean up.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `flutter test test/features/register/register_form_test.dart`
Expected: PASS — 2 tests passed.

- [ ] **Step 7: Run the full test suite so far**

Run: `flutter test`
Expected: `document_selection_test.dart` and `signing_flow_test.dart` (existing, untouched) still pass. `app_routes.dart` still references the now-deleted `login_page.dart` at this point — **this will cause a compile error affecting any test that transitively imports `app_routes.dart`** (none of the existing test files import it directly, but double check the run output doesn't show a new failure here; if it does, that's expected and Task 6 fixes it).

- [ ] **Step 8: Commit**

```bash
git add flutter_digital_sign/lib/features/register/ flutter_digital_sign/test/features/register/
git add -u flutter_digital_sign/lib/features/login/
git commit -m "feat: add RegisterPage/RegisterForm, remove fake Login screen"
```

---

### Task 5: WelcomePage skip-to-document-list behavior

**Files:**
- Modify: `lib/features/welcome/presentation/pages/welcome_page.dart`
- Test: `test/features/welcome/welcome_page_test.dart`

**Interfaces:**
- Consumes: `IdentityStorage` (Task 3), `WelcomeContent` (existing).
- Produces: `WelcomePage` now takes an optional `identityStorage` constructor parameter for testability, checks it on `initState`, and navigates to `/next` if an identity is already saved.

- [ ] **Step 1: Write the failing tests**

Create `test/features/welcome/welcome_page_test.dart`:

```dart
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
```

- [ ] **Step 2: Run tests to verify the second one fails**

Run: `flutter test test/features/welcome/welcome_page_test.dart`
Expected: the first test passes (current `WelcomePage` already shows "Start" unconditionally); the second FAILS (current `WelcomePage` doesn't check identity storage or navigate on its own).

- [ ] **Step 3: Update WelcomePage**

Replace the contents of `lib/features/welcome/presentation/pages/welcome_page.dart` with:

```dart
import 'package:flutter/material.dart';
import '../widgets/welcome_content.dart';
import '../../../../core/storage/identity_storage.dart';

class WelcomePage extends StatefulWidget {
  final IdentityStorage? identityStorage;

  const WelcomePage({super.key, this.identityStorage});

  @override
  State<WelcomePage> createState() => _WelcomePageState();
}

class _WelcomePageState extends State<WelcomePage> {
  late final IdentityStorage _identityStorage;
  bool _isChecking = true;

  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _checkExistingIdentity();
  }

  Future<void> _checkExistingIdentity() async {
    final identity = await _identityStorage.load();
    if (!mounted) return;
    if (identity != null) {
      Navigator.pushReplacementNamed(context, '/next');
      return;
    }
    setState(() {
      _isChecking = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isChecking) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return const Scaffold(body: WelcomeContent());
  }
}
```

(Same reasoning as Task 4 on the literal `'/next'` string — `AppRoutes.next` already equals `'/next'` and isn't renamed in Task 6, only `login`/`register` is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/features/welcome/welcome_page_test.dart`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add flutter_digital_sign/lib/features/welcome/presentation/pages/welcome_page.dart flutter_digital_sign/test/features/welcome/welcome_page_test.dart
git commit -m "feat: skip to document list on Welcome when an identity already exists"
```

---

### Task 6: Wire routes, update Welcome's button target, manual verification

**Files:**
- Modify: `lib/app/routes/app_routes.dart`
- Modify: `lib/features/welcome/presentation/widgets/welcome_content.dart`

**Interfaces:**
- Consumes: `RegisterPage` (Task 4).
- Produces: `AppRoutes.register` (replaces `AppRoutes.login`). Final task of this plan — after this, `flutter analyze`/`flutter test` are fully green again (Task 4 Step 7 flagged a possible transient breakage from the deleted `login_page.dart` still being referenced; this task is what actually fixes that reference).

- [ ] **Step 1: Update app_routes.dart**

Replace the contents of `lib/app/routes/app_routes.dart` with:

```dart
import 'package:flutter/material.dart';

import '../../features/register/presentation/pages/register_page.dart';
import '../../features/next/presentation/pages/document_details_page.dart';
import '../../features/next/presentation/pages/next_page.dart';
import '../../features/next/presentation/pages/signing_confirmation_page.dart';
import '../../features/welcome/presentation/pages/welcome_page.dart';

class AppRoutes {
  static const String welcome = '/';
  static const String register = '/register';
  static const String next = '/next';
  static const String documentDetails = '/document-details';
  static const String signingConfirmation = '/signing-confirmation';

  static Map<String, WidgetBuilder> get routes => {
        welcome: (context) => const WelcomePage(),
        register: (context) => const RegisterPage(),
        next: (context) => const NextPage(),
      };

  static Route<dynamic> generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case welcome:
        return MaterialPageRoute(builder: (_) => const WelcomePage());
      case register:
        return MaterialPageRoute(builder: (_) => const RegisterPage());
      case next:
        return MaterialPageRoute(builder: (_) => const NextPage());
      case documentDetails:
        final args = settings.arguments as Map<String, String>? ?? {};
        final documentName = args['documentName'] ?? 'Document.pdf';
        return MaterialPageRoute(
          builder: (_) => DocumentDetailsPage(documentName: documentName),
        );
      case signingConfirmation:
        final args = settings.arguments as Map<String, String>? ?? {};
        final documentName = args['documentName'] ?? 'Document.pdf';
        return MaterialPageRoute(
          builder: (_) => SigningConfirmationPage(documentName: documentName),
        );
      default:
        return MaterialPageRoute(builder: (_) => const WelcomePage());
    }
  }
}
```

- [ ] **Step 2: Update welcome_content.dart's button target**

In `lib/features/welcome/presentation/widgets/welcome_content.dart`, change:
```dart
onPressed: () {
  Navigator.pushNamed(context, AppRoutes.login);
},
```
to:
```dart
onPressed: () {
  Navigator.pushNamed(context, AppRoutes.register);
},
```

- [ ] **Step 3: Run the full test suite**

Run: `flutter test`
Expected: PASS — every test file passes: `document_selection_test.dart`, `signing_flow_test.dart` (existing, untouched), `ed25519_key_pair_test.dart` (3), `http_user_api_test.dart` (2), `identity_storage_test.dart` (2), `register_form_test.dart` (2), `welcome_page_test.dart` (2).

- [ ] **Step 4: Run static analysis**

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 5: Enable Windows Developer Mode if not already on**

```powershell
start ms-settings:developers
```
Turn on "Developer Mode" if it isn't already — `flutter_secure_storage` has native Windows plugin code, and `flutter run -d windows`/`flutter build windows` need symlink support to build it. (Not needed for `flutter test`, which doesn't build real platform plugins.)

- [ ] **Step 6: Manually verify against the real backend**

Make sure the backend is running first (in the `d:\DevProject\DigitalSign` repo root, not `flutter_digital_sign/`):
```bash
npm run dev
```

In a separate terminal, run the Flutter app:
```powershell
cd flutter_digital_sign
flutter run -d windows
```

Expected: the app opens showing the Welcome screen with a "Start" button (no saved identity yet). Tap "Start" → Register screen. Enter a username and a real, not-already-used email, tap "Register". Expected: the app navigates to the document list ("Documents" screen).

Confirm the registration actually happened against the real database:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U securedoc_chain_app -h localhost -d securedoc_chain -c "SELECT id, username, email FROM users ORDER BY username;"
```
Expected: the username/email you just entered appears as a real row, alongside `alice`/`bob`/`carol`.

Fully close the Flutter app window, then relaunch it (`flutter run -d windows` again). Expected: this time it skips the Welcome/Register screens entirely and goes straight to the document list — proving `IdentityStorage` persisted across a real app restart, not just in-memory.

- [ ] **Step 7: Commit**

```bash
git add flutter_digital_sign/lib/app/routes/app_routes.dart flutter_digital_sign/lib/features/welcome/presentation/widgets/welcome_content.dart
git commit -m "feat: wire real registration into app routing"
```

---

## Post-plan state

After Task 6, the Flutter app has its first real (non-mockup) feature: a user can register with a real Ed25519 keypair generated on-device, the public key is sent to the real backend and persisted in Postgres, and the private key + userId are stored securely on the device — surviving an app restart, at which point the Welcome screen skips straight past registration. Everything else (document list, upload, signing, verification) remains a static mockup, each its own future sub-project.
