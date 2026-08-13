import { DomainError } from './DomainError.js'

export class UserNotFoundError extends DomainError {
  constructor(userId: string) {
    super(`User ${userId} was not found`)
  }
}
