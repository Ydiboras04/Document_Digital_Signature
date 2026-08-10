import { DomainError } from './DomainError'

export class BrokenChainError extends DomainError {
  constructor(signatureId: string, reason: string) {
    super(`Signature chain broken at signature ${signatureId}: ${reason}`)
  }
}
