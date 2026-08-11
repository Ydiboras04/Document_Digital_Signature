// src/domain/entities/Document.test.ts
import { describe, it, expect } from 'vitest'
import { Document } from './Document'
import { Hash } from '../value-objects/Hash'

function aHash(): Hash {
  return Hash.create(new Uint8Array(32).fill(1)).value
}

describe('Document', () => {
  it('creates a valid document', () => {
    const result = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: 'user-1'
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.title).toBe('Contract')
  })

  it('rejects an empty title', () => {
    const result = Document.create({
      id: 'doc-1',
      title: '  ',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: 'user-1'
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty filePath', () => {
    const result = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: '',
      originalHash: aHash(),
      uploaderId: 'user-1'
    })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty uploaderId', () => {
    const result = Document.create({
      id: 'doc-1',
      title: 'Contract',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: ''
    })
    expect(result.isFail()).toBe(true)
  })

  it('is immutable to mutations of the caller-supplied props object', () => {
    const props = {
      id: 'doc-1',
      title: 'Contract',
      filePath: '/files/contract.pdf',
      originalHash: aHash(),
      uploaderId: 'user-1'
    }
    const document = Document.create(props).value

    props.title = 'Mutated Title'
    props.filePath = '/files/mutated.pdf'
    props.uploaderId = 'user-2'

    expect(document.title).toBe('Contract')
    expect(document.filePath).toBe('/files/contract.pdf')
    expect(document.uploaderId).toBe('user-1')
  })
})
