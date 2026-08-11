import { DomainError } from './DomainError'

export class InvalidDocumentError extends DomainError {
  constructor(reason: string) {
    super(`Invalid Document: ${reason}`)
  }
}
