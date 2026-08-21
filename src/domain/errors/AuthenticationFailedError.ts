import { DomainError } from './DomainError.js'

/**
 * Deliberately generic. Issued for a missing challenge, an expired challenge,
 * and a signature that does not verify alike, so a 401 response never reveals
 * which of those conditions actually failed.
 */
export class AuthenticationFailedError extends DomainError {
  constructor() {
    super('Authentication failed')
  }
}
