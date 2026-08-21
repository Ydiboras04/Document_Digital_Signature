import { eq, inArray, notInArray } from 'drizzle-orm'
import { db } from './connection.js'
import { documents, signatures, users } from './schema.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

const SEED_USER_IDS = ['user-alice', 'user-bob', 'user-carol']

/**
 * Resets the database to just the three seed users.
 *
 * Deletion order follows the foreign keys: signatures reference documents and
 * users, documents reference users, so users go last.
 *
 * Users used to be left alone here, which meant every run that registered a
 * user left another row behind -- 142 of them by the time this was written,
 * including strays that had been granted admin. Those silently defeated the
 * db:demote-admin last-admin guard, since it counts admins and found a dozen.
 * Sweeping them keeps the fixture honest about what the table contains.
 */
export async function cleanDatabase(): Promise<void> {
  await db.delete(signatures)
  await db.delete(documents)
  await db.delete(users).where(notInArray(users.id, SEED_USER_IDS))
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
