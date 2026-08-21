import { describe, it, expect, beforeEach } from 'vitest'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { db } from './connection.js'
import { users, documents, signatures } from './schema.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

describe('cleanDatabase and ensureSeedUsers', () => {
  beforeEach(async () => {
    await cleanDatabase()
  })

  it('cleanDatabase removes all documents and signatures', async () => {
    const remainingDocuments = await db.select().from(documents)
    const remainingSignatures = await db.select().from(signatures)

    expect(remainingDocuments).toEqual([])
    expect(remainingSignatures).toEqual([])
  })

  it('ensureSeedUsers inserts the 3 test users idempotently', async () => {
    await ensureSeedUsers()
    await ensureSeedUsers()

    const allUsers = await db.select({ id: users.id }).from(users)
    const ids = allUsers.map((u) => u.id).sort()

    // Exact equality, not containment: cleanDatabase now sweeps non-seed users,
    // so anything else in this table would mean the sweep missed something.
    expect(ids).toEqual(['user-alice', 'user-bob', 'user-carol'])
  })

  it('cleanDatabase removes users left behind by other tests', async () => {
    await ensureSeedUsers()
    await db.insert(users).values({
      id: 'stray-user-for-sweep-test',
      username: 'stray',
      email: 'stray@example.com',
      publicKey: ed25519TestKeys.carol.publicKeyBytes
    })

    await cleanDatabase()

    const ids = (await db.select({ id: users.id }).from(users)).map((u) => u.id)
    expect(ids).not.toContain('stray-user-for-sweep-test')
    expect(ids).toContain('user-alice')
  })
})
