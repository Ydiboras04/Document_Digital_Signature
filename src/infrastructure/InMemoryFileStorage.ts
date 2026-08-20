import { randomUUID } from 'node:crypto'
import { FileStorage } from '../use-cases/ports/FileStorage.js'

export class InMemoryFileStorage implements FileStorage {
  private readonly files = new Map<string, Uint8Array>()

  async store(bytes: Uint8Array): Promise<string> {
    const key = randomUUID()
    this.files.set(key, bytes)
    return key
  }
}
