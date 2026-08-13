import { Signature } from '../../domain/entities/Signature.js'
import { SignatureRepository } from '../ports/SignatureRepository.js'

export class FakeSignatureRepository implements SignatureRepository {
  readonly savedSignatures: Signature[] = []

  async findByDocumentId(documentId: string): Promise<Signature[]> {
    return this.savedSignatures.filter((s) => s.documentId === documentId)
  }

  async save(signature: Signature): Promise<void> {
    this.savedSignatures.push(signature)
  }
}
