import { describe, it, expect } from 'vitest'
import { CreateUserUseCase } from './CreateUserUseCase.js'
import { FakeIdGenerator } from '../testing/FakeIdGenerator.js'
import { FakeUserRepository } from '../testing/FakeUserRepository.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'

function setup() {
  const idGenerator = new FakeIdGenerator()
  const userRepository = new FakeUserRepository()
  const useCase = new CreateUserUseCase(idGenerator, userRepository)
  return { idGenerator, userRepository, useCase }
}

describe('CreateUserUseCase', () => {
  it('registers a new user successfully', async () => {
    const { userRepository, useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isOk()).toBe(true)
    const user = result.value
    expect(user.username).toBe('dave')
    expect(user.email).toBe('dave@example.com')
    expect(user.id).toBe('fake-id-1')
    expect(userRepository.users).toEqual([user])
  })

  it('rejects a duplicate email', async () => {
    const { userRepository, useCase } = setup()
    const existing = User.create({
      id: 'user-existing',
      username: 'existing',
      email: 'dave@example.com',
      publicKey: PublicKey.create(new Uint8Array(32).fill(1)).value
    }).value
    userRepository.users.push(existing)

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(DuplicateEmailError)
  })

  it('rejects a malformed public key', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(10)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidValueError)
  })

  it('rejects an invalid email format', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'not-an-email',
      publicKeyBytes: new Uint8Array(32).fill(7)
    })

    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(InvalidUserError)
  })

  it('always creates a non-admin user, even though admin exists as a concept', async () => {
    const { useCase } = setup()

    const result = await useCase.execute({
      username: 'dave',
      email: 'dave@example.com',
      publicKeyBytes: new Uint8Array(32).fill(4)
    })

    expect(result.isOk()).toBe(true)
    expect(result.value.isAdmin).toBe(false)
  })
})
