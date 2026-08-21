export interface NonceGenerator {
  /** Returns exactly 32 cryptographically random bytes. */
  generate(): Uint8Array
}
