import { describe, it, expect, beforeEach } from 'vitest'
import { PostgresUserRepository } from './PostgresUserRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'

describe('PostgresUserRepository', () => {
  beforeEach(async () => {
    await cleanDatabase()
    await ensureSeedUsers()
  })

  it('finds a seeded user by id', async () => {
    const repository = new PostgresUserRepository()

    const found = await repository.findById('user-alice')

    expect(found).not.toBeNull()
    expect(found!.id).toBe('user-alice')
    expect(found!.username).toBe('alice')
    expect(found!.email).toBe('alice@example.com')
    expect(found!.publicKey.toBytes()).toEqual(ed25519TestKeys.alice.publicKeyBytes)
  })

  it('returns null for an unknown id', async () => {
    const repository = new PostgresUserRepository()

    const found = await repository.findById('missing-user')

    expect(found).toBeNull()
  })
})
