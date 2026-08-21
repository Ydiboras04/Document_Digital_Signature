import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { decodeBase64 } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'

export const TOKEN_TTL_SECONDS = 3600

export function createAuthRoutes(dependencies: Dependencies): Hono {
  const auth = new Hono()

  auth.post('/auth/challenge', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body.userId !== 'string' || body.userId.length === 0) {
      return c.json({ error: { type: 'ValidationError', message: 'userId is required' } }, 400)
    }

    const result = await dependencies.requestChallengeUseCase.execute({ userId: body.userId })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json({ challenge: Buffer.from(result.value).toString('base64') }, 200)
  })

  auth.post('/auth/token', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      body === null ||
      typeof body.userId !== 'string' ||
      body.userId.length === 0 ||
      typeof body.signature !== 'string'
    ) {
      return c.json({ error: { type: 'ValidationError', message: 'userId and signature are required' } }, 400)
    }

    const result = await dependencies.verifyChallengeUseCase.execute({
      userId: body.userId,
      signatureBytes: decodeBase64(body.signature)
    })
    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    const token = await sign(
      {
        sub: result.value.id,
        isAdmin: result.value.isAdmin,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
      },
      dependencies.jwtSecret
    )

    return c.json({ token }, 200)
  })

  return auth
}
