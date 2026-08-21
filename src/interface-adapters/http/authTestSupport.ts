import { app } from './app.js'
import { Ed25519TestKeyPair, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'

/**
 * Performs the real challenge-response handshake against the app, so
 * integration tests exercise the genuine flow rather than minting tokens
 * behind the server's back.
 */
export async function authTokenFor(userId: string, keyPair: Ed25519TestKeyPair): Promise<string> {
  const challengeRes = await app.request('/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  })
  const { challenge } = await challengeRes.json()

  const signature = signWithTestKey(keyPair, new Uint8Array(Buffer.from(challenge, 'base64')))

  const tokenRes = await app.request('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, signature: Buffer.from(signature).toString('base64') })
  })
  const { token } = await tokenRes.json()
  return token
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}
