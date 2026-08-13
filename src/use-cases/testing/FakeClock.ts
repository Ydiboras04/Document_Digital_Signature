import { Clock } from '../ports/Clock.js'

export class FakeClock implements Clock {
  constructor(private readonly fixedTime: Date = new Date('2026-08-13T00:00:00Z')) {}

  now(): Date {
    return new Date(this.fixedTime.getTime())
  }
}
