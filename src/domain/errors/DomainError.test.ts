import { describe, it, expect } from 'vitest'
import { InvalidValueError } from './InvalidValueError'
import { DuplicateSignatureError } from './DuplicateSignatureError'
import { BrokenChainError } from './BrokenChainError'
import { DocumentNotFoundError } from './DocumentNotFoundError'
import { UserNotFoundError } from './UserNotFoundError'
import { SignatureVerificationFailedError } from './SignatureVerificationFailedError'
import { DuplicateEmailError } from './DuplicateEmailError'


describe('DomainError subclasses', () => {
  it('InvalidValueError carries field and reason in its message and name', () => {
    const error = new InvalidValueError('Hash', 'must be 32 bytes')
    expect(error.name).toBe('InvalidValueError')
    expect(error.message).toContain('Hash')
    expect(error.message).toContain('must be 32 bytes')
    expect(error).toBeInstanceOf(Error)
  })

  it('DuplicateSignatureError carries the offending userId', () => {
    const error = new DuplicateSignatureError('user-123')
    expect(error.name).toBe('DuplicateSignatureError')
    expect(error.message).toContain('user-123')
  })

  it('BrokenChainError carries the offending signatureId and reason', () => {
    const error = new BrokenChainError('sig-456', 'cryptographic verification failed')
    expect(error.name).toBe('BrokenChainError')
    expect(error.message).toContain('sig-456')
    expect(error.message).toContain('cryptographic verification failed')
  })

  it('DocumentNotFoundError carries the missing documentId', () => {
    const error = new DocumentNotFoundError('doc-123')
    expect(error.name).toBe('DocumentNotFoundError')
    expect(error.message).toContain('doc-123')
  })

  it('UserNotFoundError carries the missing userId', () => {
    const error = new UserNotFoundError('user-456')
    expect(error.name).toBe('UserNotFoundError')
    expect(error.message).toContain('user-456')
  })

  it('SignatureVerificationFailedError carries the userId and documentId', () => {
    const error = new SignatureVerificationFailedError('user-456', 'doc-123')
    expect(error.name).toBe('SignatureVerificationFailedError')
    expect(error.message).toContain('user-456')
    expect(error.message).toContain('doc-123')
  })

  it('DuplicateEmailError carries the offending email', () => {
    const error = new DuplicateEmailError('taken@example.com')
    expect(error.name).toBe('DuplicateEmailError')
    expect(error.message).toContain('taken@example.com')
  })

})
