import { describe, it, expect, beforeAll } from 'vitest'
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
import { app } from './app.js'
import { Ed25519CryptoProvider } from '../../infrastructure/Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'
import { authTokenFor, bearer } from './authTestSupport.js'

let aliceToken: string

beforeAll(async () => {
  await ensureSeedUsers()
  aliceToken = await authTokenFor('user-alice', ed25519TestKeys.alice)
})

async function uploadADocument() {
  const res = await app.request('/documents', {
    method: 'POST',
    headers: bearer(aliceToken),
    body: JSON.stringify({
      title: 'Contract',
      fileBytes: Buffer.from('hello world').toString('base64')
    })
  })
  return res.json()
}

function computeAliceSignatureBytes(originalHashHex: string): Uint8Array {
  const crypto = new Ed25519CryptoProvider()
  const message = crypto.hash(Buffer.from(originalHashHex, 'hex'))
  return signWithTestKey(ed25519TestKeys.alice, message.toBytes())
}

describe('authentication is required', () => {
  it('rejects GET /documents with no token', async () => {
    const res = await app.request('/documents')

    expect(res.status).toBe(401)
  })

  it('rejects GET /documents/:documentId with no token', async () => {
    const res = await app.request('/documents/any-id')

    expect(res.status).toBe(401)
  })

  it('rejects POST /documents with no token', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', fileBytes: '' })
    })

    expect(res.status).toBe(401)
  })

  it('rejects POST /documents/:documentId/signatures with no token', async () => {
    const res = await app.request('/documents/any-id/signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureBytes: '' })
    })

    expect(res.status).toBe(401)
  })

  it('rejects GET /documents/:documentId/verify with no token', async () => {
    const res = await app.request('/documents/any-id/verify')

    expect(res.status).toBe(401)
  })

  it('rejects a malformed token', async () => {
    const res = await app.request('/documents', {
      headers: { Authorization: 'Bearer not-a-real-token' }
    })

    expect(res.status).toBe(401)
  })
})

describe('POST /documents', () => {
  it('uploads a document, taking uploaderId from the token', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({
        title: 'Contract',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Contract')
    expect(body.uploaderId).toBe('user-alice')
    expect(typeof body.id).toBe('string')
  })

  it('returns 400 when title is missing', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ fileBytes: Buffer.from('x').toString('base64') })
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /documents/:documentId/signatures', () => {
  it('signs an uploaded document, taking userId from the token', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)

    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    expect(signRes.status).toBe(201)
    const signature = await signRes.json()
    expect(signature.documentId).toBe(document.id)
    expect(signature.userId).toBe('user-alice')
    expect(signature.previousSignatureId).toBeNull()
  })

  it('returns 404 when signing a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/signatures', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(new Uint8Array(64)).toString('base64') })
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })
})

describe('GET /documents/:documentId/verify', () => {
  it('returns valid: true with the signature chain after a real upload and sign', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toHaveLength(1)
  })

  it('returns 404 when verifying a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/verify', { headers: bearer(aliceToken) })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })
})

describe('GET /documents', () => {
  it('lists documents with signedByUser computed for the token holder', async () => {
    const document = await uploadADocument()

    const res = await app.request('/documents', { headers: bearer(aliceToken) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toContainEqual({
      id: document.id,
      title: 'Contract',
      uploaderId: 'user-alice',
      signedByUser: false
    })
  })
})

describe('GET /documents/:documentId', () => {
  it('returns document detail with a signing payload for an unsigned document', async () => {
    const document = await uploadADocument()

    const res = await app.request(`/documents/${document.id}`, { headers: bearer(aliceToken) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(document.id)
    expect(body.signedByUser).toBe(false)
    expect(typeof body.signingPayload).toBe('string')
  })

  it('returns signedByUser: true and a null signing payload after the token holder signs', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    const res = await app.request(`/documents/${document.id}`, { headers: bearer(aliceToken) })

    const body = await res.json()
    expect(body.signedByUser).toBe(true)
    expect(body.signingPayload).toBeNull()
  })

  it('returns 404 for a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc', { headers: bearer(aliceToken) })

    expect(res.status).toBe(404)
  })
})
