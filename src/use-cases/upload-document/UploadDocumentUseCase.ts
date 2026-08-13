import { Result } from '../../domain/result/Result.js'
import { Document } from '../../domain/entities/Document.js'
import { InvalidDocumentError } from '../../domain/errors/InvalidDocumentError.js'
import { CryptoProvider } from '../../domain/ports/CryptoProvider.js'
import { FileStorage } from '../ports/FileStorage.js'
import { IdGenerator } from '../ports/IdGenerator.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'

export interface UploadDocumentInput {
  title: string
  uploaderId: string
  fileBytes: Uint8Array
}

export class UploadDocumentUseCase {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly fileStorage: FileStorage,
    private readonly idGenerator: IdGenerator,
    private readonly documentRepository: DocumentRepository
  ) {}

  async execute(input: UploadDocumentInput): Promise<Result<Document, InvalidDocumentError>> {
    const originalHash = this.crypto.hash(input.fileBytes)
    const filePath = await this.fileStorage.store(input.fileBytes)
    const id = this.idGenerator.generate()

    const documentResult = Document.create({
      id,
      title: input.title,
      filePath,
      originalHash,
      uploaderId: input.uploaderId
    })

    if (documentResult.isFail()) {
      return Result.fail(documentResult.error)
    }

    await this.documentRepository.save(documentResult.value)

    return Result.ok(documentResult.value)
  }
}
