import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

export class PublicKey {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<PublicKey, InvalidValueError> {
    if (bytes.length === 0) {
      return Result.fail(new InvalidValueError('PublicKey', 'must not be empty'))
    }
    return Result.ok(new PublicKey(new Uint8Array(bytes)))
  }

  toBytes(): Uint8Array {
    return this.bytes.slice()
  }
}
