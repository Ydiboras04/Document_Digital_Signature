// src/domain/value-objects/SignatureBytes.test.ts
import { describe, it, expect } from 'vitest'
import { SignatureBytes } from './SignatureBytes'

describe('SignatureBytes', () => {
  it('creates valid signature bytes from a non-empty array', () => {
    const bytes = new Uint8Array([9, 8, 7])
    const result = SignatureBytes.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = SignatureBytes.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('SignatureBytes')
  })

  it('is immutable to mutations via caller-supplied array', () => {
    const originalBytes = new Uint8Array([9, 8, 7, 6])
    const signatureBytes = SignatureBytes.create(originalBytes).value
    const originalValue = Array.from(signatureBytes.toBytes())

    // Mutate the original array after SignatureBytes creation
    originalBytes[0] = 99
    originalBytes[1] = 88

    // SignatureBytes should be unaffected
    const afterMutation = signatureBytes.toBytes()
    expect(afterMutation).toEqual(new Uint8Array(originalValue))
  })

  it('is immutable to mutations via toBytes() return value', () => {
    const bytes = new Uint8Array([9, 8, 7, 6])
    const signatureBytes = SignatureBytes.create(bytes).value

    // Mutate the array returned by toBytes()
    const returnedArray = signatureBytes.toBytes()
    returnedArray[0] = 99
    returnedArray[1] = 88

    // SignatureBytes's toBytes() should still return the original bytes
    const secondCall = signatureBytes.toBytes()
    expect(secondCall).toEqual(bytes)
    expect(secondCall[0]).toBe(9)
    expect(secondCall[1]).toBe(8)
  })

  it('equals compares by byte value', () => {
    const a = SignatureBytes.create(new Uint8Array([1, 2, 3, 4])).value
    const b = SignatureBytes.create(new Uint8Array([1, 2, 3, 4])).value
    const c = SignatureBytes.create(new Uint8Array([1, 2, 3, 5])).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
