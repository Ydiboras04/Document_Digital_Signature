import { Result } from '../result/Result'
import { InvalidSignatureError } from '../errors/InvalidSignatureError'
import { SignatureBytes } from '../value-objects/SignatureBytes'

export interface SignatureProps {
  id: string
  documentId: string
  userId: string
  previousSignatureId: string | null
  signatureData: SignatureBytes
  signedAt: Date
}

export class Signature {
  private constructor(private readonly props: SignatureProps) {}

  static create(props: SignatureProps): Result<Signature, InvalidSignatureError> {
    if (!props.id) {
      return Result.fail(new InvalidSignatureError('id must not be empty'))
    }
    if (!props.documentId) {
      return Result.fail(new InvalidSignatureError('documentId must not be empty'))
    }
    if (!props.userId) {
      return Result.fail(new InvalidSignatureError('userId must not be empty'))
    }
    return Result.ok(new Signature({ ...props, signedAt: new Date(props.signedAt.getTime()) }))
  }

  get id(): string {
    return this.props.id
  }

  get documentId(): string {
    return this.props.documentId
  }

  get userId(): string {
    return this.props.userId
  }

  get previousSignatureId(): string | null {
    return this.props.previousSignatureId
  }

  get signatureData(): SignatureBytes {
    return this.props.signatureData
  }

  get signedAt(): Date {
    return new Date(this.props.signedAt.getTime())
  }
}
