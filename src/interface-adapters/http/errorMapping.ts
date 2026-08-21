import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DomainError } from '../../domain/errors/DomainError.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'

export interface ErrorResponse {
  status: ContentfulStatusCode
  body: { error: { type: string; message: string } }
}

export function mapDomainErrorToResponse(error: DomainError): ErrorResponse {
  return {
    status: statusForError(error),
    body: { error: { type: error.constructor.name, message: error.message } }
  }
}

function statusForError(error: DomainError): ContentfulStatusCode {
  if (error instanceof InvalidDocumentError) return 400
  if (error instanceof InvalidValueError) return 400
  if (error instanceof InvalidSignatureError) return 400
  if (error instanceof InvalidUserError) return 400
  if (error instanceof DocumentNotFoundError) return 404
  if (error instanceof UserNotFoundError) return 404
  if (error instanceof DuplicateSignatureError) return 409
  if (error instanceof DuplicateEmailError) return 409
  if (error instanceof AuthenticationFailedError) return 401
  if (error instanceof SignatureVerificationFailedError) return 422
  return 500
}
