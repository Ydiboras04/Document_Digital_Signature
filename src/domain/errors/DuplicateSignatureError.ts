import { DomainError } from './DomainError'

export class DuplicateSignatureError extends DomainError {
  constructor(userId: string) {
    super(`User ${userId} has already signed this document`)
  }
}
