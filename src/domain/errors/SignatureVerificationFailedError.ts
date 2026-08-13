import { DomainError } from './DomainError.js'

export class SignatureVerificationFailedError extends DomainError {
  constructor(userId: string, documentId: string) {
    super(`Signature verification failed for user ${userId} on document ${documentId}`)
  }
}
