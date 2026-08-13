import { Result } from '../result/Result'
import { DuplicateSignatureError } from '../errors/DuplicateSignatureError'
import { Document } from '../entities/Document'
import { Signature } from '../entities/Signature'
import { Hash } from '../value-objects/Hash'
import { CryptoProvider } from '../ports/CryptoProvider'
import { BrokenChainError } from '../errors/BrokenChainError'
import { PublicKey } from '../value-objects/PublicKey'

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

export class SignatureChainService {
  constructor(private readonly crypto: CryptoProvider) { }

  assertCanSign(
    document: Document,
    existingSignatures: Signature[],
    userId: string
  ): Result<true, DuplicateSignatureError> {
    const signaturesForDocument = existingSignatures.filter((s) => s.documentId === document.id)
    const alreadySigned = signaturesForDocument.some((s) => s.userId === userId)
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

  verifyChain(
    document: Document,
    orderedSignatures: Signature[],
    publicKeysByUserId: Map<string, PublicKey>
  ): Result<true, BrokenChainError> {
    let previous: Signature | null = null

    for (const signature of orderedSignatures) {
      if (signature.documentId !== document.id) {
        return Result.fail(new BrokenChainError(signature.id, 'signature does not belong to this document'))
      }

      const expectedPreviousId = previous === null ? null : previous.id
      if (signature.previousSignatureId !== expectedPreviousId) {
        return Result.fail(
          new BrokenChainError(signature.id, 'previousSignatureId does not match actual chain order')
        )
      }

      const publicKey = publicKeysByUserId.get(signature.userId)
      if (!publicKey) {
        return Result.fail(new BrokenChainError(signature.id, `no public key found for user ${signature.userId}`))
      }

      const message = this.buildSigningPayload(document, previous)
      const isValid = this.crypto.verify(publicKey, message, signature.signatureData)
      if (!isValid) {
        return Result.fail(new BrokenChainError(signature.id, 'cryptographic verification failed'))
      }

      previous = signature
    }

    return Result.ok(true)
  }

  findTip(signatures: Signature[]): Signature | null {
    if (signatures.length === 0) {
      return null
    }
    const referencedIds = new Set(
      signatures
        .map((s) => s.previousSignatureId)
        .filter((id): id is string => id !== null)
    )
    return signatures.find((s) => !referencedIds.has(s.id)) ?? null
  }

  orderChain(signatures: Signature[]): Result<Signature[], BrokenChainError> {
    if (signatures.length === 0) {
      return Result.ok([])
    }

    const heads = signatures.filter((s) => s.previousSignatureId === null)
    if (heads.length === 0) {
      return Result.fail(
        new BrokenChainError(signatures[0].id, 'no signature found with previousSignatureId null (missing chain head)')
      )
    }
    if (heads.length > 1) {
      return Result.fail(
        new BrokenChainError(heads[1].id, 'multiple signatures found with previousSignatureId null (ambiguous chain head)')
      )
    }

    const nextById = new Map<string, Signature>()
    for (const s of signatures) {
      if (s.previousSignatureId !== null) {
        if (nextById.has(s.previousSignatureId)) {
          return Result.fail(
            new BrokenChainError(s.id, `multiple signatures reference previousSignatureId ${s.previousSignatureId}`)
          )
        }
        nextById.set(s.previousSignatureId, s)
      }
    }

    const ordered: Signature[] = []
    const visited = new Set<string>()
    let current: Signature | undefined = heads[0]
    while (current !== undefined) {
      if (visited.has(current.id)) {
        return Result.fail(new BrokenChainError(current.id, 'cycle detected in signature chain'))
      }
      visited.add(current.id)
      ordered.push(current)
      current = nextById.get(current.id)
    }

    if (ordered.length !== signatures.length) {
      const orphan = signatures.find((s) => !visited.has(s.id))
      return Result.fail(new BrokenChainError(orphan!.id, 'signature is not reachable from the chain head'))
    }

    return Result.ok(ordered)
  }

}
