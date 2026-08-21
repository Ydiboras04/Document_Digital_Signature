/**
 * Domain-separation context for the authentication challenge-response flow.
 *
 * The same Ed25519 key signs both auth challenges and document payloads, and
 * both are 32 bytes, so without a distinguishing prefix a signature produced by
 * one flow would be accepted by the other -- a malicious challenge could hand a
 * client a document's signing payload and harvest a chain-valid document
 * signature. Prefixing the challenge before hashing exists solely to make an
 * auth signature unusable as a document signature.
 *
 * The client (`flutter_digital_sign/lib/core/auth/auth_session.dart`) applies
 * the identical transformation; the two must be changed together.
 */
export const AUTH_CHALLENGE_CONTEXT = 'SecureDocChain-auth-challenge-v1'

const AUTH_CHALLENGE_CONTEXT_BYTES = new TextEncoder().encode(AUTH_CHALLENGE_CONTEXT)

/**
 * The bytes actually hashed and signed for an auth challenge:
 * the context prefix followed by the raw nonce.
 */
export function authChallengeMessage(challenge: Uint8Array): Uint8Array {
  const message = new Uint8Array(AUTH_CHALLENGE_CONTEXT_BYTES.length + challenge.length)
  message.set(AUTH_CHALLENGE_CONTEXT_BYTES, 0)
  message.set(challenge, AUTH_CHALLENGE_CONTEXT_BYTES.length)
  return message
}
