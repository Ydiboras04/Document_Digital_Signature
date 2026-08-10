import { DomainError } from './DomainError'

export class InvalidUserError extends DomainError {
  constructor(reason: string) {
    super(`Invalid User: ${reason}`)
  }
}
