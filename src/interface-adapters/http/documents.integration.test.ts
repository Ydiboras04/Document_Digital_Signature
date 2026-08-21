import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ensureSeedUsers } from '../../infrastructure/db/testSupport.js'
import { app } from './app.js'
import { Ed25519CryptoProvider } from '../../infrastructure/Ed25519CryptoProvider.js'
import { ed25519TestKeys, signWithTestKey } from '../../infrastructure/testing/ed25519TestKeys.js'
import { authTokenFor, bearer } from './authTestSupport.js'
import { PostgresSignatureRepository } from '../../infrastructure/db/PostgresSignatureRepository.js'
import { Signature } from '../../domain/entities/Signature.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

let aliceToken: string
let bobToken: string

beforeAll(async () => {
  await ensureSeedUsers()
  aliceToken = await authTokenFor('user-alice', ed25519TestKeys.alice)
  bobToken = await authTokenFor('user-bob', ed25519TestKeys.bob)
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
    expect(typeof body.originalHash).toBe('string')
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

  it('returns valid: true with an empty chain for a document with no signatures', async () => {
    const document = await uploadADocument()

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toEqual([])
  })

  it('returns 404 when verifying a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc/verify', { headers: bearer(aliceToken) })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('DocumentNotFoundError')
  })

  it('resolves signers to username and email for an admin', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    const body = await verifyRes.json()
    expect(body.valid).toBe(true)
    expect(body.signatures).toHaveLength(1)
    expect(body.signatures[0].userId).toBe('user-alice')
    expect(body.signatures[0].username).toBe('alice')
    expect(body.signatures[0].email).toBe('alice@example.com')
    expect(typeof body.signatures[0].signedAt).toBe('string')
    expect(body.signatures[0].signatureData).toBeUndefined()
  })

  it('rejects verification by a non-admin with 403', async () => {
    const document = await uploadADocument()

    const res = await app.request(`/documents/${document.id}/verify`, { headers: bearer(bobToken) })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.type).toBe('ForbiddenError')
  })

  it('reports valid: false when a stored signature does not actually verify', async () => {
    const document = await uploadADocument()

    // Write a signature row straight past the signing endpoint, carrying bytes
    // that were never produced by alice's key. This is the forgery case the
    // whole screen exists to catch: the row exists, so any check that merely
    // read the database would call this document signed.
    const forged = Signature.create({
      id: randomUUID(),
      documentId: document.id,
      userId: 'user-alice',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(9)).value,
      signedAt: new Date()
    }).value
    await new PostgresSignatureRepository().save(forged)

    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(aliceToken) })

    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.valid).toBe(false)
    expect(body.reason).toMatch(/cryptographic verification failed/)
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

  it('reports signedByUser: false to another user after alice signs', async () => {
    const document = await uploadADocument()
    const signatureBytes = computeAliceSignatureBytes(document.originalHash)
    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })
    expect(signRes.status).toBe(201)

    const asAlice = await (await app.request(`/documents/${document.id}`, { headers: bearer(aliceToken) })).json()
    const asBob = await (await app.request(`/documents/${document.id}`, { headers: bearer(bobToken) })).json()

    expect(asAlice.signedByUser).toBe(true)
    expect(asBob.signedByUser).toBe(false)
    expect(asBob.signingPayload).not.toBeNull()
  })

  it('returns 404 for a document that does not exist', async () => {
    const res = await app.request('/documents/missing-doc', { headers: bearer(aliceToken) })

    expect(res.status).toBe(404)
  })
})

describe('upload authorization', () => {
  it('rejects an upload from a non-admin with 403', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(bobToken),
      body: JSON.stringify({
        title: 'Contract',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.type).toBe('ForbiddenError')
  })

  it('allows an upload from an admin', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: bearer(aliceToken),
      body: JSON.stringify({
        title: 'Contract',
        fileBytes: Buffer.from('hello world').toString('base64')
      })
    })

    expect(res.status).toBe(201)
  })

  it('still lets a non-admin list, read, and sign, but not verify', async () => {
    const document = await uploadADocument()

    const listRes = await app.request('/documents', { headers: bearer(bobToken) })
    expect(listRes.status).toBe(200)

    const detailRes = await app.request(`/documents/${document.id}`, { headers: bearer(bobToken) })
    expect(detailRes.status).toBe(200)
    const detail = await detailRes.json()

    const signatureBytes = signWithTestKey(
      ed25519TestKeys.bob,
      new Uint8Array(Buffer.from(detail.signingPayload, 'base64'))
    )
    const signRes = await app.request(`/documents/${document.id}/signatures`, {
      method: 'POST',
      headers: bearer(bobToken),
      body: JSON.stringify({ signatureBytes: Buffer.from(signatureBytes).toString('base64') })
    })
    expect(signRes.status).toBe(201)

    // Verification is admin-only (see 'GET /documents/:documentId/verify' >
    // 'rejects verification by a non-admin with 403'), so a non-admin who can
    // list, read, and sign is still turned away here.
    const verifyRes = await app.request(`/documents/${document.id}/verify`, { headers: bearer(bobToken) })
    expect(verifyRes.status).toBe(403)
  })
})
