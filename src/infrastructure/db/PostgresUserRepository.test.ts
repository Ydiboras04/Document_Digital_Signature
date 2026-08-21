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

  it('round-trips a non-admin user', async () => {
    const repository = new PostgresUserRepository()
    const email = `dave-${randomUUID()}@example.com`
    const user = User.create({
      id: randomUUID(),
      username: 'dave',
      email,
      publicKey: PublicKey.create(new Uint8Array(32).fill(7)).value
    }).value

    await repository.save(user)

    expect((await repository.findByEmail(email))!.isAdmin).toBe(false)
  })

  it('round-trips an admin user', async () => {
    const repository = new PostgresUserRepository()
    const email = `erin-${randomUUID()}@example.com`
    const id = randomUUID()
    const user = User.create({
      id,
      username: 'erin',
      email,
      publicKey: PublicKey.create(new Uint8Array(32).fill(8)).value,
      isAdmin: true
    }).value

    await repository.save(user)

    expect((await repository.findByEmail(email))!.isAdmin).toBe(true)
  })

  it('countAdmins tracks admins as their roles change', async () => {
    const repository = new PostgresUserRepository()
    // Measured as a delta rather than an absolute. cleanDatabase sweeps
    // non-seed users, so this is 1 (alice) in practice -- but asserting the
    // delta keeps the test honest if the seed fixture ever gains an admin.
    const before = await repository.countAdmins()
    const id = randomUUID()
    await repository.save(
      User.create({
        id,
        username: 'grace',
        email: `grace-${randomUUID()}@example.com`,
        publicKey: PublicKey.create(new Uint8Array(32).fill(6)).value
      }).value
    )

    expect(await repository.countAdmins()).toBe(before)

    await repository.setAdminStatus(id, true)
    expect(await repository.countAdmins()).toBe(before + 1)

    await repository.setAdminStatus(id, false)
    expect(await repository.countAdmins()).toBe(before)
  })

  it('setAdminStatus promotes and demotes an existing user', async () => {
    const repository = new PostgresUserRepository()
    const email = `frank-${randomUUID()}@example.com`
    const id = randomUUID()
    await repository.save(
      User.create({
        id,
        username: 'frank',
        email,
        publicKey: PublicKey.create(new Uint8Array(32).fill(9)).value
      }).value
    )

    await repository.setAdminStatus(id, true)
    expect((await repository.findById(id))!.isAdmin).toBe(true)

    await repository.setAdminStatus(id, false)
    expect((await repository.findById(id))!.isAdmin).toBe(false)
  })

  it('setAdminStatus on an unknown id is a no-op rather than an error', async () => {
    const repository = new PostgresUserRepository()

    await expect(repository.setAdminStatus(randomUUID(), true)).resolves.toBeUndefined()
  })

  it('seeds alice as an admin and bob as a regular user', async () => {
    const repository = new PostgresUserRepository()

    expect((await repository.findById('user-alice'))!.isAdmin).toBe(true)
    expect((await repository.findById('user-bob'))!.isAdmin).toBe(false)
  })
})
