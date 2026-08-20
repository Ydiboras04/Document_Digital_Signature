import { InMemoryFileStorage } from './InMemoryFileStorage.js'
import { RandomIdGenerator } from './RandomIdGenerator.js'
import { SystemClock } from './SystemClock.js'
import { InMemoryCryptoProvider } from './InMemoryCryptoProvider.js'
import { PostgresDocumentRepository } from './db/PostgresDocumentRepository.js'
import { PostgresUserRepository } from './db/PostgresUserRepository.js'
import { PostgresSignatureRepository } from './db/PostgresSignatureRepository.js'
import { SignatureChainService } from '../domain/services/SignatureChainService.js'
import { UploadDocumentUseCase } from '../use-cases/upload-document/UploadDocumentUseCase.js'
import { SignDocumentUseCase } from '../use-cases/sign-document/SignDocumentUseCase.js'
import { VerifyDocumentUseCase } from '../use-cases/verify-document/VerifyDocumentUseCase.js'

export interface Dependencies {
  uploadDocumentUseCase: UploadDocumentUseCase
  signDocumentUseCase: SignDocumentUseCase
  verifyDocumentUseCase: VerifyDocumentUseCase
}

export function createDependencies(): Dependencies {
  const documentRepository = new PostgresDocumentRepository()
  const userRepository = new PostgresUserRepository()
  const signatureRepository = new PostgresSignatureRepository()
  const fileStorage = new InMemoryFileStorage()
  const idGenerator = new RandomIdGenerator()
  const clock = new SystemClock()
  const crypto = new InMemoryCryptoProvider()
  const signatureChainService = new SignatureChainService(crypto)

  const uploadDocumentUseCase = new UploadDocumentUseCase(crypto, fileStorage, idGenerator, documentRepository)
  const signDocumentUseCase = new SignDocumentUseCase(
    crypto,
    idGenerator,
    clock,
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )
  const verifyDocumentUseCase = new VerifyDocumentUseCase(
    documentRepository,
    userRepository,
    signatureRepository,
    signatureChainService
  )

  return { uploadDocumentUseCase, signDocumentUseCase, verifyDocumentUseCase }
}
