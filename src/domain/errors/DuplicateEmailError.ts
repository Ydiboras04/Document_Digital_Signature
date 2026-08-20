import { DomainError } from './DomainError.js'

export class DuplicateEmailError extends DomainError {
  constructor(email: string) {
    super(`Email ${email} is already registered`)
  }
}
