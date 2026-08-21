import { count, eq } from 'drizzle-orm'
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
      publicKey: PublicKey.create(row.publicKey).value,
      isAdmin: row.isAdmin
    }).value
  }

  async save(user: User): Promise<void> {
    await db.insert(users).values({
      id: user.id,
      username: user.username,
      email: user.email,
      publicKey: user.publicKey.toBytes(),
      isAdmin: user.isAdmin
    })
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return User.create({
      id: row.id,
      username: row.username,
      email: row.email,
      publicKey: PublicKey.create(row.publicKey).value,
      isAdmin: row.isAdmin
    }).value
  }

  /**
   * The only code in the system that can grant or revoke admin. Deliberately
   * not on the UserRepository port: changing a role is an operations concern
   * with no use case behind it, reached only by the db:promote-admin and
   * db:demote-admin scripts.
   */
  async setAdminStatus(userId: string, isAdmin: boolean): Promise<void> {
    await db.update(users).set({ isAdmin }).where(eq(users.id, userId))
  }

  /**
   * Supports the demote script's last-admin guard. Also operations-only, and
   * so also off the port -- no use case asks how many admins exist.
   */
  async countAdmins(): Promise<number> {
    const rows = await db.select({ value: count() }).from(users).where(eq(users.isAdmin, true))
    return rows[0]?.value ?? 0
  }
}
