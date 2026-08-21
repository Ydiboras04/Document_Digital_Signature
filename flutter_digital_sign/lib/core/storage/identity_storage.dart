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
