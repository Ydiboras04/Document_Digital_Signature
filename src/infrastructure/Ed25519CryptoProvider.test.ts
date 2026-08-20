import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { Ed25519CryptoProvider } from './Ed25519CryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'
import { ed25519TestKeys, signWithTestKey } from './testing/ed25519TestKeys.js'

describe('Ed25519CryptoProvider.hash', () => {
  it('matches a known SHA-256 digest', () => {
    const crypto = new Ed25519CryptoProvider()
    const data = new TextEncoder().encode('hello world')

    const result = crypto.hash(data)

    const expectedDigest = createHash('sha256').update(data).digest()
    expect(result.toBytes()).toEqual(new Uint8Array(expectedDigest))
  })
})

describe('Ed25519CryptoProvider.verify', () => {
  it('returns true for a signature produced with the matching private key', () => {
    const crypto = new Ed25519CryptoProvider()
    const publicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))

    const signatureBytes = signWithTestKey(ed25519TestKeys.alice, message.toBytes())
    const signature = SignatureBytes.create(signatureBytes).value

    expect(crypto.verify(publicKey, message, signature)).toBe(true)
  })

  it('returns false for a signature produced with a different private key', () => {
    const crypto = new Ed25519CryptoProvider()
    const alicePublicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))

    const bobSignatureBytes = signWithTestKey(ed25519TestKeys.bob, message.toBytes())
    const signature = SignatureBytes.create(bobSignatureBytes).value

    expect(crypto.verify(alicePublicKey, message, signature)).toBe(false)
  })

  it('returns false for a signature over a different message', () => {
    const crypto = new Ed25519CryptoProvider()
    const publicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))
    const differentMessage = crypto.hash(new TextEncoder().encode('a different document hash'))

    const signatureBytes = signWithTestKey(ed25519TestKeys.alice, differentMessage.toBytes())
    const signature = SignatureBytes.create(signatureBytes).value

    expect(crypto.verify(publicKey, message, signature)).toBe(false)
  })

  it('returns false for random 64 bytes', () => {
    const crypto = new Ed25519CryptoProvider()
    const publicKey = PublicKey.create(ed25519TestKeys.alice.publicKeyBytes).value
    const message = crypto.hash(new TextEncoder().encode('document hash'))
    const randomSignature = SignatureBytes.create(new Uint8Array(64).fill(9)).value

    expect(crypto.verify(publicKey, message, randomSignature)).toBe(false)
  })
})
