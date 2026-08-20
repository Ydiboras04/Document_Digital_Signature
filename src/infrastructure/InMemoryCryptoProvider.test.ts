import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'

describe('InMemoryCryptoProvider.hash', () => {
  it('matches a known SHA-256 digest', () => {
    const crypto = new InMemoryCryptoProvider()
    const data = new TextEncoder().encode('hello world')

    const result = crypto.hash(data)

    const expectedDigest = createHash('sha256').update(data).digest()
    expect(result.toBytes()).toEqual(new Uint8Array(expectedDigest))
  })
})

describe('InMemoryCryptoProvider.verify', () => {
  it('returns true for a signature computed via the documented placeholder scheme', () => {
    const crypto = new InMemoryCryptoProvider()
    const publicKey = PublicKey.create(new Uint8Array([1, 2, 3])).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))

    const combined = new Uint8Array(publicKey.toBytes().length + message.toBytes().length)
    combined.set(publicKey.toBytes(), 0)
    combined.set(message.toBytes(), publicKey.toBytes().length)
    const signature = SignatureBytes.create(crypto.hash(combined).toBytes()).value

    expect(crypto.verify(publicKey, message, signature)).toBe(true)
  })

  it('returns false for a mismatched signature', () => {
    const crypto = new InMemoryCryptoProvider()
    const publicKey = PublicKey.create(new Uint8Array([1, 2, 3])).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))
    const wrongSignature = SignatureBytes.create(new Uint8Array(32).fill(9)).value

    expect(crypto.verify(publicKey, message, wrongSignature)).toBe(false)
  })
})
