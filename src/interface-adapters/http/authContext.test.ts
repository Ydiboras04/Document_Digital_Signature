import { describe, it, expect } from 'vitest'
import type { Context } from 'hono'
import { isAuthenticatedUserAdmin } from './authContext.js'

/**
 * A minimal stub of the slice of Hono's Context that isAuthenticatedUserAdmin
 * actually touches: c.get('jwtPayload'). Anything more would be testing Hono,
 * not this function.
 */
function contextWithPayload(payload: unknown): Context {
  return {
    get: (key: string) => (key === 'jwtPayload' ? payload : undefined)
  } as unknown as Context
}

describe('isAuthenticatedUserAdmin', () => {
  const cases: Array<{ name: string; payload: unknown; expected: boolean }> = [
    { name: 'no jwtPayload claim at all (predates the claim)', payload: {}, expected: false },
    { name: 'isAdmin as the string "true"', payload: { isAdmin: 'true' }, expected: false },
    { name: 'isAdmin as the number 1', payload: { isAdmin: 1 }, expected: false },
    { name: 'isAdmin explicitly false', payload: { isAdmin: false }, expected: false },
    { name: 'isAdmin explicitly true', payload: { isAdmin: true }, expected: true }
  ]

  for (const { name, payload, expected } of cases) {
    it(`returns ${expected} for ${name}`, () => {
      expect(isAuthenticatedUserAdmin(contextWithPayload(payload))).toBe(expected)
    })
  }

  it('returns false when jwtPayload itself is undefined', () => {
    expect(isAuthenticatedUserAdmin(contextWithPayload(undefined))).toBe(false)
  })
})
