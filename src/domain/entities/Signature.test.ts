// src/domain/entities/Signature.test.ts
import { describe, it, expect } from 'vitest'
import { Signature } from './Signature'
import { SignatureBytes } from '../value-objects/SignatureBytes'

function someBytes(): SignatureBytes {
  return SignatureBytes.create(new Uint8Array([1, 2, 3])).value
}

describe('Signature', () => {
  it('creates a valid first-in-chain signature (previousSignatureId is null)', () => {
    const result = Signature.create({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date('2026-08-10T00:00:00Z')
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.previousSignatureId).toBeNull()
  })

  it('creates a valid subsequent signature referencing a previous one', () => {
    const result = Signature.create({
      id: 'sig-2',
      documentId: 'doc-1',
      userId: 'user-2',
      previousSignatureId: 'sig-1',
      signatureData: someBytes(),
      signedAt: new Date('2026-08-10T00:01:00Z')
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.previousSignatureId).toBe('sig-1')
  })

  it('rejects an empty id', () => {
    const result = Signature.create({
      id: '',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date()
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty documentId', () => {
    const result = Signature.create({
      id: 'sig-1',
      documentId: '',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date()
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty userId', () => {
    const result = Signature.create({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: '',
      previousSignatureId: null,
      signatureData: someBytes(),
      signedAt: new Date()
    })
    expect(result.isFail()).toBe(true)
  })
})
