import { createHash } from 'node:crypto'
import { Hash } from '../domain/value-objects/Hash.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'
import { CryptoProvider } from '../domain/ports/CryptoProvider.js'

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

// hash() is real SHA-256. verify() is NOT real cryptography -- it's a
// deterministic placeholder (SHA256(publicKey + message) compared to the
// given signature) until a real signature scheme (e.g. Ed25519) is built,
// once there's an actual mobile client producing real signatures.
export class InMemoryCryptoProvider implements CryptoProvider {
  hash(data: Uint8Array): Hash {
    const digest = createHash('sha256').update(data).digest()
    return Hash.create(new Uint8Array(digest)).value
  }

  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean {
    const combined = concatBytes(publicKey.toBytes(), message.toBytes())
    const expected = SignatureBytes.create(this.hash(combined).toBytes()).value
    return expected.equals(signature)
  }
}
