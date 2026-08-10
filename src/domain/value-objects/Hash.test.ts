// src/domain/value-objects/Hash.test.ts
import { describe, it, expect } from 'vitest'
import { Hash } from './Hash'

describe('Hash', () => {
  it('creates a valid 32-byte hash', () => {
    const bytes = new Uint8Array(32).fill(1)
    const result = Hash.create(bytes)
    expect(result.isOk()).toBe(true)
    expect(result.value.toBytes()).toEqual(bytes)
  })

  it('rejects a hash that is not 32 bytes', () => {
    const result = Hash.create(new Uint8Array(10))
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('32 bytes')
  })

  it('toHex renders lowercase hex', () => {
    const bytes = new Uint8Array([0, 255, 16])
    const result = Hash.create(new Uint8Array(32).fill(0).map((_, i) => (i < 3 ? bytes[i] : 0)))
    expect(result.value.toHex().startsWith('00ff10')).toBe(true)
  })

  it('equals compares by byte value', () => {
    const a = Hash.create(new Uint8Array(32).fill(7)).value
    const b = Hash.create(new Uint8Array(32).fill(7)).value
    const c = Hash.create(new Uint8Array(32).fill(8)).value
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
