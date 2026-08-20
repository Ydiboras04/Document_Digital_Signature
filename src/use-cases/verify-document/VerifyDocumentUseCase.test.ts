import { describe, it, expect } from 'vitest'
import { VerifyDocumentUseCase } from './VerifyDocumentUseCase.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { User } from '../../domain/entities/User.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { BrokenChainError } from '../../domain/errors/BrokenChainError.js'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function aUser(id: string, publicKeyByte: number): User {
  return User.create({
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    publicKey: PublicKey.create(new Uint8Array(32).fill(publicKeyByte)).value
  }).value
}

function setup() {
  const crypto = new FakeCryptoProvider()
  const documentRepository = new FakeDocumentRepository()
  const userRepository = new FakeUserRepository()
  const signatureRepository = new FakeSignatureRepository()
  const signatureChainService = new SignatureChainService(crypto)
  const useCase = new VerifyDocumentUseCase(
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  return { crypto, documentRepository, userRepository, signatureRepository, signatureChainService, useCase }
}

describe('VerifyDocumentUseCase', () => {
  it('verifies a valid multi-signer chain and returns it in order', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const user1 = aUser('user-1', 1)
    const user2 = aUser('user-2', 2)
    userRepository.users.push(user1, user2)

    const message1 = crypto.hash(document.originalHash.toBytes())
    const sig1Data = crypto.sign(user1.publicKey, message1)
    const sig1 = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user1.id,
      previousSignatureId: null,
      signatureData: sig1Data,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value

    const combined = new Uint8Array(document.originalHash.toBytes().length + sig1Data.toBytes().length)
    combined.set(document.originalHash.toBytes(), 0)
    combined.set(sig1Data.toBytes(), document.originalHash.toBytes().length)
    const message2 = crypto.hash(combined)
    const sig2Data = crypto.sign(user2.publicKey, message2)
    const sig2 = Signature.create({
      id: 'sig-2',
      documentId: document.id,
      userId: user2.id,
      previousSignatureId: sig1.id,
      signatureData: sig2Data,
      signedAt: new Date('2026-08-10T00:01:00Z')
    }).value

    signatureRepository.savedSignatures.push(sig2, sig1)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isOk()).toBe(true)
    expect(result.value.map((s) => s.id)).toEqual(['sig-1', 'sig-2'])
  })

  it('returns an empty array for a document with no signatures yet', async () => {
    const { documentRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isOk()).toBe(true)
    expect(result.value).toEqual([])
  })

  it('fails when the document does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ documentId: 'missing-doc' })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DocumentNotFoundError)
  })

  it('fails when a signer no longer exists', async () => {
    const { crypto, documentRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const message = crypto.hash(document.originalHash.toBytes())
    const user = aUser('user-1', 1)
    const sig = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user.id,
      previousSignatureId: null,
      signatureData: crypto.sign(user.publicKey, message),
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(sig)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('fails when a signature was tampered with', async () => {
    const { documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)
    const user = aUser('user-1', 1)
    userRepository.users.push(user)

    const tampered = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user.id,
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(tampered)

    const result = await useCase.execute({ documentId: document.id })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BrokenChainError)
  })
})
