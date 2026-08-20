import { describe, it, expect, beforeAll } from 'vitest'
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
import { app } from './app.js'
import { Ed25519CryptoProvider } from '../../infrastructure/Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'

beforeAll(async () => {
  await ensureSeedUsers()
})

async function uploadADocument() {
  const res = await app.request('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Contract',
      uploaderId: 'user-alice',
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

describe('POST /documents', () => {
  it('uploads a document and returns 201 with the serialized document', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Contract',
        uploaderId: 'user-alice',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Contract')
    expect(body.uploaderId).toBe('user-alice')
    expect(typeof body.id).toBe('string')
    expect(typeof body.originalHash).toBe('string')
  })
})

describe('POST /documents/:documentId/signatures', () => {
  it('signs an uploaded document and returns 201 with the serialized signature', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)

    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signatureBytes: Buffer.from(signatureBytes).toString('base64')
      })
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signatureBytes: Buffer.from([1, 2, 3]).toString('base64')
      })
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-alice',
        signatureBytes: Buffer.from(signatureBytes).toString('base64')
      })
    })

    const verifyRes = await app.request(`/documents/${document.id}/verify`)

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toHaveLength(1)
  })

  it('returns 404 when verifying a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/verify')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })

  it('returns valid: true with an empty signatures array for a document with no signatures yet', async () => {
    const document = await uploadADocument()

    const verifyRes = await app.request(`/documents/${document.id}/verify`)

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toEqual([])
  })
})
