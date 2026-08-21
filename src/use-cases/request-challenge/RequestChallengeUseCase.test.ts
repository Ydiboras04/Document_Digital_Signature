import { describe, it, expect } from 'vitest'
import { RequestChallengeUseCase, CHALLENGE_TTL_MS } from './RequestChallengeUseCase.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeChallengeStore } from '../testing/FakeChallengeStore.js'
import { FakeNonceGenerator } from '../testing/FakeNonceGenerator.js'
import { FakeClock } from '../testing/FakeClock.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'

function aUser(): User {
  return User.create({
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value
  }).value
}

function setup() {
  const userRepository = new FakeUserRepository()
  const challengeStore = new FakeChallengeStore()
  const nonceGenerator = new FakeNonceGenerator()
  const clock = new FakeClock(new Date('2026-08-21T00:00:00Z'))
  const useCase = new RequestChallengeUseCase(userRepository, challengeStore, nonceGenerator, clock)
  return { userRepository, challengeStore, nonceGenerator, clock, useCase }
}

describe('RequestChallengeUseCase', () => {
  it('fails when the user does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({ userId: 'missing-user' })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('returns a 32-byte challenge for a known user', async () => {
    const { userRepository, useCase } = setup()
    userRepository.users.push(aUser())

    const result = await useCase.execute({ userId: 'user-1' })

    expect(result.isOk()).toBe(true)
    expect(result.value.length).toBe(32)
    expect(result.value).toEqual(new Uint8Array(32).fill(3))
  })

  it('stores the challenge with a 2-minute expiry', async () => {
    const { userRepository, challengeStore, useCase } = setup()
    userRepository.users.push(aUser())

    await useCase.execute({ userId: 'user-1' })

    const stored = challengeStore.saved.get('user-1')
    expect(stored).toBeDefined()
    expect(stored!.challenge).toEqual(new Uint8Array(32).fill(3))
    expect(stored!.expiresAt).toEqual(new Date(new Date('2026-08-21T00:00:00Z').getTime() + CHALLENGE_TTL_MS))
    expect(CHALLENGE_TTL_MS).toBe(120_000)
  })

  it('stores nothing when the user does not exist', async () => {
    const { challengeStore, useCase } = setup()

    await useCase.execute({ userId: 'missing-user' })

    expect(challengeStore.saved.size).toBe(0)
  })
})
