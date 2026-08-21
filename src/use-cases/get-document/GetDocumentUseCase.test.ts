import { describe, it, expect } from 'vitest'
import { GetDocumentUseCase } from './GetDocumentUseCase.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function setup() {
  const crypto = new FakeCryptoProvider()
  const documentRepository = new FakeDocumentRepository()
  const signatureRepository = new FakeSignatureRepository()
  const signatureChainService = new SignatureChainService(crypto)
  const useCase = new GetDocumentUseCase(documentRepository, signatureRepository, signatureChainService)
  return { crypto, documentRepository, signatureRepository, signatureChainService, useCase }
}

describe('GetDocumentUseCase', () => {
  it('fails when the document does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ documentId: 'missing-doc', userId: 'user-1' })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DocumentNotFoundError)
  })

  it('returns signedByUser: false and a signing payload for a document with no signatures', async () => {
    const { crypto, documentRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const result = await useCase.execute({ documentId: document.id, userId: 'user-1' })

    expect(result.isOk()).toBe(true)
    expect(result.value.signedByUser).toBe(false)
    expect(result.value.signatures).toEqual([])
    const expectedPayload = crypto.hash(document.originalHash.toBytes()).toBytes()
    expect(result.value.signingPayload).toEqual(expectedPayload)
  })

  it('returns signedByUser: true and a null signing payload once the user has signed', async () => {
    const { crypto, documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)
    const message = crypto.hash(document.originalHash.toBytes())
    const publicKey = PublicKey.create(new Uint8Array(32).fill(1)).value
    const existingSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: crypto.sign(publicKey, message),
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(existingSignature)

    const result = await useCase.execute({ documentId: document.id, userId: 'user-1' })

    expect(result.isOk()).toBe(true)
    expect(result.value.signedByUser).toBe(true)
    expect(result.value.signingPayload).toBeNull()
    expect(result.value.signatures).toEqual([{ userId: 'user-1', signedAt: existingSignature.signedAt }])
  })

  it('computes the signing payload from the chain tip when a different user has already signed', async () => {
    const { crypto, documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)
    const firstMessage = crypto.hash(document.originalHash.toBytes())
    const firstPublicKey = PublicKey.create(new Uint8Array(32).fill(1)).value
    const firstSignatureData = crypto.sign(firstPublicKey, firstMessage)
    const firstSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: firstSignatureData,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(firstSignature)

    const result = await useCase.execute({ documentId: document.id, userId: 'user-2' })

    expect(result.isOk()).toBe(true)
    expect(result.value.signedByUser).toBe(false)
    const combined = new Uint8Array(document.originalHash.toBytes().length + firstSignatureData.toBytes().length)
    combined.set(document.originalHash.toBytes(), 0)
    combined.set(firstSignatureData.toBytes(), document.originalHash.toBytes().length)
    const expectedPayload = crypto.hash(combined).toBytes()
    expect(result.value.signingPayload).toEqual(expectedPayload)
  })
})
