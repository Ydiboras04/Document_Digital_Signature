import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

const ED25519_PUBLIC_KEY_BYTE_LENGTH = 32

export class PublicKey {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<PublicKey, InvalidValueError> {
    if (bytes.length !== ED25519_PUBLIC_KEY_BYTE_LENGTH) {
      return Result.fail(
        new InvalidValueError(
          'PublicKey',
          `must be exactly ${ED25519_PUBLIC_KEY_BYTE_LENGTH} bytes (Ed25519 public key), got ${bytes.length}`
        )
      )
    }
    return Result.ok(new PublicKey(new Uint8Array(bytes)))
  }

  toBytes(): Uint8Array {
    return this.bytes.slice()
  }

  equals(other: PublicKey): boolean {
    if (this.bytes.length !== other.bytes.length) {
      return false
    }
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== other.bytes[i]) {
        return false
      }
    }
    return true
  }
}
