import { Result } from '../result/Result'
import { InvalidValueError } from '../errors/InvalidValueError'

const SHA256_BYTE_LENGTH = 32

export class Hash {
  private constructor(private readonly bytes: Uint8Array) {}

  static create(bytes: Uint8Array): Result<Hash, InvalidValueError> {
    if (bytes.length !== SHA256_BYTE_LENGTH) {
      return Result.fail(
        new InvalidValueError('Hash', `must be exactly ${SHA256_BYTE_LENGTH} bytes (SHA-256 output), got ${bytes.length}`)
      )
    }
    return Result.ok(new Hash(new Uint8Array(bytes)))
  }

  toBytes(): Uint8Array {
    return this.bytes.slice()
  }

  toHex(): string {
    return Array.from(this.bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  equals(other: Hash): boolean {
    return this.toHex() === other.toHex()
  }
}
