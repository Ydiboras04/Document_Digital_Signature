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

  test('clear removes the saved identity', () async {
    final storage = IdentityStorage();
    await storage.save('user-123', [1, 2, 3], [4, 5, 6]);

    await storage.clear();

    expect(await storage.load(), isNull);
  });
}
