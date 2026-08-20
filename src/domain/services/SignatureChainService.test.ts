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
    signatureData: SignatureBytes.create(new Uint8Array(64).fill(1)).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('SignatureChainService.assertCanSign', () => {
  it('allows a user who has not yet signed', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.assertCanSign(aDocument(), [aSignature({ userId: 'user-2' })], 'user-1')
    expect(result.isOk()).toBe(true)
  })

  it('rejects a user who has already signed', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.assertCanSign(aDocument(), [aSignature({ userId: 'user-1' })], 'user-1')
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('user-1')
  })

  it('ignores signatures belonging to a different document when checking for duplicates', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const otherDocSignature = Signature.create({
      id: 'sig-other-doc',
      documentId: 'doc-2',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(1)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value

    const result = service.assertCanSign(aDocument(), [otherDocSignature], 'user-1')

    expect(result.isOk()).toBe(true)
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

import { PublicKey } from '../value-objects/PublicKey'
import { BrokenChainError } from '../errors/BrokenChainError'

function buildValidChain(crypto: FakeCryptoProvider, document: Document, userIds: string[]) {
  const publicKeysByUserId = new Map<string, PublicKey>()
  const signatures: Signature[] = []
  let previous: Signature | null = null

  for (const [index, userId] of userIds.entries()) {
    const publicKey = PublicKey.create(new Uint8Array(32).fill(index + 1)).value
    publicKeysByUserId.set(userId, publicKey)

    const message =
      previous === null
        ? crypto.hash(document.originalHash.toBytes())
        : crypto.hash(
            (() => {
              const combined = new Uint8Array(
                document.originalHash.toBytes().length + previous!.signatureData.toBytes().length
              )
              combined.set(document.originalHash.toBytes(), 0)
              combined.set(previous!.signatureData.toBytes(), document.originalHash.toBytes().length)
              return combined
            })()
          )

    const signatureData = crypto.sign(publicKey, message)
    const signature: Signature = Signature.create({
      id: `sig-${index + 1}`,
      documentId: document.id,
      userId,
      previousSignatureId: previous?.id ?? null,
      signatureData,
      signedAt: new Date(2026, 7, 10, 0, index)
    }).value

    signatures.push(signature)
    previous = signature
  }

  return { signatures, publicKeysByUserId }
}

describe('SignatureChainService.verifyChain', () => {
  it('verifies a valid chain of three signatures', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2', 'user-3'])

    const result = service.verifyChain(document, signatures, publicKeysByUserId)

    expect(result.isOk()).toBe(true)
  })

  it('fails when a signature was tampered with (verification mismatch)', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2'])

    const tampered = Signature.create({
      id: signatures[1].id,
      documentId: signatures[1].documentId,
      userId: signatures[1].userId,
      previousSignatureId: signatures[1].previousSignatureId,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: signatures[1].signedAt
    }).value
    const chainWithTamperedSignature = [signatures[0], tampered]

    const result = service.verifyChain(document, chainWithTamperedSignature, publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
    expect(result.error.message).toContain(tampered.id)
  })

  it('fails when previousSignatureId does not match actual chain order', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2'])

    const misordered = Signature.create({
      id: signatures[1].id,
      documentId: signatures[1].documentId,
      userId: signatures[1].userId,
      previousSignatureId: 'sig-does-not-exist',
      signatureData: signatures[1].signatureData,
      signedAt: signatures[1].signedAt
    }).value

    const result = service.verifyChain(document, [signatures[0], misordered], publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })

  it('fails when no public key is registered for a signer', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1'])
    publicKeysByUserId.delete('user-1')

    const result = service.verifyChain(document, signatures, publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('user-1')
  })

  it('fails when a signature belongs to a different document', () => {
    const crypto = new FakeCryptoProvider()
    const service = new SignatureChainService(crypto)
    const document = aDocument()
    const { signatures, publicKeysByUserId } = buildValidChain(crypto, document, ['user-1', 'user-2'])

    const mismatchedDocSignature = Signature.create({
      id: signatures[1].id,
      documentId: 'some-other-document-id',
      userId: signatures[1].userId,
      previousSignatureId: signatures[1].previousSignatureId,
      signatureData: signatures[1].signatureData,
      signedAt: signatures[1].signedAt
    }).value

    const result = service.verifyChain(document, [signatures[0], mismatchedDocSignature], publicKeysByUserId)

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })
})

describe('SignatureChainService.findTip', () => {
  it('returns null for an empty list', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    expect(service.findTip([])).toBeNull()
  })

  it('returns the only signature when there is exactly one', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const only = aSignature({ id: 'sig-1', previousSignatureId: null })
    expect(service.findTip([only])).toBe(only)
  })

  it('returns the signature that nothing else points to, regardless of array order', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const first = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const second = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const third = aSignature({ id: 'sig-3', userId: 'user-3', previousSignatureId: 'sig-2' })

    expect(service.findTip([third, first, second])).toBe(third)
  })
})

describe('SignatureChainService.orderChain', () => {
  it('returns an empty array for an empty list', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const result = service.orderChain([])
    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([])
  })

  it('returns a single signature as-is', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const only = aSignature({ id: 'sig-1', previousSignatureId: null })
    const result = service.orderChain([only])
    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([only])
  })

  it('reconstructs order from a shuffled input', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const first = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const second = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const third = aSignature({ id: 'sig-3', userId: 'user-3', previousSignatureId: 'sig-2' })

    const result = service.orderChain([third, first, second])

    expect(result.isOk()).toBe(true)
    expect(result.value.map((s) => s.id)).toEqual(['sig-1', 'sig-2', 'sig-3'])
  })

  it('fails when no signature has a null previousSignatureId', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const a = aSignature({ id: 'sig-1', previousSignatureId: 'sig-does-not-exist' })

    const result = service.orderChain([a])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })

  it('fails when more than one signature has a null previousSignatureId', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const a = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const b = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: null })

    const result = service.orderChain([a, b])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })

  it('fails when a signature is unreachable from the head', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const first = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const second = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const orphan = aSignature({ id: 'sig-3', userId: 'user-3', previousSignatureId: 'sig-does-not-exist' })

    const result = service.orderChain([first, second, orphan])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
    expect(result.error.message).toContain('sig-3')
  })

  it('fails when a cycle is detected', () => {
    const service = new SignatureChainService(new FakeCryptoProvider())
    const head = aSignature({ id: 'sig-1', userId: 'user-1', previousSignatureId: null })
    const middle = aSignature({ id: 'sig-2', userId: 'user-2', previousSignatureId: 'sig-1' })
    const duplicateOfHead = aSignature({ id: 'sig-1', userId: 'user-3', previousSignatureId: 'sig-2' })

    const result = service.orderChain([head, middle, duplicateOfHead])

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })
})
