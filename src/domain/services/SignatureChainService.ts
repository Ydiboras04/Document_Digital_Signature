import { Result } from '../result/Result'
import { DuplicateSignatureError } from '../errors/DuplicateSignatureError'
import { Document } from '../entities/Document'
import { Signature } from '../entities/Signature'
import { Hash } from '../value-objects/Hash'
import { CryptoProvider } from '../ports/CryptoProvider'

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

export class SignatureChainService {
  constructor(private readonly crypto: CryptoProvider) {}

  assertCanSign(existingSignatures: Signature[], userId: string): Result<true, DuplicateSignatureError> {
    const alreadySigned = existingSignatures.some((s) => s.userId === userId)
    if (alreadySigned) {
      return Result.fail(new DuplicateSignatureError(userId))
    }
    return Result.ok(true)
  }

  buildSigningPayload(document: Document, previousSignature: Signature | null): Hash {
    if (previousSignature === null) {
      return this.crypto.hash(document.originalHash.toBytes())
    }
    const combined = concatBytes(document.originalHash.toBytes(), previousSignature.signatureData.toBytes())
    return this.crypto.hash(combined)
  }
}
