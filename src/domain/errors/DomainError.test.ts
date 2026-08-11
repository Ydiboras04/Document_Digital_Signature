import { describe, it, expect } from 'vitest'
import { InvalidValueError } from './InvalidValueError'
import { DuplicateSignatureError } from './DuplicateSignatureError'
import { BrokenChainError } from './BrokenChainError'

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
})
