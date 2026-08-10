import { Result } from '../result/Result'
import { InvalidUserError } from '../errors/InvalidUserError'
import { PublicKey } from '../value-objects/PublicKey'

export interface UserProps {
  id: string
  username: string
  email: string
  publicKey: PublicKey
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(props: UserProps): Result<User, InvalidUserError> {
    if (!props.id) {
      return Result.fail(new InvalidUserError('id must not be empty'))
    }
    if (!props.username || props.username.trim().length === 0) {
      return Result.fail(new InvalidUserError('username must not be empty'))
    }
    if (!EMAIL_PATTERN.test(props.email)) {
      return Result.fail(new InvalidUserError(`invalid email: ${props.email}`))
    }
    return Result.ok(new User(props))
  }

  get id(): string {
    return this.props.id
  }

  get username(): string {
    return this.props.username
  }

  get email(): string {
    return this.props.email
  }

  get publicKey(): PublicKey {
    return this.props.publicKey
  }
}
