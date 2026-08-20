import { db } from './connection.js'
import { documents, signatures, users } from './schema.js'

export async function cleanDatabase(): Promise<void> {
  await db.delete(signatures)
  await db.delete(documents)
}

export async function ensureSeedUsers(): Promise<void> {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: new Uint8Array([1, 2, 3, 4]) },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: new Uint8Array([5, 6, 7, 8]) },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: new Uint8Array([9, 10, 11, 12]) }
    ])
    .onConflictDoNothing()
}
