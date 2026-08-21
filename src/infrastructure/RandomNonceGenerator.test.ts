import { describe, it, expect } from 'vitest'
import { RandomNonceGenerator } from './RandomNonceGenerator.js'

describe('RandomNonceGenerator', () => {
  it('generates 32 bytes', () => {
    const generator = new RandomNonceGenerator()

    expect(generator.generate().length).toBe(32)
  })

  it('generates a different nonce each call', () => {
    const generator = new RandomNonceGenerator()

    expect(generator.generate()).not.toEqual(generator.generate())
  })
})
