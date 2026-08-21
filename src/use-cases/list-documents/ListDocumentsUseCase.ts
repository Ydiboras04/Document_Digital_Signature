import { DocumentRepository } from '../ports/DocumentRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface ListDocumentsInput {
  userId: string
}

export interface DocumentSummaryDto {
  id: string
  title: string
  uploaderId: string
  signedByUser: boolean
}

export class ListDocumentsUseCase {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly signatureRepository: SignatureRepository
  ) {}

  async execute(input: ListDocumentsInput): Promise<DocumentSummaryDto[]> {
    const documents = await this.documentRepository.findAll()
    const summaries: DocumentSummaryDto[] = []
    for (const document of documents) {
      const signatures = await this.signatureRepository.findByDocumentId(document.id)
      const signedByUser = signatures.some((s) => s.userId === input.userId)
      summaries.push({
        id: document.id,
        title: document.title,
        uploaderId: document.uploaderId,
        signedByUser
      })
    }
    return summaries
  }
}
