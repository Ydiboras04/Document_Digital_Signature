import 'dart:convert';

import 'package:cryptography/cryptography.dart';

import '../crypto/ed25519_key_pair.dart';
import '../network/auth_api.dart';
import '../storage/identity_storage.dart';

/// Domain-separation prefix mixed into every auth challenge before it is
/// hashed and signed.
///
/// The same Ed25519 key signs both auth challenges and document payloads, and
/// both are 32 bytes. Without this prefix a malicious `POST /auth/challenge`
/// response could hand the client a document's signing payload and harvest a
/// chain-valid document signature from a user who never consented. Applying
/// the prefix here -- and never in the document-signing flow -- makes an auth
/// signature unusable as a document signature.
///
/// The backend applies the identical transformation in
/// `src/domain/auth/authChallengeContext.ts`; the two must change together.
const String authChallengeContext = 'SecureDocChain-auth-challenge-v1';

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
    final prefixBytes = utf8.encode(authChallengeContext);
    final digest = await Sha256().hash([...prefixBytes, ...challenge]);
    final signature = await Ed25519KeyPair.sign(identity.privateKeyBytes, digest.bytes);
    final token = await _authApi.exchangeForToken(identity.userId, signature);

    _token = token;
    return token;
  }

  void invalidate() {
    _token = null;
  }
}
