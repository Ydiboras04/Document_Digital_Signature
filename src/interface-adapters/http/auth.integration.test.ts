import { describe, it, expect, beforeAll } from 'vitest'
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
import { app } from './app.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'
import { signChallenge } from './authTestSupport.js'

beforeAll(async () => {
  await ensureSeedUsers()
})

async function requestChallenge(userId: string) {
  const res = await app.request('/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  })
  return res
}

describe('POST /auth/challenge', () => {
  it('returns a 32-byte base64 challenge for a known user', async () => {
    const res = await requestChallenge('user-alice')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.challenge).toBe('string')
    expect(Buffer.from(body.challenge, 'base64').length).toBe(32)
  })

  it('returns 404 for an unknown user', async () => {
    const res = await requestChallenge('missing-user')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('UserNotFoundError')
  })

  it('returns 400 when userId is missing', async () => {
    const res = await app.request('/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /auth/token', () => {
  it('issues a JWT when the challenge is signed with the real private key', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signChallenge(ed25519TestKeys.alice, new Uint8Array(Buffer.from(challenge, 'base64')))

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')

    const parts = body.token.split('.')
    expect(parts).toHaveLength(3)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    expect(payload.sub).toBe('user-alice')
    const expectedExp = Math.floor(Date.now() / 1000) + 3600
    expect(payload.exp).toBeGreaterThan(expectedExp - 60)
    expect(payload.exp).toBeLessThanOrEqual(expectedExp + 60)
  })

  it('rejects a signature over the raw, unprefixed challenge', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    // No domain-separation prefix and no hashing: this is exactly the shape a
    // document-signing flow produces, and it must not authenticate.
    const signature = signWithTestKey(
      ed25519TestKeys.alice,
      new Uint8Array(Buffer.from(challenge, 'base64'))
    )

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    expect(res.status).toBe(401)
  })

  it('returns 401 when the signature is made with the wrong key', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signChallenge(ed25519TestKeys.bob, new Uint8Array(Buffer.from(challenge, 'base64')))

    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signature: Buffer.from(signature).toString('base64')
      })
    })

    expect(res.status).toBe(401)
  })

  it('returns 401 when no challenge was requested first', async () => {
    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-carol',
        signature: Buffer.from(new Uint8Array(64).fill(9)).toString('base64')
      })
    })

    expect(res.status).toBe(401)
  })

  it('rejects a replayed signature (nonce is single-use)', async () => {
    const challengeRes = await requestChallenge('user-alice')
    const { challenge } = await challengeRes.json()
    const signature = signChallenge(ed25519TestKeys.alice, new Uint8Array(Buffer.from(challenge, 'base64')))
    const payload = JSON.stringify({
      userId: 'user-alice',
      signature: Buffer.from(signature).toString('base64')
    })
    const headers = { 'Content-Type': 'application/json' }

    const first = await app.request('/auth/token', { method: 'POST', headers, body: payload })
    const replay = await app.request('/auth/token', { method: 'POST', headers, body: payload })

    expect(first.status).toBe(200)
    expect(replay.status).toBe(401)
  })
})
