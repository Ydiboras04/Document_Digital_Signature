import { Document } from '../domain/entities/Document.js'
import { DocumentRepository } from '../use-cases/ports/DocumentRepository.js'

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents: Document[] = []

  async save(document: Document): Promise<void> {
    this.documents.push(document)
  }

  async findById(id: string): Promise<Document | null> {
    return this.documents.find((d) => d.id === id) ?? null
  }
}
