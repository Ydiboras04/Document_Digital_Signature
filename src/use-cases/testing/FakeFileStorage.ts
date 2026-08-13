import { FileStorage } from '../ports/FileStorage.js'

export class FakeFileStorage implements FileStorage {
  readonly stored: Uint8Array[] = []

  async store(bytes: Uint8Array): Promise<string> {
    this.stored.push(bytes)
    return `fake-storage/${this.stored.length}`
  }
}
