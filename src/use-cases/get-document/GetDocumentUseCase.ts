import { Result } from '../../domain/result/Result.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface GetDocumentInput {
  documentId: string
  userId: string
}

export interface DocumentDetailDto {
  id: string
  title: string
  uploaderId: string
  signatures: Array<{ userId: string; signedAt: Date }>
  signedByUser: boolean
  signingPayload: Uint8Array | null
}

export type GetDocumentError = DocumentNotFoundError

export class GetDocumentUseCase {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly signatureRepository: SignatureRepository,
    private readonly signatureChainService: SignatureChainService
  ) {}

  async execute(input: GetDocumentInput): Promise<Result<DocumentDetailDto, GetDocumentError>> {
    const document = await this.documentRepository.findById(input.documentId)
    if (document === null) {
      return Result.fail(new DocumentNotFoundError(input.documentId))
    }

    const signatures = await this.signatureRepository.findByDocumentId(input.documentId)
    const signedByUser = signatures.some((s) => s.userId === input.userId)

    let signingPayload: Uint8Array | null = null
    if (!signedByUser) {
      const tip = this.signatureChainService.findTip(signatures)
      signingPayload = this.signatureChainService.buildSigningPayload(document, tip).toBytes()
    }

    return Result.ok({
      id: document.id,
      title: document.title,
      uploaderId: document.uploaderId,
      signatures: signatures.map((s) => ({ userId: s.userId, signedAt: s.signedAt })),
      signedByUser,
      signingPayload
    })
  }
}
