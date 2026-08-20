import { eq } from 'drizzle-orm'
import { User } from '../../domain/entities/User.js'
import { PublicKey } from '../../domain/value-objects/PublicKey.js'
import { UserRepository } from '../../use-cases/ports/UserRepository.js'
import { db } from './connection.js'
import { users } from './schema.js'

export class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return User.create({
      id: row.id,
      username: row.username,
      email: row.email,
      publicKey: PublicKey.create(row.publicKey).value
    }).value
  }
}
