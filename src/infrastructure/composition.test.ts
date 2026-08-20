import { describe, it, expect, beforeEach } from 'vitest'
import { createDependencies } from './composition.js'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'
import { cleanDatabase, ensureSeedUsers } from './db/testSupport.js'

describe('createDependencies', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('wires a working UploadDocumentUseCase', async () => {
    const { uploadDocumentUseCase } = createDependencies()

    const result = await uploadDocumentUseCase.execute({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: new TextEncoder().encode('hello world')
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.title).toBe('Contract')
    expect(result.value.uploaderId).toBe('user-alice')
  })

  it('supports a full upload -> sign -> verify round trip through the composed dependencies', async () => {
    const { uploadDocumentUseCase, signDocumentUseCase, verifyDocumentUseCase } = createDependencies()
    const crypto = new InMemoryCryptoProvider()

    const uploadResult = await uploadDocumentUseCase.execute({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: new TextEncoder().encode('hello world')
    })
    expect(uploadResult.isOk()).toBe(true)
    const document = uploadResult.value

    const message = crypto.hash(document.originalHash.toBytes())
    const alicePublicKey = PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
    const combined = new Uint8Array(alicePublicKey.toBytes().length + message.toBytes().length)
    combined.set(alicePublicKey.toBytes(), 0)
    combined.set(message.toBytes(), alicePublicKey.toBytes().length)
    const signatureBytes = crypto.hash(combined).toBytes()

    const signResult = await signDocumentUseCase.execute({
      documentId: document.id,
      userId: 'user-alice',
      signatureBytes
    })
    expect(signResult.isOk()).toBe(true)

    const verifyResult = await verifyDocumentUseCase.execute({ documentId: document.id })
    expect(verifyResult.isOk()).toBe(true)
    expect(verifyResult.value).toHaveLength(1)
  })
})
