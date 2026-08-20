import { describe, it, expect } from 'vitest'
import { RandomIdGenerator } from './RandomIdGenerator.js'

describe('RandomIdGenerator', () => {
  it('generates a non-empty string', () => {
    const generator = new RandomIdGenerator()

    const id = generator.generate()

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('generates different values on consecutive calls', () => {
    const generator = new RandomIdGenerator()

    const first = generator.generate()
    const second = generator.generate()

    expect(first).not.toBe(second)
  })
})
