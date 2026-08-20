import { createPrivateKey, sign as cryptoSign } from 'node:crypto'

export interface Ed25519TestKeyPair {
  publicKeyBase64Url: string
  privateKeyBase64Url: string
  publicKeyBytes: Uint8Array
}

function keyPair(publicKeyBase64Url: string, privateKeyBase64Url: string): Ed25519TestKeyPair {
  return {
    publicKeyBase64Url,
    privateKeyBase64Url,
    publicKeyBytes: new Uint8Array(Buffer.from(publicKeyBase64Url, 'base64url'))
  }
}

// Generated once for this project's tests. NOT real user key material --
// there is no mobile app yet, so these exist purely so tests and manual
// verification can produce valid Ed25519 signatures to check verify()
// against. CryptoProvider has no sign() -- production code never signs
// anything server-side, so this private key material never appears
// outside test code.
export const ed25519TestKeys = {
  alice: keyPair('XHDfZbVeUWFelOFPeMin_8LM7rIPtyI6thZhY_HhSxQ', 'r0Cgzweco6jmUW9UdVqbX_0Jdu90hI24sCptHFBf56o'),
  bob: keyPair('T5nOsL2FgGY_3Jqij-UdBvC07rOe8Cr-CoMMNgcCSCk', 'eceG7cqj14GKxppK8LJSRP1nR3gg9oiPX-V_3pq_uF8'),
  carol: keyPair('ISp-DYexWlGL4kWxJb7dRI6htmAsgjhfsxIeCHs__2g', 'uMa2O3m1Z2adDNhacCGva1ZmBWqk3CANXsCFIkXzEEQ')
} as const

export function signWithTestKey(keyPair: Ed25519TestKeyPair, message: Uint8Array): Uint8Array {
  const privateKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: keyPair.publicKeyBase64Url, d: keyPair.privateKeyBase64Url },
    format: 'jwk'
  })
  return new Uint8Array(cryptoSign(null, message, privateKey))
}
