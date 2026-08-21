import { pgTable, text, timestamp, customType, boolean } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value)
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value)
  }
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false)
})

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  originalHash: bytea('original_hash').notNull(),
  uploaderId: text('uploader_id').notNull().references(() => users.id)
})

export const signatures = pgTable('signatures', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  userId: text('user_id').notNull().references(() => users.id),
  previousSignatureId: text('previous_signature_id').references((): AnyPgColumn => signatures.id),
  signatureData: bytea('signature_data').notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull()
})
