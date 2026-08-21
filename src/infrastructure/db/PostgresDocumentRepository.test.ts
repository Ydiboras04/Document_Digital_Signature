import { describe, it, expect, beforeEach } from 'vitest'
import { PostgresDocumentRepository } from './PostgresDocumentRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { Document } from '../../domain/entities/Document.js'
import { Hash } from '../../domain/value-objects/Hash.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: 'Contract',
    filePath: 'file-key-1',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-alice'
  }).value
}

describe('PostgresDocumentRepository', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('finds a saved document by id', async () => {
    const repository = new PostgresDocumentRepository()
    const document = aDocument('doc-1')

    await repository.save(document)
    const found = await repository.findById('doc-1')

    expect(found).not.toBeNull()
    expect(found!.id).toBe('doc-1')
    expect(found!.title).toBe('Contract')
    expect(found!.filePath).toBe('file-key-1')
    expect(found!.uploaderId).toBe('user-alice')
    expect(found!.originalHash.equals(document.originalHash)).toBe(true)
  })

  it('returns null for an unknown id', async () => {
    const repository = new PostgresDocumentRepository()

    const found = await repository.findById('missing-doc')

    expect(found).toBeNull()
  })

  it('finds all saved documents', async () => {
    const repository = new PostgresDocumentRepository()
    await repository.save(aDocument('doc-1'))
    await repository.save(aDocument('doc-2'))

    const found = await repository.findAll()

    expect(found.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-2'])
  })
})
