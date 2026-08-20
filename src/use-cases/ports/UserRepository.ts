import { User } from '../../domain/entities/User.js'

export interface UserRepository {
  findById(id: string): Promise<User | null>
  save(user: User): Promise<void>
  findByEmail(email: string): Promise<User | null>
}
