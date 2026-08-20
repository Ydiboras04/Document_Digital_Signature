import { Hono } from 'hono'
import { health } from './routes/health.js'
import { createDocumentsRoutes } from './routes/documents.js'
import { createUsersRoutes } from './routes/users.js'
import { createDependencies } from '../../infrastructure/composition.js'

export const app = new Hono()

const dependencies = createDependencies()

app.route('/', health)
app.route('/', createDocumentsRoutes(dependencies))
app.route('/', createUsersRoutes(dependencies))
