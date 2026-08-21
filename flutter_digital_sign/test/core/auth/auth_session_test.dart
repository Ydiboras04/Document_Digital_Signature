import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'package:flutter_digital_sign/core/network/auth_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import '../network/fake_auth_api.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<IdentityStorage> storageWithIdentity() async {
    final storage = IdentityStorage();
    await storage.save('user-1', List<int>.filled(32, 1), List<int>.generate(32, (i) => i));
    return storage;
  }

  test('performs the handshake and returns the token', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => 'token-abc');
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    final token = await session.token();

    expect(token, 'token-abc');
    expect(fakeAuthApi.challengeCalls, ['user-1']);
    expect(fakeAuthApi.tokenCalls, hasLength(1));
    expect(fakeAuthApi.tokenCalls.first.userId, 'user-1');
    expect(fakeAuthApi.tokenCalls.first.signature, hasLength(64));
  });

  test('signs the context-prefixed digest, not the raw challenge', () async {
    final identityStorage = await storageWithIdentity();
    final challenge = List<int>.generate(32, (i) => 200 - i);
    final fakeAuthApi = FakeAuthApi()..onRequestChallenge = ((userId) => challenge);
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    await session.token();

    final identity = (await identityStorage.load())!;
    final keyPair = await Ed25519().newKeyPairFromSeed(identity.privateKeyBytes);
    final publicKey = await keyPair.extractPublicKey();
    final signature = Signature(
      fakeAuthApi.tokenCalls.first.signature,
      publicKey: publicKey,
    );

    final expected = await Sha256().hash([...utf8.encode(authChallengeContext), ...challenge]);
    expect(await Ed25519().verify(expected.bytes, signature: signature), isTrue);

    // The regression guard: the signature must not be valid over the raw
    // challenge bytes, which is what the document-signing flow signs.
    expect(await Ed25519().verify(challenge, signature: signature), isFalse);
  });

  test('caches the token so a second call performs no new handshake', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi();
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    await session.token();
    await session.token();

    expect(fakeAuthApi.challengeCalls, hasLength(1));
    expect(fakeAuthApi.tokenCalls, hasLength(1));
  });

  test('invalidate forces a fresh handshake on the next call', () async {
    final identityStorage = await storageWithIdentity();
    var issued = 0;
    final fakeAuthApi = FakeAuthApi()
      ..onExchangeForToken = ((userId, signature) => 'token-${++issued}');
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    final first = await session.token();
    session.invalidate();
    final second = await session.token();

    expect(first, 'token-1');
    expect(second, 'token-2');
    expect(fakeAuthApi.challengeCalls, hasLength(2));
  });

  test('throws UnknownIdentityException when no identity is stored', () async {
    final fakeAuthApi = FakeAuthApi();
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: IdentityStorage());

    expect(() => session.token(), throwsA(isA<UnknownIdentityException>()));
    expect(fakeAuthApi.challengeCalls, isEmpty);
  });

  test('propagates UnknownIdentityException when the server does not know the identity', () async {
    final identityStorage = await storageWithIdentity();
    final fakeAuthApi = FakeAuthApi()
      ..onRequestChallenge = ((userId) => throw UnknownIdentityException());
    final session = AuthSession(authApi: fakeAuthApi, identityStorage: identityStorage);

    expect(() => session.token(), throwsA(isA<UnknownIdentityException>()));
  });
}
