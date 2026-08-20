import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileStorage } from '../use-cases/ports/FileStorage.js'

export class DiskFileStorage implements FileStorage {
  constructor(private readonly directory: string = './uploads') {
    mkdirSync(this.directory, { recursive: true })
  }

  async store(bytes: Uint8Array): Promise<string> {
    const key = randomUUID()
    await writeFile(join(this.directory, key), bytes)
    return key
  }
}
