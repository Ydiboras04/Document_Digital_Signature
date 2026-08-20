import { db } from './connection.js'
import { users } from './schema.js'

async function seed() {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: new Uint8Array([1, 2, 3, 4]) },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: new Uint8Array([5, 6, 7, 8]) },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: new Uint8Array([9, 10, 11, 12]) }
    ])
    .onConflictDoNothing()

  console.log('Seeded 3 test users.')
  process.exit(0)
}

seed()
