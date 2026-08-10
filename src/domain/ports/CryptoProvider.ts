import { Hash } from '../value-objects/Hash'
import { PublicKey } from '../value-objects/PublicKey'
import { SignatureBytes } from '../value-objects/SignatureBytes'

export interface CryptoProvider {
  hash(data: Uint8Array): Hash
  verify(publicKey: PublicKey, message: Hash, signature: SignatureBytes): boolean
}
