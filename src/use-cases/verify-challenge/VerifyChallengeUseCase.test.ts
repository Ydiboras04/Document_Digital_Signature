import { describe, it, expect } from 'vitest'
import { VerifyChallengeUseCase } from './VerifyChallengeUseCase.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { FakeChallengeStore } from '../testing/FakeChallengeStore.js'
import { FakeClock } from '../testing/FakeClock.js'
import { FakeCryptoProvider } from '../../domain/testing/FakeCryptoProvider.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'

const NOW = new Date('2026-08-21T00:00:00Z')
const CHALLENGE = new Uint8Array(32).fill(3)

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
  const clock = new FakeClock(NOW)
  const crypto = new FakeCryptoProvider()
  const useCase = new VerifyChallengeUseCase(userRepository, challengeStore, clock, crypto)
  return { userRepository, challengeStore, clock, crypto, useCase }
}

/** A signature the FakeCryptoProvider will accept for this user over CHALLENGE. */
function validSignatureFor(user: User, crypto: FakeCryptoProvider): Uint8Array {
  return crypto.sign(user.publicKey, Hash.create(CHALLENGE).value).toBytes()
}

describe('VerifyChallengeUseCase', () => {
  it('returns the user when the signature verifies', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.id).toBe('user-1')
  })

  it('fails when the user does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      userId: 'missing-user',
      signatureBytes: new Uint8Array(64).fill(9)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(UserNotFoundError)
  })

  it('fails when there is no pending challenge', async () => {
    const { userRepository, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('fails when the challenge has expired', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() - 1)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('fails when the signature does not verify', async () => {
    const { userRepository, challengeStore, useCase } = setup()
    userRepository.users.push(aUser())
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: new Uint8Array(64).fill(9)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('fails with InvalidValueError when the signature is not 64 bytes', async () => {
    const { userRepository, challengeStore, useCase } = setup()
    userRepository.users.push(aUser())
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    const result = await useCase.execute({
      userId: 'user-1',
      signatureBytes: new Uint8Array([1, 2, 3])
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidValueError)
  })

  it('consumes the challenge so the same signature cannot be replayed', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })
    const signature = validSignatureFor(user, crypto)

    const first = await useCase.execute({ userId: 'user-1', signatureBytes: signature })
    const second = await useCase.execute({ userId: 'user-1', signatureBytes: signature })

    expect(first.isOk()).toBe(true)
    expect(second.isFail()).toBe(true)
    expect(second.error).toBeInstanceOf(AuthenticationFailedError)
  })

  it('consumes the challenge even when verification fails, so it cannot be retried', async () => {
    const { userRepository, challengeStore, crypto, useCase } = setup()
    const user = aUser()
    userRepository.users.push(user)
    await challengeStore.save('user-1', {
      challenge: CHALLENGE,
      expiresAt: new Date(NOW.getTime() + 60_000)
    })

    await useCase.execute({ userId: 'user-1', signatureBytes: new Uint8Array(64).fill(9) })
    const retry = await useCase.execute({
      userId: 'user-1',
      signatureBytes: validSignatureFor(user, crypto)
    })

    expect(retry.isFail()).toBe(true)
    expect(retry.error).toBeInstanceOf(AuthenticationFailedError)
  })
})
