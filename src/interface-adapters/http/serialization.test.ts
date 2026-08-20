import { describe, it, expect } from 'vitest'
import { toDocumentJson, toSignatureJson, toUserJson, decodeBase64 } from './serialization.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { User } from '../../domain/entities/User.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'

describe('toDocumentJson', () => {
  it('serializes a Document with hex-encoded originalHash', () => {
    const document = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: 'file-key-1',
      originalHash: Hash.create(new Uint8Array(32).fill(5)).value,
      uploaderId: 'user-1'
    }).value

    const json = toDocumentJson(document)

    expect(json).toEqual({
      id: 'doc-1',
      title: 'Contract',
      filePath: 'file-key-1',
      originalHash: '05'.repeat(32),
      uploaderId: 'user-1'
    })
  })
})

describe('toSignatureJson', () => {
  it('serializes a Signature with base64 signatureData and ISO signedAt', () => {
    const signature = Signature.create({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: SignatureBytes.create(new Uint8Array(64).fill(1)).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value

    const json = toSignatureJson(signature)

    expect(json).toEqual({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: Buffer.from(new Uint8Array(64).fill(1)).toString('base64'),
      signedAt: '2026-08-10T00:00:00.000Z'
    })
  })
})

describe('toUserJson', () => {
  it('serializes a User with base64-encoded publicKey', () => {
    const user = User.create({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: PublicKey.create(new Uint8Array(32).fill(7)).value
    }).value

    const json = toUserJson(user)

    expect(json).toEqual({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
    })
  })
})

describe('decodeBase64', () => {
  it('round-trips bytes through base64 encoding and decoding', () => {
    const original = new Uint8Array([10, 20, 30, 255])
    const encoded = Buffer.from(original).toString('base64')

    const decoded = decodeBase64(encoded)

    expect(decoded).toEqual(original)
  })
})
