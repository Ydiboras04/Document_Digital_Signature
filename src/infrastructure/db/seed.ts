import { db } from './connection.js'
import { users } from './schema.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

async function seed() {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: ed25519TestKeys.alice.publicKeyBytes },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: ed25519TestKeys.bob.publicKeyBytes },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: ed25519TestKeys.carol.publicKeyBytes }
    ])
    .onConflictDoNothing()

  console.log('Seeded 3 test users.')
  process.exit(0)
}

seed()
