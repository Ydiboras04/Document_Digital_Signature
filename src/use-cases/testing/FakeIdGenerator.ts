import { IdGenerator } from '../ports/IdGenerator.js'

export class FakeIdGenerator implements IdGenerator {
  private counter = 0

  constructor(private readonly prefix: string = 'fake-id') {}

  generate(): string {
    this.counter += 1
    return `${this.prefix}-${this.counter}`
  }
}
