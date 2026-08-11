import { describe, it, expect } from 'vitest'
import { User } from './User'
import { PublicKey } from '../value-objects/PublicKey'

function aPublicKey(): PublicKey {
  return PublicKey.create(new Uint8Array([1, 2, 3])).value
}

describe('User', () => {
  it('creates a valid user', () => {
    const result = User.create({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: aPublicKey()
    })
    expect(result.isOk()).toBe(true)
    expect(result.value.username).toBe('alice')
    expect(result.value.email).toBe('alice@example.com')
  })

  it('rejects an empty id', () => {
    const result = User.create({ id: '', username: 'alice', email: 'alice@example.com', publicKey: aPublicKey() })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an empty username', () => {
    const result = User.create({ id: 'user-1', username: '  ', email: 'alice@example.com', publicKey: aPublicKey() })
    expect(result.isFail()).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = User.create({ id: 'user-1', username: 'alice', email: 'not-an-email', publicKey: aPublicKey() })
    expect(result.isFail()).toBe(true)
    expect(result.error.message).toContain('email')
  })

  it('is immutable to mutations of the caller-supplied props object', () => {
    const props = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      publicKey: aPublicKey()
    }
    const user = User.create(props).value

    props.username = 'mutated'
    props.email = 'mutated@example.com'

    expect(user.username).toBe('alice')
    expect(user.email).toBe('alice@example.com')
  })
})
