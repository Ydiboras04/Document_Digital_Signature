import { Result } from '../../domain/result/Result.js'
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidSignatureError } from '../../domain/errors/InvalidSignatureError.js'
import { DuplicateSignatureError } from '../../domain/errors/DuplicateSignatureError.js'
import { DocumentNotFoundError } from '../../domain/errors/DocumentNotFoundError.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { SignatureVerificationFailedError } from '../../domain/errors/SignatureVerificationFailedError.js'
import { CryptoProvider } from '../../domain/ports/CryptoProvider.js'
import { SignatureChainService } from '../../domain/services/SignatureChainService.js'
import { IdGenerator } from '../ports/IdGenerator.js'
import { Clock } from '../ports/Clock.js'
import { DocumentRepository } from '../ports/DocumentRepository.js'
import { UserRepository } from '../ports/UserRepository.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export interface SignDocumentInput {
  documentId: string
  userId: string
  signatureBytes: Uint8Array
}

export type SignDocumentError =
  | DocumentNotFoundError
  | UserNotFoundError
  | DuplicateSignatureError
  | InvalidValueError
  | SignatureVerificationFailedError
  | InvalidSignatureError

export class SignDocumentUseCase {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly documentRepository: DocumentRepository,
    private readonly userRepository: UserRepository,
    private readonly signatureRepository: SignatureRepository,
    private readonly signatureChainService: SignatureChainService
  ) {}

  async execute(input: SignDocumentInput): Promise<Result<Signature, SignDocumentError>> {
    const document = await this.documentRepository.findById(input.documentId)
    if (document === null) {
      return Result.fail(new DocumentNotFoundError(input.documentId))
    }

    const user = await this.userRepository.findById(input.userId)
    if (user === null) {
      return Result.fail(new UserNotFoundError(input.userId))
    }

    const existingSignatures = await this.signatureRepository.findByDocumentId(input.documentId)

    const canSignResult = this.signatureChainService.assertCanSign(document, existingSignatures, input.userId)
    if (canSignResult.isFail()) {
      return Result.fail(canSignResult.error)
    }

    const previousSignature = this.signatureChainService.findTip(existingSignatures)

    const signatureBytesResult = SignatureBytes.create(input.signatureBytes)
    if (signatureBytesResult.isFail()) {
      return Result.fail(signatureBytesResult.error)
    }

    const message = this.signatureChainService.buildSigningPayload(document, previousSignature)
    const isValid = this.crypto.verify(user.publicKey, message, signatureBytesResult.value)
    if (!isValid) {
      return Result.fail(new SignatureVerificationFailedError(input.userId, input.documentId))
    }

    const signatureResult = Signature.create({
      id: this.idGenerator.generate(),
      documentId: document.id,
      userId: user.id,
      previousSignatureId: previousSignature?.id ?? null,
      signatureData: signatureBytesResult.value,
      signedAt: this.clock.now()
    })
    if (signatureResult.isFail()) {
      return Result.fail(signatureResult.error)
    }

    await this.signatureRepository.save(signatureResult.value)

    return Result.ok(signatureResult.value)
  }
}
