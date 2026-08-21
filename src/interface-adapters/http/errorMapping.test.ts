import { describe, it, expect } from 'vitest'
import { mapDomainErrorToResponse } from './errorMapping.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'
import { BrokenChainError } from '../../domain/errors/BrokenChainError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'

describe('mapDomainErrorToResponse', () => {
  it('maps InvalidDocumentError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidDocumentError('title must not be empty'))
    expect(result.status).toBe(400)
    expect(result.body.error.type).toBe('InvalidDocumentError')
    expect(result.body.error.message).toContain('title must not be empty')
  })

  it('maps InvalidValueError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidValueError('SignatureBytes', 'must not be empty'))
    expect(result.status).toBe(400)
  })

  it('maps InvalidSignatureError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidSignatureError('id must not be empty'))
    expect(result.status).toBe(400)
  })

  it('maps InvalidUserError to 400', () => {
    const result = mapDomainErrorToResponse(new InvalidUserError('username must not be empty'))
    expect(result.status).toBe(400)
  })

  it('maps DocumentNotFoundError to 404', () => {
    const result = mapDomainErrorToResponse(new DocumentNotFoundError('doc-1'))
    expect(result.status).toBe(404)
    expect(result.body.error.type).toBe('DocumentNotFoundError')
  })

  it('maps UserNotFoundError to 404', () => {
    const result = mapDomainErrorToResponse(new UserNotFoundError('user-1'))
    expect(result.status).toBe(404)
  })

  it('maps DuplicateSignatureError to 409', () => {
    const result = mapDomainErrorToResponse(new DuplicateSignatureError('user-1'))
    expect(result.status).toBe(409)
  })

  it('maps DuplicateEmailError to 409', () => {
    const result = mapDomainErrorToResponse(new DuplicateEmailError('taken@example.com'))
    expect(result.status).toBe(409)
  })

  it('maps SignatureVerificationFailedError to 422', () => {
    const result = mapDomainErrorToResponse(new SignatureVerificationFailedError('user-1', 'doc-1'))
    expect(result.status).toBe(422)
  })

  it('maps AuthenticationFailedError to 401', () => {
    const result = mapDomainErrorToResponse(new AuthenticationFailedError())
    expect(result.status).toBe(401)
    expect(result.body.error.type).toBe('AuthenticationFailedError')
    expect(result.body.error.message).toBe('Authentication failed')
  })

  it('maps an unrecognized DomainError to 500', () => {
    const result = mapDomainErrorToResponse(new BrokenChainError('sig-1', 'cryptographic verification failed'))
    expect(result.status).toBe(500)
    expect(result.body.error.type).toBe('BrokenChainError')
  })
})
