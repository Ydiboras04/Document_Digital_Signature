import { Hono } from 'hono'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { toDocumentJson, toSignatureJson, decodeBase64 } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'
import { DocumentNotFoundError } from '../../../domain/errors/DocumentNotFoundError.js'

export function createDocumentsRoutes(dependencies: Dependencies): Hono {
  const documents = new Hono()

  documents.post('/documents', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      body === null ||
      typeof body.title !== 'string' ||
      typeof body.uploaderId !== 'string' ||
      typeof body.fileBytes !== 'string'
    ) {
      return c.json(
        { error: { type: 'ValidationError', message: 'title, uploaderId, and fileBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.uploadDocumentUseCase.execute({
      title: body.title,
      uploaderId: body.uploaderId,
      fileBytes: decodeBase64(body.fileBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentJson(result.value), 201)
  })

  documents.post('/documents/:documentId/signatures', async (c) => {
    const documentId = c.req.param('documentId')
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.userId !== 'string' || typeof body.signatureBytes !== 'string') {
      return c.json(
        { error: { type: 'ValidationError', message: 'userId and signatureBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.signDocumentUseCase.execute({
      documentId,
      userId: body.userId,
      signatureBytes: decodeBase64(body.signatureBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toSignatureJson(result.value), 201)
  })

  documents.get('/documents/:documentId/verify', async (c) => {
    const documentId = c.req.param('documentId')

    const result = await dependencies.verifyDocumentUseCase.execute({ documentId })

    if (result.isFail()) {
      const error = result.error
      if (error instanceof DocumentNotFoundError) {
        const { status, body: errorBody } = mapDomainErrorToResponse(error)
        return c.json(errorBody, status)
      }
      return c.json({ valid: false, reason: error.message }, 200)
    }

    return c.json({ valid: true, signatures: result.value.map(toSignatureJson) }, 200)
  })

  return documents
}
