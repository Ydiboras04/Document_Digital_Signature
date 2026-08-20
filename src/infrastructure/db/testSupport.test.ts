import { describe, it, expect, beforeEach } from 'vitest'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { db } from './connection.js'
import { users, documents, signatures } from './schema.js'

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

    expect(ids).toEqual(['user-alice', 'user-bob', 'user-carol'])
  })
})
