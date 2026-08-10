import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

export class SignatureBytes {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<SignatureBytes, InvalidValueError> {
    if (bytes.length === 0) {
      return Result.fail(new InvalidValueError('SignatureBytes', 'must not be empty'))
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
