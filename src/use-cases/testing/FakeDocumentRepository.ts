import { Document } from '../../domain/entities/Document.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'

export class FakeDocumentRepository implements DocumentRepository {
  readonly savedDocuments: Document[] = []

  async save(document: Document): Promise<void> {
    this.savedDocuments.push(document)
  }

  async findById(id: string): Promise<Document | null> {
    return this.savedDocuments.find((d) => d.id === id) ?? null
  }
}
