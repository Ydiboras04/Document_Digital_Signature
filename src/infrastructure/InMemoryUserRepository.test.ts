import { describe, it, expect } from 'vitest'
import { InMemoryUserRepository } from './InMemoryUserRepository.js'
import { User } from '../domain/entities/User.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'

function aUser(id: string): User {
  return User.create({
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    publicKey: PublicKey.create(new Uint8Array([1, 2, 3])).value
  }).value
}

describe('InMemoryUserRepository', () => {
  it('finds a seeded user by id', async () => {
    const user = aUser('user-1')
    const repository = new InMemoryUserRepository([user])

    const found = await repository.findById('user-1')

    expect(found).toBe(user)
  })

  it('returns null for an unknown id', async () => {
    const repository = new InMemoryUserRepository([aUser('user-1')])

    const found = await repository.findById('missing-user')

    expect(found).toBeNull()
  })
})
