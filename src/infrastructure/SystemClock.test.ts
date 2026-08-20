import { describe, it, expect } from 'vitest'
import { SystemClock } from './SystemClock.js'

describe('SystemClock', () => {
  it('returns a Date close to the actual current time', () => {
    const clock = new SystemClock()
    const before = Date.now()

    const now = clock.now()

    const after = Date.now()
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(after + 1000)
  })
})
