import { describe, it, expect } from 'vitest'
import { InMemoryChallengeStore } from './InMemoryChallengeStore.js'

describe('InMemoryChallengeStore', () => {
  it('returns null when nothing was saved for the user', async () => {
    const store = new InMemoryChallengeStore()

    expect(await store.take('user-1')).toBeNull()
  })

  it('returns the saved challenge', async () => {
    const store = new InMemoryChallengeStore()
    const expiresAt = new Date('2026-08-21T00:02:00Z')
    await store.save('user-1', { challenge: new Uint8Array(32).fill(7), expiresAt })

    const taken = await store.take('user-1')

    expect(taken).not.toBeNull()
    expect(taken!.challenge).toEqual(new Uint8Array(32).fill(7))
    expect(taken!.expiresAt).toEqual(expiresAt)
  })

  it('deletes the challenge on take, so a nonce cannot be reused', async () => {
    const store = new InMemoryChallengeStore()
    await store.save('user-1', {
      challenge: new Uint8Array(32).fill(7),
      expiresAt: new Date('2026-08-21T00:02:00Z')
    })

    await store.take('user-1')

    expect(await store.take('user-1')).toBeNull()
  })

  it('keeps challenges for different users separate', async () => {
    const store = new InMemoryChallengeStore()
    await store.save('user-1', {
      challenge: new Uint8Array(32).fill(1),
      expiresAt: new Date('2026-08-21T00:02:00Z')
    })
    await store.save('user-2', {
      challenge: new Uint8Array(32).fill(2),
      expiresAt: new Date('2026-08-21T00:02:00Z')
    })

    expect((await store.take('user-1'))!.challenge).toEqual(new Uint8Array(32).fill(1))
    expect((await store.take('user-2'))!.challenge).toEqual(new Uint8Array(32).fill(2))
  })

  it('overwrites a previous pending challenge for the same user', async () => {
    const store = new InMemoryChallengeStore()
    const expiresAt = new Date('2026-08-21T00:02:00Z')
    await store.save('user-1', { challenge: new Uint8Array(32).fill(1), expiresAt })
    await store.save('user-1', { challenge: new Uint8Array(32).fill(9), expiresAt })

    expect((await store.take('user-1'))!.challenge).toEqual(new Uint8Array(32).fill(9))
  })
})
