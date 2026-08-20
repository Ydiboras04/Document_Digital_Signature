import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDependencies } from './composition.js'
import { Ed25519CryptoProvider } from './Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from './testing/ed25519TestKeys.js'
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

  it('wires a working CreateUserUseCase', async () => {
    const { createUserUseCase } = createDependencies()

    const result = await createUserUseCase.execute({
      username: 'dave',
      email: `dave-${randomUUID()}@example.com`,
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.username).toBe('dave')
  })

  it('supports a full upload -> sign -> verify round trip through the composed dependencies', async () => {
    const { uploadDocumentUseCase, signDocumentUseCase, verifyDocumentUseCase } = createDependencies()
    const crypto = new Ed25519CryptoProvider()

    const uploadResult = await uploadDocumentUseCase.execute({
      title: 'Contract',
      uploaderId: 'user-alice',
      fileBytes: new TextEncoder().encode('hello world')
    })
    expect(uploadResult.isOk()).toBe(true)
    const document = uploadResult.value

    const message = crypto.hash(document.originalHash.toBytes())
    const signatureBytes = signWithTestKey(ed25519TestKeys.alice, message.toBytes())

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
