// src/domain/value-objects/PublicKey.test.ts
import { describe, it, expect } from 'vitest'
import { PublicKey } from './PublicKey'

function validPublicKeyBytes(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => i + 1)
}

describe('PublicKey', () => {
  it('creates a valid public key from 32 bytes', () => {
    const bytes = validPublicKeyBytes()
    const result = PublicKey.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = PublicKey.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('PublicKey')
  })

  it('rejects a byte array that is too short', () => {
    const result = PublicKey.create(new Uint8Array(31))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('32')
  })

  it('rejects a byte array that is too long', () => {
    const result = PublicKey.create(new Uint8Array(33))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('32')
  })

  it('is immutable to mutations via caller-supplied array', () => {
    const originalBytes = validPublicKeyBytes()
    const publicKey = PublicKey.create(originalBytes).value
    const originalValue = Array.from(publicKey.toBytes())

    originalBytes[0] = 99
    originalBytes[1] = 88

    const afterMutation = publicKey.toBytes()
    expect(afterMutation).toEqual(new Uint8Array(originalValue))
  })

  it('is immutable to mutations via toBytes() return value', () => {
    const bytes = validPublicKeyBytes()
    const publicKey = PublicKey.create(bytes).value

    const returnedArray = publicKey.toBytes()
    returnedArray[0] = 99
    returnedArray[1] = 88

    const secondCall = publicKey.toBytes()
    expect(secondCall).toEqual(bytes)
    expect(secondCall[0]).toBe(1)
    expect(secondCall[1]).toBe(2)
  })

  it('equals compares by byte value', () => {
    const a = PublicKey.create(validPublicKeyBytes()).value
    const b = PublicKey.create(validPublicKeyBytes()).value
    const differentBytes = validPublicKeyBytes()
    differentBytes[31] = 255
    const c = PublicKey.create(differentBytes).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
