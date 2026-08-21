import { Result } from '../../domain/result/Result.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { BrokenChainError } from '../../domain/errors/BrokenChainError.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { UserRepository } from '../ports/UserRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface VerifyDocumentInput {
  documentId: string
}

export interface VerifiedSignatureDto {
  userId: string
  username: string
  email: string
  signedAt: Date
}

export type VerifyDocumentError = DocumentNotFoundError | UserNotFoundError | BrokenChainError

export class VerifyDocumentUseCase {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly userRepository: UserRepository,
    private readonly signatureRepository: SignatureRepository,
    private readonly signatureChainService: SignatureChainService
  ) {}

  async execute(input: VerifyDocumentInput): Promise<Result<VerifiedSignatureDto[], VerifyDocumentError>> {
    const document = await this.documentRepository.findById(input.documentId)
    if (document === null) {
      return Result.fail(new DocumentNotFoundError(input.documentId))
    }

    const signatures = await this.signatureRepository.findByDocumentId(input.documentId)

    const orderedResult = this.signatureChainService.orderChain(signatures)
    if (orderedResult.isFail()) {
      return Result.fail(orderedResult.error)
    }
    const orderedSignatures = orderedResult.value

    const usersById = new Map<string, User>()
    const publicKeysByUserId = new Map<string, PublicKey>()
    const uniqueUserIds = [...new Set(orderedSignatures.map((s) => s.userId))]
    for (const userId of uniqueUserIds) {
      const user = await this.userRepository.findById(userId)
      if (user === null) {
        return Result.fail(new UserNotFoundError(userId))
      }
      usersById.set(userId, user)
      publicKeysByUserId.set(userId, user.publicKey)
    }

    const verifyResult = this.signatureChainService.verifyChain(document, orderedSignatures, publicKeysByUserId)
    if (verifyResult.isFail()) {
      return Result.fail(verifyResult.error)
    }

    // Reached only after verifyChain succeeded, so every entry here is a
    // signature that actually verified against its signer's public key --
    // which is the whole claim the verification screen makes.
    return Result.ok(
      orderedSignatures.map((signature) => {
        const user = usersById.get(signature.userId)!
        return {
          userId: signature.userId,
          username: user.username,
          email: user.email,
          signedAt: signature.signedAt
        }
      })
    )
  }
}
