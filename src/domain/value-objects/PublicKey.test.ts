// src/domain/value-objects/PublicKey.test.ts
import { describe, it, expect } from 'vitest'
import { PublicKey } from './PublicKey'

describe('PublicKey', () => {
  it('creates a valid public key from non-empty bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const result = PublicKey.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects an empty byte array', () => {
    const result = PublicKey.create(new Uint8Array(0))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('PublicKey')
  })

  it('is immutable to mutations via caller-supplied array', () => {
    const originalBytes = new Uint8Array([1, 2, 3, 4])
    const publicKey = PublicKey.create(originalBytes).value
    const originalValue = Array.from(publicKey.toBytes())

    // Mutate the original array after PublicKey creation
    originalBytes[0] = 99
    originalBytes[1] = 88

    // PublicKey should be unaffected
    const afterMutation = publicKey.toBytes()
    expect(afterMutation).toEqual(new Uint8Array(originalValue))
  })

  it('is immutable to mutations via toBytes() return value', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const publicKey = PublicKey.create(bytes).value

    // Mutate the array returned by toBytes()
    const returnedArray = publicKey.toBytes()
    returnedArray[0] = 99
    returnedArray[1] = 88

    // PublicKey's toBytes() should still return the original bytes
    const secondCall = publicKey.toBytes()
    expect(secondCall).toEqual(bytes)
    expect(secondCall[0]).toBe(1)
    expect(secondCall[1]).toBe(2)
  })

  it('equals compares by byte value', () => {
    const a = PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
    const b = PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
    const c = PublicKey.create(new Uint8Array([1, 2, 3, 5])).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
