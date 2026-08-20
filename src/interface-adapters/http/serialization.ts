import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'

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

export function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}
