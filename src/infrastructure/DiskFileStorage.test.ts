import { describe, it, expect, afterEach } from 'vitest'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DiskFileStorage } from './DiskFileStorage.js'

const createdFiles: string[] = []

afterEach(async () => {
  await Promise.all(createdFiles.map((path) => unlink(path).catch(() => {})))
  createdFiles.length = 0
})

describe('DiskFileStorage', () => {
  it('returns a non-empty string key when storing bytes', async () => {
    const storage = new DiskFileStorage()

    const key = await storage.store(new Uint8Array([1, 2, 3]))
    createdFiles.push(join('./uploads', key))

    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('returns different keys for different store calls', async () => {
    const storage = new DiskFileStorage()

    const key1 = await storage.store(new Uint8Array([1, 2, 3]))
    createdFiles.push(join('./uploads', key1))
    const key2 = await storage.store(new Uint8Array([4, 5, 6]))
    createdFiles.push(join('./uploads', key2))

    expect(key1).not.toBe(key2)
  })

  it('writes the exact bytes to disk under the returned key', async () => {
    const storage = new DiskFileStorage()
    const bytes = new Uint8Array([10, 20, 30, 40])

    const key = await storage.store(bytes)
    const filePath = join('./uploads', key)
    createdFiles.push(filePath)

    const written = await readFile(filePath)
    expect(new Uint8Array(written)).toEqual(bytes)
  })
})
