import { Document } from '../../domain/entities/Document.js'

export interface DocumentRepository {
  save(document: Document): Promise<void>
}
