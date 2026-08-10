// src/domain/services/SignatureChainService.test.ts
import { describe, it, expect } from 'vitest'
import { SignatureChainService } from './SignatureChainService'
import { FakeCryptoProvider } from '../testing/FakeCryptoProvider'
import { Document } from '../entities/Document'
import { Signature } from '../entities/Signature'
import { Hash } from '../value-objects/Hash'
import { SignatureBytes } from '../value-objects/SignatureBytes'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function aSignature(overrides: Partial<{ id: string; userId: string; previousSignatureId: string | null }> = {}): Signature {
  return Signature.create({
    id: overrides.id ?? 'sig-1',
    documentId: 'doc-1',
    userId: overrides.userId ?? 'user-1',
    previousSignatureId: overrides.previousSignatureId ?? null,
    signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('SignatureChainService.assertCanSign', () => {
  it('allows a user who has not yet signed', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.assertCanSign([aSignature({ userId: 'user-2' })], 'user-1')
    expect(result.isOk()).toBe(true)
  })

  it('rejects a user who has already signed', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.assertCanSign([aSignature({ userId: 'user-1' })], 'user-1')
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('user-1')
  })
})

describe('SignatureChainService.buildSigningPayload', () => {
  it('for the first signer, hashes just the document hash', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()

    const payload = service.buildSigningPayload(document, null)

    expect(payload.equals(crypto.hash(document.originalHash.toBytes()))).toBe(true)
  })

  it('for a subsequent signer, hashes documentHash + previousSignature.signatureData', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const previous = aSignature({ id: 'sig-1', userId: 'user-1' })

    const payload = service.buildSigningPayload(document, previous)

    const expectedInput = new Uint8Array(
      document.originalHash.toBytes().length + previous.signatureData.toBytes().length
    )
    expectedInput.set(document.originalHash.toBytes(), 0)
    expectedInput.set(previous.signatureData.toBytes(), document.originalHash.toBytes().length)

    expect(payload.equals(crypto.hash(expectedInput))).toBe(true)
  })
})
