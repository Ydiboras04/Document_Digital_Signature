import { Result } from '../result/Result'
import { InvalidDocumentError } from '../errors/InvalidDocumentError'
import { Hash } from '../value-objects/Hash'

export interface DocumentProps {
  id: string
  title: string
  filePath: string
  originalHash: Hash
  uploaderId: string
}

export class Document {
  private constructor(private readonly props: DocumentProps) {}

  static create(props: DocumentProps): Result<Document, InvalidDocumentError> {
    if (!props.id) {
      return Result.fail(new InvalidDocumentError('id must not be empty'))
    }
    if (!props.title || props.title.trim().length === 0) {
      return Result.fail(new InvalidDocumentError('title must not be empty'))
    }
    if (!props.filePath || props.filePath.trim().length === 0) {
      return Result.fail(new InvalidDocumentError('filePath must not be empty'))
    }
    if (!props.uploaderId) {
      return Result.fail(new InvalidDocumentError('uploaderId must not be empty'))
    }
    return Result.ok(new Document({ ...props }))
  }

  get id(): string {
    return this.props.id
  }

  get title(): string {
    return this.props.title
  }

  get filePath(): string {
    return this.props.filePath
  }

  get originalHash(): Hash {
    return this.props.originalHash
  }

  get uploaderId(): string {
    return this.props.uploaderId
  }
}
