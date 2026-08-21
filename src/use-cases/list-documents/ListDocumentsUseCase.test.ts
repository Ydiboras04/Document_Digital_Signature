import { describe, it, expect } from 'vitest'
import { ListDocumentsUseCase } from './ListDocumentsUseCase.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: `Document ${id}`,
    filePath: `/files/${id}.pdf`,
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function setup() {
  const documentRepository = new FakeDocumentRepository()
  const signatureRepository = new FakeSignatureRepository()
  const useCase = new ListDocumentsUseCase(documentRepository, signatureRepository)
  return { documentRepository, signatureRepository, useCase }
}

describe('ListDocumentsUseCase', () => {
  it('returns an empty list when there are no documents', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result).toEqual([])
  })

  it('marks signedByUser true only for documents the given user has signed', async () => {
    const { documentRepository, signatureRepository, useCase } = setup()
    const signedDoc = aDocument('doc-1')
    const unsignedDoc = aDocument('doc-2')
    await documentRepository.save(signedDoc)
    await documentRepository.save(unsignedDoc)
    const signature = Signature.create({
      id: 'sig-1',
      documentId: signedDoc.id,
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(signature)

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result).toEqual([
      { id: 'doc-1', title: 'Document doc-1', uploaderId: 'user-1', signedByUser: true },
      { id: 'doc-2', title: 'Document doc-2', uploaderId: 'user-1', signedByUser: false }
    ])
  })

  it('does not mark a document as signed for a different user', async () => {
    const { documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument('doc-1')
    await documentRepository.save(document)
    const signature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: 'user-2',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(signature)

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result).toEqual([{ id: 'doc-1', title: 'Document doc-1', uploaderId: 'user-1', signedByUser: false }])
  })
})
