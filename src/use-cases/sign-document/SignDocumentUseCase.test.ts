import { describe, it, expect } from 'vitest'
import { SignDocumentUseCase } from './SignDocumentUseCase.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeIdGenerator } from '../testing/FakeIdGenerator.js'
import { FakeClock } from '../testing/FakeClock.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeSignatureRepository } from '../testing/FakeSignatureRepository.js'
import { Document } from '../../domain/entities/Document.js'
import { User } from '../../domain/entities/User.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'

function aDocument(): Document {
  return Document.create({
    id: 'doc-1',
    title: 'Contract',
    filePath: '/files/contract.pdf',
    originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
    uploaderId: 'user-1'
  }).value
}

function aUser(overrides: Partial<{ id: string; publicKey: PublicKey }> = {}): User {
  return User.create({
    id: overrides.id ?? 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: overrides.publicKey ?? PublicKey.create(new Uint8Array([1, 2, 3])).value
  }).value
}

function setup() {
  const crypto = new FakeCryptoProvider()
  const idGenerator = new FakeIdGenerator()
  const clock = new FakeClock()
  const documentRepository = new FakeDocumentRepository()
  const userRepository = new FakeUserRepository()
  const signatureRepository = new FakeSignatureRepository()
  const signatureChainService = new SignatureChainService(crypto)
  const useCase = new SignDocumentUseCase(
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  return {
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService,
    useCase
  }
}

describe('SignDocumentUseCase', () => {
  it('signs successfully as the first signer', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const message = crypto.hash(document.originalHash.toBytes())
    const signatureBytes = crypto.sign(user.publicKey, message).toBytes()

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes
    })

    expect(result.isOk()).toBe(true)
    const signature = result.value
    expect(signature.previousSignatureId).toBeNull()
    expect(signature.documentId).toBe(document.id)
    expect(signature.userId).toBe(user.id)
    expect(signatureRepository.savedSignatures).toEqual([signature])
  })

  it('signs successfully as a subsequent signer, chaining onto the tip', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const firstUser = aUser({ id: 'user-1', publicKey: PublicKey.create(new Uint8Array([1, 2, 3])).value })
    const secondUser = aUser({ id: 'user-2', publicKey: PublicKey.create(new Uint8Array([4, 5, 6])).value })
    await documentRepository.save(document)
    userRepository.users.push(firstUser, secondUser)

    const firstMessage = crypto.hash(document.originalHash.toBytes())
    const firstSignatureData = crypto.sign(firstUser.publicKey, firstMessage)
    const firstSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: firstUser.id,
      previousSignatureId: null,
      signatureData: firstSignatureData,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(firstSignature)

    const combined = new Uint8Array(document.originalHash.toBytes().length + firstSignatureData.toBytes().length)
    combined.set(document.originalHash.toBytes(), 0)
    combined.set(firstSignatureData.toBytes(), document.originalHash.toBytes().length)
    const secondMessage = crypto.hash(combined)
    const secondSignatureBytes = crypto.sign(secondUser.publicKey, secondMessage).toBytes()

    const result = await useCase.execute({
      documentId: document.id,
      userId: secondUser.id,
      signatureBytes: secondSignatureBytes
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.previousSignatureId).toBe(firstSignature.id)
  })

  it('rejects a user who has already signed', async () => {
    const { crypto, documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const message = crypto.hash(document.originalHash.toBytes())
    const existingSignature = Signature.create({
      id: 'sig-1',
      documentId: document.id,
      userId: user.id,
      previousSignatureId: null,
      signatureData: crypto.sign(user.publicKey, message),
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value
    signatureRepository.savedSignatures.push(existingSignature)

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes: new Uint8Array([9, 9, 9])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DuplicateSignatureError)
  })

  it('fails when the document does not exist', async () => {
    const { userRepository, useCase } = setup()
    userRepository.users.push(aUser())

    const result = await useCase.execute({
      documentId: 'missing-doc',
      userId: 'user-1',
      signatureBytes: new Uint8Array([1, 2, 3])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DocumentNotFoundError)
  })

  it('fails when the user does not exist', async () => {
    const { documentRepository, useCase } = setup()
    const document = aDocument()
    await documentRepository.save(document)

    const result = await useCase.execute({
      documentId: document.id,
      userId: 'missing-user',
      signatureBytes: new Uint8Array([1, 2, 3])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('fails when signatureBytes is empty', async () => {
    const { documentRepository, userRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes: new Uint8Array(0)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidValueError)
  })

  it('fails when the signature does not verify against the payload', async () => {
    const { documentRepository, userRepository, signatureRepository, useCase } = setup()
    const document = aDocument()
    const user = aUser()
    await documentRepository.save(document)
    userRepository.users.push(user)

    const result = await useCase.execute({
      documentId: document.id,
      userId: user.id,
      signatureBytes: new Uint8Array([9, 9, 9, 9])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(SignatureVerificationFailedError)
    expect(signatureRepository.savedSignatures).toEqual([])
  })
})
