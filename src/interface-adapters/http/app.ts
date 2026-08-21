import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { health } from './routes/health.js'
import { createDocumentsRoutes } from './routes/documents.js'
import { createUsersRoutes } from './routes/users.js'
import { createAuthRoutes } from './routes/auth.js'
import { createDependencies } from '../../infrastructure/composition.js'

export const app = new Hono()

const dependencies = createDependencies()

app.use('*', cors())

app.route('/', health)
app.route('/', createDocumentsRoutes(dependencies))
app.route('/', createUsersRoutes(dependencies))
app.route('/', createAuthRoutes(dependencies))
