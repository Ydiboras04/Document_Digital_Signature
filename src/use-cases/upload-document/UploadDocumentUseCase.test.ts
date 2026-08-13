import { describe, it, expect } from 'vitest'
import { UploadDocumentUseCase } from './UploadDocumentUseCase.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { FakeFileStorage } from '../testing/FakeFileStorage.js'
import { FakeIdGenerator } from '../testing/FakeIdGenerator.js'
import { FakeDocumentRepository } from '../testing/FakeDocumentRepository.js'

function makeUseCase() {
  const crypto = new FakeCryptoProvider()
  const fileStorage = new FakeFileStorage()
  const idGenerator = new FakeIdGenerator()
  const documentRepository = new FakeDocumentRepository()
  const useCase = new UploadDocumentUseCase(crypto, fileStorage, idGenerator, documentRepository)
  return { useCase, crypto, fileStorage, idGenerator, documentRepository }
}

describe('UploadDocumentUseCase', () => {
  it('stores the file, hashes it, and persists a Document', async () => {
    const { useCase, crypto, fileStorage, documentRepository } = makeUseCase()
    const fileBytes = new TextEncoder().encode('hello world')

    const result = await useCase.execute({
      title: 'Contract',
      uploaderId: 'user-1',
      fileBytes
    })

    expect(result.isOk()).toBe(true)
    const document = result.value
    expect(document.title).toBe('Contract')
    expect(document.uploaderId).toBe('user-1')
    expect(document.id).toBe('fake-id-1')
    expect(document.filePath).toBe('fake-storage/1')
    expect(document.originalHash.equals(crypto.hash(fileBytes))).toBe(true)

    expect(fileStorage.stored).toEqual([fileBytes])
    expect(documentRepository.savedDocuments).toEqual([document])
  })

  it('fails validation for an empty title and does not save the document', async () => {
    const { useCase, documentRepository } = makeUseCase()

    const result = await useCase.execute({
      title: '',
      uploaderId: 'user-1',
      fileBytes: new TextEncoder().encode('hello world')
    })

    expect(result.isFail()).toBe(true)
    expect(result.error.message).toBe('Invalid Document: title must not be empty')
    expect(documentRepository.savedDocuments).toEqual([])
  })
})
