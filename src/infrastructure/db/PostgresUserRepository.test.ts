import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PostgresUserRepository } from './PostgresUserRepository.js'
import { cleanDatabase, ensureSeedUsers } from './testSupport.js'
import { ed25519TestKeys } from '../testing/ed25519TestKeys.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'

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

  it('finds a saved user by email', async () => {
    const repository = new PostgresUserRepository()
    const email = `dave-${randomUUID()}@example.com`
    const user = User.create({
      id: randomUUID(),
      username: 'dave',
      email,
      publicKey: PublicKey.create(new Uint8Array(32).fill(7)).value
    }).value

    await repository.save(user)
    const found = await repository.findByEmail(email)

    expect(found).not.toBeNull()
    expect(found!.email).toBe(email)
    expect(found!.username).toBe('dave')
  })

  it('returns null when finding by an unknown email', async () => {
    const repository = new PostgresUserRepository()

    const found = await repository.findByEmail('missing@example.com')

    expect(found).toBeNull()
  })
})
