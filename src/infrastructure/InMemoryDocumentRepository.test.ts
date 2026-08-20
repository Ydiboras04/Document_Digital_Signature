import { describe, it, expect } from 'vitest'
import { InMemoryDocumentRepository } from './InMemoryDocumentRepository.js'
import { Document } from '../domain/entities/Document.js'
import { Hash } from '../domain/value-objects/Hash.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

describe('InMemoryDocumentRepository', () => {
  it('finds a saved document by id', async () => {
    const repository = new InMemoryDocumentRepository()
    const document = aDocument('doc-1')

    await repository.save(document)
    const found = await repository.findById('doc-1')

    expect(found).toBe(document)
  })

  it('returns null for an unknown id', async () => {
    const repository = new InMemoryDocumentRepository()

    const found = await repository.findById('missing-doc')

    expect(found).toBeNull()
  })
})
