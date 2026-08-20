import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { app } from './app.js'

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
})
