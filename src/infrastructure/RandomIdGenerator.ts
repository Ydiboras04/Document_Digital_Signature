import { randomUUID } from 'node:crypto'
import { IdGenerator } from '../use-cases/ports/IdGenerator.js'

export class RandomIdGenerator implements IdGenerator {
  generate(): string {
    return randomUUID()
  }
}
