import { Result } from '../../domain/result/Result.js'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { InvalidUserError } from '../../domain/errors/InvalidUserError.js'
import { DuplicateEmailError } from '../../domain/errors/DuplicateEmailError.js'
import { IdGenerator } from '../ports/IdGenerator.js'
import { UserRepository } from '../ports/UserRepository.js'

export interface CreateUserInput {
  username: string
  email: string
  publicKeyBytes: Uint8Array
}

export type CreateUserError = DuplicateEmailError | InvalidValueError | InvalidUserError

export class CreateUserUseCase {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly userRepository: UserRepository
  ) {}

  async execute(input: CreateUserInput): Promise<Result<User, CreateUserError>> {
    const existing = await this.userRepository.findByEmail(input.email)
    if (existing !== null) {
      return Result.fail(new DuplicateEmailError(input.email))
    }

    const publicKeyResult = PublicKey.create(input.publicKeyBytes)
    if (publicKeyResult.isFail()) {
      return Result.fail(publicKeyResult.error)
    }

    const userResult = User.create({
      id: this.idGenerator.generate(),
      username: input.username,
      email: input.email,
      publicKey: publicKeyResult.value
    })
    if (userResult.isFail()) {
      return Result.fail(userResult.error)
    }

    await this.userRepository.save(userResult.value)

    return Result.ok(userResult.value)
  }
}
