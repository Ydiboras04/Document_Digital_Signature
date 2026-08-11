import { DomainError } from './DomainError'

export class InvalidSignatureError extends DomainError {
  constructor(reason: string) {
    super(`Invalid Signature: ${reason}`)
  }
}
