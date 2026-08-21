import type { Context } from 'hono'

/**
 * Reads the authenticated user id from the JWT payload that Hono's `jwt`
 * middleware placed on the context. Throwing here means a route was mounted
 * without the middleware -- a wiring bug, not a client error.
 */
export function getAuthenticatedUserId(c: Context): string {
  const payload = c.get('jwtPayload') as { sub?: unknown } | undefined
  const sub = payload?.sub
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('jwtPayload.sub is missing - this route is not behind the JWT middleware')
  }
  return sub
}

/**
 * Reads the admin claim from the already-verified JWT payload.
 *
 * An absent or non-boolean claim reads as false, so tokens issued before the
 * claim existed degrade to regular-user access rather than to admin.
 */
export function isAuthenticatedUserAdmin(c: Context): boolean {
  const payload = c.get('jwtPayload') as { isAdmin?: unknown } | undefined
  return payload?.isAdmin === true
}
