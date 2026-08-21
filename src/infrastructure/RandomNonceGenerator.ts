import { randomBytes } from 'node:crypto'
import { NonceGenerator } from '../use-cases/ports/NonceGenerator.js'

const NONCE_BYTE_LENGTH = 32

export class RandomNonceGenerator implements NonceGenerator {
  generate(): Uint8Array {
    return new Uint8Array(randomBytes(NONCE_BYTE_LENGTH))
  }
}
