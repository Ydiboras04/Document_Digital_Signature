export interface PendingChallenge {
  challenge: Uint8Array
  expiresAt: Date
}

export interface ChallengeStore {
  save(userId: string, challenge: PendingChallenge): Promise<void>

  /**
   * Returns the pending challenge for this user and removes it in the same
   * step. Single-use by construction: a captured signature cannot be replayed
   * because the nonce it was made over no longer exists.
   */
  take(userId: string): Promise<PendingChallenge | null>
}
