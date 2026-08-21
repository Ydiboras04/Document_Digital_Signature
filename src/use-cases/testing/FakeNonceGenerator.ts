import { NonceGenerator } from '../ports/NonceGenerator.js'

export class FakeNonceGenerator implements NonceGenerator {
  constructor(private readonly nonce: Uint8Array = new Uint8Array(32).fill(3)) {}

  generate(): Uint8Array {
    return new Uint8Array(this.nonce)
  }
}
