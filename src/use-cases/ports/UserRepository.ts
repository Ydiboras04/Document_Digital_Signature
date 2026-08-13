import { User } from '../../domain/entities/User.js'

export interface UserRepository {
  findById(id: string): Promise<User | null>
}
