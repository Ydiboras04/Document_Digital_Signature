import { describe, it, expect } from 'vitest'
import { InMemorySignatureRepository } from './InMemorySignatureRepository.js'
import { Signature } from '../domain/entities/Signature.js'
import { SignatureBytes } from '../domain/value-objects/SignatureBytes.js'

function aSignature(id: string, documentId: string): Signature {
  return Signature.create({
    id,
    documentId,
    userId: 'user-1',
    previousSignatureId: null,
    signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('InMemorySignatureRepository', () => {
  it('finds saved signatures by documentId', async () => {
    const repository = new InMemorySignatureRepository()
    const signature = aSignature('sig-1', 'doc-1')
    const otherDocSignature = aSignature('sig-2', 'doc-2')

    await repository.save(signature)
    await repository.save(otherDocSignature)
    const found = await repository.findByDocumentId('doc-1')

    expect(found).toEqual([signature])
  })

  it('returns an empty array for an unknown documentId', async () => {
    const repository = new InMemorySignatureRepository()

    const found = await repository.findByDocumentId('missing-doc')

    expect(found).toEqual([])
  })
})
