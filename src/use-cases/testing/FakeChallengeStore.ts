import { ChallengeStore, PendingChallenge } from '../ports/ChallengeStore.js'

export class FakeChallengeStore implements ChallengeStore {
  readonly saved = new Map<string, PendingChallenge>()
  readonly takenUserIds: string[] = []

  async save(userId: string, challenge: PendingChallenge): Promise<void> {
    this.saved.set(userId, challenge)
  }

  async take(userId: string): Promise<PendingChallenge | null> {
    this.takenUserIds.push(userId)
    const pending = this.saved.get(userId)
    if (pending === undefined) {
      return null
    }
    this.saved.delete(userId)
    return pending
  }
}
