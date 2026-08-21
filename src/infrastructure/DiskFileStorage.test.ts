import { describe, it, expect, afterEach } from 'vitest'
import { readFile, unlink } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  it('writes into a directory supplied to the constructor', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'disk-file-storage-'))
    const storage = new DiskFileStorage(directory)

    const key = await storage.store(new Uint8Array([7, 8, 9]))

    // The point of the parameter: nothing lands in the default ./uploads.
    // The test suite relies on this to keep the repo's uploads directory
    // clean, so it is worth asserting rather than assuming.
    const written = await readFile(join(directory, key))
    expect(new Uint8Array(written)).toEqual(new Uint8Array([7, 8, 9]))

    rmSync(directory, { recursive: true, force: true })
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
