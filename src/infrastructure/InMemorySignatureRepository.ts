import { Signature } from '../domain/entities/Signature.js'
import { SignatureRepository } from '../use-cases/ports/SignatureRepository.js'

export class InMemorySignatureRepository implements SignatureRepository {
  private readonly signatures: Signature[] = []

  async findByDocumentId(documentId: string): Promise<Signature[]> {
    return this.signatures.filter((s) => s.documentId === documentId)
  }

  async save(signature: Signature): Promise<void> {
    this.signatures.push(signature)
  }
}
