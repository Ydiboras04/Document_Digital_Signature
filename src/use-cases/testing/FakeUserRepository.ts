import { User } from '../../domain/entities/User.js'
import { UserRepository } from '../ports/UserRepository.js'

export class FakeUserRepository implements UserRepository {
  readonly users: User[] = []

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null
  }

  async save(user: User): Promise<void> {
    this.users.push(user)
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((u) => u.email === email) ?? null
  }
}
