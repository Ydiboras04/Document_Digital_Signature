import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

const ED25519_SIGNATURE_BYTE_LENGTH = 64

export class SignatureBytes {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<SignatureBytes, InvalidValueError> {
    if (bytes.length !== ED25519_SIGNATURE_BYTE_LENGTH) {
      return Result.fail(
        new InvalidValueError(
          'SignatureBytes',
          `must be exactly ${ED25519_SIGNATURE_BYTE_LENGTH} bytes (Ed25519 signature), got ${bytes.length}`
        )
      )
    }
    return Result.ok(new SignatureBytes(new Uint8Array(bytes)))
  }

  toBytes(): Uint8Array {
    return this.bytes.slice()
  }

  equals(other: SignatureBytes): boolean {
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
