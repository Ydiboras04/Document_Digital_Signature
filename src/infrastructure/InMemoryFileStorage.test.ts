import { describe, it, expect } from 'vitest'
import { InMemoryFileStorage } from './InMemoryFileStorage.js'

describe('InMemoryFileStorage', () => {
  it('returns a non-empty string key when storing bytes', async () => {
    const storage = new InMemoryFileStorage()

    const key = await storage.store(new Uint8Array([1, 2, 3]))

    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('returns different keys for different store calls', async () => {
    const storage = new InMemoryFileStorage()

    const key1 = await storage.store(new Uint8Array([1, 2, 3]))
    const key2 = await storage.store(new Uint8Array([4, 5, 6]))

    expect(key1).not.toBe(key2)
  })
})
