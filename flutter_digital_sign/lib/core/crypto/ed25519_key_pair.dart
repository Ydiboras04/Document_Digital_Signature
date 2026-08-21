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
