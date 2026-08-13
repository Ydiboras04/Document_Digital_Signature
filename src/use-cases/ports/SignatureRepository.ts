import { Signature } from '../../domain/entities/Signature.js'

export interface SignatureRepository {
  findByDocumentId(documentId: string): Promise<Signature[]>
  save(signature: Signature): Promise<void>
}
