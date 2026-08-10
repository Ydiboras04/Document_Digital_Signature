import { DomainError } from './DomainError'

export class InvalidValueError extends DomainError {
  constructor(field: string, reason: string) {
    super(`Invalid ${field}: ${reason}`)
  }
}
