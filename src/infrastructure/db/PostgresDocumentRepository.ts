import { eq } from 'drizzle-orm'
import { Document } from '../../domain/entities/Document.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { DocumentRepository } from '../../use-cases/ports/DocumentRepository.js'
import { db } from './connection.js'
import { documents } from './schema.js'

export class PostgresDocumentRepository implements DocumentRepository {
  async save(document: Document): Promise<void> {
    await db.insert(documents).values({
      id: document.id,
      title: document.title,
      filePath: document.filePath,
      originalHash: document.originalHash.toBytes(),
      uploaderId: document.uploaderId
    })
  }

  async findById(id: string): Promise<Document | null> {
    const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return Document.create({
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      originalHash: Hash.create(row.originalHash).value,
      uploaderId: row.uploaderId
    }).value
  }

  async findAll(): Promise<Document[]> {
    const rows = await db.select().from(documents).orderBy(documents.id)
    return rows.map((row) =>
      Document.create({
        id: row.id,
        title: row.title,
        filePath: row.filePath,
        originalHash: Hash.create(row.originalHash).value,
        uploaderId: row.uploaderId
      }).value
    )
  }
}
