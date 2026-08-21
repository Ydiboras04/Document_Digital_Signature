import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_digital_sign/core/crypto/ed25519_key_pair.dart';
import 'package:cryptography/cryptography.dart';

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

  test('sign produces a signature that verifies against the public key', () async {
    final keyPair = await Ed25519KeyPair.generate();
    final privateKeyBytes = await keyPair.extractPrivateKeyBytes();
    final message = [1, 2, 3, 4, 5];

    final signatureBytes = await Ed25519KeyPair.sign(privateKeyBytes, message);

    final algorithm = Ed25519();
    final publicKey = SimplePublicKey(keyPair.publicKeyBytes, type: KeyPairType.ed25519);
    final isValid = await algorithm.verify(
      message,
      signature: Signature(signatureBytes, publicKey: publicKey),
    );
    expect(isValid, true);
  });
}
