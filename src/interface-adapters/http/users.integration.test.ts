import { describe, it, expect } from 'vitest'
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { app } from './app.js'
import type { Ed25519TestKeyPair } from '../../infrastructure/testing/ed25519TestKeys.js'
import { authTokenFor } from './authTestSupport.js'

describe('POST /users', () => {
  it('registers a new user and returns 201 with the serialized user', async () => {
    const email = `dave-${randomUUID()}@example.com`
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'dave',
        email,
        publicKeyBytes: Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.username).toBe('dave')
    expect(body.email).toBe(email)
    expect(typeof body.id).toBe('string')
    expect(typeof body.publicKey).toBe('string')
  })

  it('returns 409 when the email is already registered', async () => {
    const email = `duplicate-${randomUUID()}@example.com`
    const payload = {
      username: 'first',
      email,
      publicKeyBytes: Buffer.from(new Uint8Array(32).fill(1)).toString('base64')
    }
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, username: 'second' })
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.type).toBe('DuplicateEmailError')
  })

  it('returns 400 for a malformed public key', async () => {
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'dave',
        email: `dave-malformed-${randomUUID()}@example.com`,
        publicKeyBytes: Buffer.from(new Uint8Array(10)).toString('base64')
      })
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.type).toBe('InvalidValueError')
  })

  it('never grants admin, even when the request body asks for it', async () => {
    // Generate a real key pair so we can complete the actual challenge-response
    // handshake below -- the point of this test is to observe the isAdmin claim
    // the server itself puts on a token it issues, not a value we assert on the
    // registration response (which does not expose the field at all) or read
    // out of a repository behind the route's back. That is a real end-to-end
    // check that a body-supplied isAdmin can never reach an issued token.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const publicJwk = publicKey.export({ format: 'jwk' }) as { x: string }
    const privateJwk = privateKey.export({ format: 'jwk' }) as { d: string }
    const keyPair: Ed25519TestKeyPair = {
      publicKeyBase64Url: publicJwk.x,
      privateKeyBase64Url: privateJwk.d,
      publicKeyBytes: new Uint8Array(Buffer.from(publicJwk.x, 'base64url'))
    }

    const email = `eve-${randomUUID()}@example.com`
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'eve',
        email,
        publicKeyBytes: Buffer.from(keyPair.publicKeyBytes).toString('base64'),
        isAdmin: true
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()

    const token = await authTokenFor(body.id, keyPair)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    expect(payload.isAdmin).toBe(false)
  })
})
