import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { User } from '../../domain/entities/User.js'
import { DocumentDetailDto } from '../../use-cases/get-document/GetDocumentUseCase.js'
import { VerifiedSignatureDto } from '../../use-cases/verify-document/VerifyDocumentUseCase.js'

export interface DocumentJson {
  id: string
  title: string
  filePath: string
  originalHash: string
  uploaderId: string
}

export interface SignatureJson {
  id: string
  documentId: string
  userId: string
  previousSignatureId: string | null
  signatureData: string
  signedAt: string
}

export function toDocumentJson(document: Document): DocumentJson {
  return {
    id: document.id,
    title: document.title,
    filePath: document.filePath,
    originalHash: document.originalHash.toHex(),
    uploaderId: document.uploaderId
  }
}

export function toSignatureJson(signature: Signature): SignatureJson {
  return {
    id: signature.id,
    documentId: signature.documentId,
    userId: signature.userId,
    previousSignatureId: signature.previousSignatureId,
    signatureData: Buffer.from(signature.signatureData.toBytes()).toString('base64'),
    signedAt: signature.signedAt.toISOString()
  }
}

export interface VerifiedSignatureJson {
  userId: string
  username: string
  email: string
  signedAt: string
}

/**
 * Deliberately omits the raw signature bytes: the verification screen has no
 * use for them, and there is no reason to ship key material-adjacent data to
 * a client that cannot do anything with it.
 */
export function toVerifiedSignatureJson(dto: VerifiedSignatureDto): VerifiedSignatureJson {
  return {
    userId: dto.userId,
    username: dto.username,
    email: dto.email,
    signedAt: dto.signedAt.toISOString()
  }
}

export function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

export interface DocumentDetailJson {
  id: string
  title: string
  uploaderId: string
  signatures: Array<{ userId: string; signedAt: string }>
  signedByUser: boolean
  signingPayload: string | null
}

export function toDocumentDetailJson(detail: DocumentDetailDto): DocumentDetailJson {
  return {
    id: detail.id,
    title: detail.title,
    uploaderId: detail.uploaderId,
    signatures: detail.signatures.map((s) => ({ userId: s.userId, signedAt: s.signedAt.toISOString() })),
    signedByUser: detail.signedByUser,
    signingPayload: detail.signingPayload === null ? null : Buffer.from(detail.signingPayload).toString('base64')
  }
}

export interface UserJson {
  id: string
  username: string
  email: string
  publicKey: string
}

export function toUserJson(user: User): UserJson {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    publicKey: Buffer.from(user.publicKey.toBytes()).toString('base64')
  }
}
