import { eq, inArray } from 'drizzle-orm'
import { db } from './connection.js'
import { documents, signatures, users } from './schema.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

export async function cleanDatabase(): Promise<void> {
  await db.delete(signatures)
  await db.delete(documents)
}

export async function ensureSeedUsers(): Promise<void> {
  await db
    .insert(users)
    .values([
      { id: 'user-alice', username: 'alice', email: 'alice@example.com', publicKey: ed25519TestKeys.alice.publicKeyBytes },
      { id: 'user-bob', username: 'bob', email: 'bob@example.com', publicKey: ed25519TestKeys.bob.publicKeyBytes },
      { id: 'user-carol', username: 'carol', email: 'carol@example.com', publicKey: ed25519TestKeys.carol.publicKeyBytes }
    ])
    .onConflictDoNothing()

  // Roles are set explicitly rather than through the insert above, because
  // onConflictDoNothing leaves pre-existing rows untouched and these fixtures
  // predate the is_admin column. Alice is the admin fixture; the integration
  // tests upload as her, and bob is the non-admin the 403 tests use.
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, 'user-alice'))
  await db.update(users).set({ isAdmin: false }).where(inArray(users.id, ['user-bob', 'user-carol']))
}
