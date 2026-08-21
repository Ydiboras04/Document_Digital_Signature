/**
 * Read at composition time so a missing secret fails the process at startup
 * with a clear message, rather than silently signing tokens with `undefined`.
 */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT_SECRET environment variable is required but was not set')
  }
  return secret
}
