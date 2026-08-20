import { describe, it, expect, beforeEach } from 'vitest'
import { PostgresSignatureRepository } from './PostgresSignatureRepository.js'
import { PostgresDocumentRepository } from './PostgresDocumentRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

function aDocument(id: string): Document {
  return Document.create({
    id,
    title: 'Contract',
    filePath: 'file-key-1',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-alice'
  }).value
}

function aSignature(
  id: string,
  documentId: string,
  overrides: Partial<{ userId: string; previousSignatureId: string | null }> = {}
): Signature {
  return Signature.create({
    id,
    documentId,
    userId: overrides.userId ?? 'user-alice',
    previousSignatureId: overrides.previousSignatureId ?? null,
    signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
    signedAt: new Date('2026-08-10T00:00:00Z')
  }).value
}

describe('PostgresSignatureRepository', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('finds saved signatures by documentId', async () => {
    const documentRepository = new PostgresDocumentRepository()
    const repository = new PostgresSignatureRepository()
    const document = aDocument('doc-1')
    const otherDocument = aDocument('doc-2')
    await documentRepository.save(document)
    await documentRepository.save(otherDocument)

    const signature = aSignature('sig-1', 'doc-1')
    const otherDocSignature = aSignature('sig-2', 'doc-2')
    await repository.save(signature)
    await repository.save(otherDocSignature)

    const found = await repository.findByDocumentId('doc-1')

    expect(found).toHaveLength(1)
    expect(found[0].id).toBe('sig-1')
    expect(found[0].documentId).toBe('doc-1')
    expect(found[0].userId).toBe('user-alice')
    expect(found[0].previousSignatureId).toBeNull()
  })

  it('returns an empty array for an unknown documentId', async () => {
    const repository = new PostgresSignatureRepository()

    const found = await repository.findByDocumentId('missing-doc')

    expect(found).toEqual([])
  })
})
