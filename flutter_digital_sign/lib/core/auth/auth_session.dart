import '../crypto/ed25519_key_pair.dart';
import '../network/auth_api.dart';
import '../storage/identity_storage.dart';

/// Obtains and caches a session token by proving possession of this device's
/// Ed25519 private key.
///
/// The token is held in memory only, never written to secure storage:
/// re-authenticating costs one round trip and needs no user interaction, so
/// persisting a bearer token would add attack surface and buy nothing.
class AuthSession {
  final AuthApi _authApi;
  final IdentityStorage _identityStorage;
  String? _token;

  AuthSession({
    required this._authApi,
    required this._identityStorage,
  });

  Future<String> token() async {
    final cached = _token;
    if (cached != null) {
      return cached;
    }

    final identity = await _identityStorage.load();
    if (identity == null) {
      throw UnknownIdentityException();
    }

    final challenge = await _authApi.requestChallenge(identity.userId);
    final signature = await Ed25519KeyPair.sign(identity.privateKeyBytes, challenge);
    final token = await _authApi.exchangeForToken(identity.userId, signature);

    _token = token;
    return token;
  }

  void invalidate() {
    _token = null;
  }
}
