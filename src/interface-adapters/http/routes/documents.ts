import { Hono } from 'hono'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { toDocumentJson, toSignatureJson, decodeBase64, toDocumentDetailJson, toVerifiedSignatureJson } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'
import { DocumentNotFoundError } from '../../../domain/errors/DocumentNotFoundError.js'
import { getAuthenticatedUserId, isAuthenticatedUserAdmin } from '../authContext.js'

export function createDocumentsRoutes(dependencies: Dependencies): Hono {
  const documents = new Hono()

  documents.post('/documents', async (c) => {
    const uploaderId = getAuthenticatedUserId(c)
    if (!isAuthenticatedUserAdmin(c)) {
      return c.json(
        { error: { type: 'ForbiddenError', message: 'Only an administrator may upload documents' } },
        403
      )
    }
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.title !== 'string' || typeof body.fileBytes !== 'string') {
      return c.json(
        { error: { type: 'ValidationError', message: 'title and fileBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.uploadDocumentUseCase.execute({
      title: body.title,
      uploaderId,
      fileBytes: decodeBase64(body.fileBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentJson(result.value), 201)
  })

  documents.post('/documents/:documentId/signatures', async (c) => {
    const userId = getAuthenticatedUserId(c)
    const documentId = c.req.param('documentId')
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.signatureBytes !== 'string') {
      return c.json({ error: { type: 'ValidationError', message: 'signatureBytes is required' } }, 400)
    }

    const result = await dependencies.signDocumentUseCase.execute({
      documentId,
      userId,
      signatureBytes: decodeBase64(body.signatureBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toSignatureJson(result.value), 201)
  })

  documents.get('/documents/:documentId/verify', async (c) => {
    if (!isAuthenticatedUserAdmin(c)) {
      return c.json(
        { error: { type: 'ForbiddenError', message: 'Only an administrator may verify document signatures' } },
        403
      )
    }

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

    return c.json({ valid: true, signatures: result.value.map(toVerifiedSignatureJson) }, 200)
  })

  documents.get('/documents', async (c) => {
    const userId = getAuthenticatedUserId(c)

    const summaries = await dependencies.listDocumentsUseCase.execute({ userId })
    return c.json(summaries, 200)
  })

  documents.get('/documents/:documentId', async (c) => {
    const userId = getAuthenticatedUserId(c)
    const documentId = c.req.param('documentId')

    const result = await dependencies.getDocumentUseCase.execute({ documentId, userId })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toDocumentDetailJson(result.value), 200)
  })

  return documents
}
