import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { Hash } from '../domain/value-objects/Hash.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'
import { CryptoProvider } from '../domain/ports/CryptoProvider.js'

export class Ed25519CryptoProvider implements CryptoProvider {
  hash(data: Uint8Array): Hash {
    const digest = createHash('sha256').update(data).digest()
    return Hash.create(new Uint8Array(digest)).value
  }

  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean {
    const keyObject = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey.toBytes()).toString('base64url') },
      format: 'jwk'
    })
    return cryptoVerify(null, message.toBytes(), keyObject, signature.toBytes())
  }
}
