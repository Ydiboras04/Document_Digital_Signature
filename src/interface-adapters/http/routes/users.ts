import { Hono } from 'hono'
import type { Dependencies } from '../../../infrastructure/composition.js'
import { toUserJson, decodeBase64 } from '../serialization.js'
import { mapDomainErrorToResponse } from '../errorMapping.js'

export function createUsersRoutes(dependencies: Dependencies): Hono {
  const users = new Hono()

  users.post('/users', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      body === null ||
      typeof body.username !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.publicKeyBytes !== 'string'
    ) {
      return c.json(
        { error: { type: 'ValidationError', message: 'username, email, and publicKeyBytes are required strings' } },
        400
      )
    }

    const result = await dependencies.createUserUseCase.execute({
      username: body.username,
      email: body.email,
      publicKeyBytes: decodeBase64(body.publicKeyBytes)
    })

    if (result.isFail()) {
      const { status, body: errorBody } = mapDomainErrorToResponse(result.error)
      return c.json(errorBody, status)
    }

    return c.json(toUserJson(result.value), 201)
  })

  return users
}
