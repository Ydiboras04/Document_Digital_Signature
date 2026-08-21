import { Result } from '../../domain/result/Result.js'
import { User } from '../../domain/entities/User.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { AuthenticationFailedError } from '../../domain/errors/AuthenticationFailedError.js'
import { InvalidValueError } from '../../domain/errors/InvalidValueError.js'
import { CryptoProvider } from '../../domain/ports/CryptoProvider.js'
import { UserRepository } from '../ports/UserRepository.js'
import { ChallengeStore } from '../ports/ChallengeStore.js'
import { Clock } from '../ports/Clock.js'

export interface VerifyChallengeInput {
  userId: string
  signatureBytes: Uint8Array
}

export type VerifyChallengeError = UserNotFoundError | AuthenticationFailedError | InvalidValueError

export class VerifyChallengeUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly challengeStore: ChallengeStore,
    private readonly clock: Clock,
    private readonly crypto: CryptoProvider
  ) {}

  async execute(input: VerifyChallengeInput): Promise<Result<User, VerifyChallengeError>> {
    const user = await this.userRepository.findById(input.userId)
    if (user === null) {
      return Result.fail(new UserNotFoundError(input.userId))
    }

    // take() removes the challenge here, before verification runs, so a nonce
    // is single-use whether or not the signature turns out to be valid.
    const pending = await this.challengeStore.take(input.userId)
    if (pending === null) {
      return Result.fail(new AuthenticationFailedError())
    }

    if (this.clock.now().getTime() > pending.expiresAt.getTime()) {
      return Result.fail(new AuthenticationFailedError())
    }

    const signatureResult = SignatureBytes.create(input.signatureBytes)
    if (signatureResult.isFail()) {
      return Result.fail(signatureResult.error)
    }

    const messageResult = Hash.create(pending.challenge)
    if (messageResult.isFail()) {
      return Result.fail(messageResult.error)
    }

    const isValid = this.crypto.verify(user.publicKey, messageResult.value, signatureResult.value)
    if (!isValid) {
      return Result.fail(new AuthenticationFailedError())
    }

    return Result.ok(user)
  }
}
