import { User } from '../domain/entities/User.js'
import { PublicKey } from '../domain/value-objects/PublicKey.js'

export const seedUsers: User[] = [
  User.create({
    id: 'user-alice',
    username: 'alice',
    email: 'alice@example.com',
    publicKey: PublicKey.create(new Uint8Array([1, 2, 3, 4])).value
  }).value,
  User.create({
    id: 'user-bob',
    username: 'bob',
    email: 'bob@example.com',
    publicKey: PublicKey.create(new Uint8Array([5, 6, 7, 8])).value
  }).value,
  User.create({
    id: 'user-carol',
    username: 'carol',
    email: 'carol@example.com',
    publicKey: PublicKey.create(new Uint8Array([9, 10, 11, 12])).value
  }).value
]
