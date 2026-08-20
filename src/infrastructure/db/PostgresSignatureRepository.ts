import { eq } from 'drizzle-orm'
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { SignatureRepository } from '../../use-cases/ports/SignatureRepository.js'
import { db } from './connection.js'
import { signatures } from './schema.js'

export class PostgresSignatureRepository implements SignatureRepository {
  async findByDocumentId(documentId: string): Promise<Signature[]> {
    const rows = await db.select().from(signatures).where(eq(signatures.documentId, documentId))
    return rows.map(
      (row) =>
        Signature.create({
          id: row.id,
          documentId: row.documentId,
          userId: row.userId,
          previousSignatureId: row.previousSignatureId,
          signatureData: SignatureBytes.create(row.signatureData).value,
          signedAt: row.signedAt
        }).value
    )
  }

  async save(signature: Signature): Promise<void> {
    await db.insert(signatures).values({
      id: signature.id,
      documentId: signature.documentId,
      userId: signature.userId,
      previousSignatureId: signature.previousSignatureId,
      signatureData: signature.signatureData.toBytes(),
      signedAt: signature.signedAt
    })
  }
}
