import { CryptoProvider } from '../ports/CryptoProvider'
import { Hash } from '../value-objects/Hash'
import { PublicKey } from '../value-objects/PublicKey'
import { SignatureBytes } from '../value-objects/SignatureBytes'

/**
 * Deterministic in-memory CryptoProvider for domain tests.
 * hash() is a simple 32-byte fold of the input, not cryptographically secure.
 * verify() returns true iff the signature bytes equal hash(publicKey.bytes + message.bytes) --
 * tests build matching "signatures" with `sign()` below.
 */
export class FakeCryptoProvider implements CryptoProvider {
  hash(data: Uint8Array): Hash {
    const out = new Uint8Array(32)
    for (let i = 0; i < data.length; i++) {
      out[i % 32] ^= data[i]
    }
    return Hash.create(out).value
  }

  sign(publicKey: PublicKey, message: Hash): SignatureBytes {
    const combined = new Uint8Array(publicKey.toBytes().length + message.toBytes().length)
    combined.set(publicKey.toBytes(), 0)
    combined.set(message.toBytes(), publicKey.toBytes().length)
    return SignatureBytes.create(this.hash(combined).toBytes()).value
  }

  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean {
    const expected = this.sign(publicKey, message)
    return expected.equals(signature)
  }
}
