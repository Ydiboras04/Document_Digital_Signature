import { Result } from '../../domain/result/Result.js'
import { UserNotFoundError } from '../../domain/errors/UserNotFoundError.js'
import { UserRepository } from '../ports/UserRepository.js'
import { ChallengeStore } from '../ports/ChallengeStore.js'
import { NonceGenerator } from '../ports/NonceGenerator.js'
import { Clock } from '../ports/Clock.js'

export const CHALLENGE_TTL_MS = 120_000

export interface RequestChallengeInput {
  userId: string
}

export class RequestChallengeUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly challengeStore: ChallengeStore,
    private readonly nonceGenerator: NonceGenerator,
    private readonly clock: Clock
  ) {}

  async execute(input: RequestChallengeInput): Promise<Result<Uint8Array, UserNotFoundError>> {
    const user = await this.userRepository.findById(input.userId)
    if (user === null) {
      return Result.fail(new UserNotFoundError(input.userId))
    }

    const challenge = this.nonceGenerator.generate()
    const expiresAt = new Date(this.clock.now().getTime() + CHALLENGE_TTL_MS)
    await this.challengeStore.save(user.id, { challenge, expiresAt })

    return Result.ok(challenge)
  }
}
