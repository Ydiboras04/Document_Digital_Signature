// src/domain/value-objects/SignatureBytes.test.ts
import { describe, it, expect } from 'vitest'
import { SignatureBytes } from './SignatureBytes'

function validSignatureBytes(): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => i + 1)
}

describe('SignatureBytes', () => {
  it('creates valid signature bytes from 64 bytes', () => {
    const bytes = validSignatureBytes()
    const result = SignatureBytes.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = SignatureBytes.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('SignatureBytes')
  })

  it('rejects a byte array that is too short', () => {
    const result = SignatureBytes.create(new Uint8Array(63))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('64')
  })

  it('rejects a byte array that is too long', () => {
    const result = SignatureBytes.create(new Uint8Array(65))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('64')
  })

  it('is immutable to mutations via caller-supplied array', () => {
    const originalBytes = validSignatureBytes()
    const signatureBytes = SignatureBytes.create(originalBytes).value
    const originalValue = Array.from(signatureBytes.toBytes())

    originalBytes[0] = 99
    originalBytes[1] = 88

    const afterMutation = signatureBytes.toBytes()
    expect(afterMutation).toEqual(new Uint8Array(originalValue))
  })

  it('is immutable to mutations via toBytes() return value', () => {
    const bytes = validSignatureBytes()
    const signatureBytes = SignatureBytes.create(bytes).value

    const returnedArray = signatureBytes.toBytes()
    returnedArray[0] = 99
    returnedArray[1] = 88

    const secondCall = signatureBytes.toBytes()
    expect(secondCall).toEqual(bytes)
    expect(secondCall[0]).toBe(1)
    expect(secondCall[1]).toBe(2)
  })

  it('equals compares by byte value', () => {
    const a = SignatureBytes.create(validSignatureBytes()).value
    const b = SignatureBytes.create(validSignatureBytes()).value
    const differentBytes = validSignatureBytes()
    differentBytes[63] = 255
    const c = SignatureBytes.create(differentBytes).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
