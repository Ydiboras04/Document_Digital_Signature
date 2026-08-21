import { ChallengeStore, PendingChallenge } from '../use-cases/ports/ChallengeStore.js'

/**
 * Challenges are short-lived (2 minutes) and single-use, so losing them on
 * server restart is harmless -- a client simply requests a fresh one.
 */
export class InMemoryChallengeStore implements ChallengeStore {
  private readonly challenges = new Map<string, PendingChallenge>()

  async save(userId: string, challenge: PendingChallenge): Promise<void> {
    this.challenges.set(userId, challenge)
  }

  async take(userId: string): Promise<PendingChallenge | null> {
    const pending = this.challenges.get(userId)
    if (pending === undefined) {
      return null
    }
    this.challenges.delete(userId)
    return pending
  }
}
