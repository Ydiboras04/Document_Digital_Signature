import { DomainError } from './DomainError.js'

export class DocumentNotFoundError extends DomainError {
  constructor(documentId: string) {
    super(`Document ${documentId} was not found`)
  }
}
