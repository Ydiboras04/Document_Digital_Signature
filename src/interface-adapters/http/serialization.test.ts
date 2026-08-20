import { describe, it, expect } from 'vitest'
import { toDocumentJson, toSignatureJson, decodeBase64 } from './serialization.js'
import { Document } from '../../domain/entities/Document.js'
import { Signature } from '../../domain/entities/Signature.js'
import { Hash } from '../../domain/value-objects/Hash.js'
import { SignatureBytes } from '../../domain/value-objects/SignatureBytes.js'

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
      signatureData: SignatureBytes.create(new Uint8Array([1, 2, 3])).value,
      signedAt: new Date('2026-08-10T00:00:00Z')
    }).value

    const json = toSignatureJson(signature)

    expect(json).toEqual({
      id: 'sig-1',
      documentId: 'doc-1',
      userId: 'user-1',
      previousSignatureId: null,
      signatureData: Buffer.from([1, 2, 3]).toString('base64'),
      signedAt: '2026-08-10T00:00:00.000Z'
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
