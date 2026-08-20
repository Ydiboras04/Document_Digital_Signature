import { Clock } from '../use-cases/ports/Clock.js'

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
