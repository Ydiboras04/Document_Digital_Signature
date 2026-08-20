import { Hono } from 'hono'
import { health } from './routes/health.js'
import { createDocumentsRoutes } from './routes/documents.js'
import { createDependencies } from '../../infrastructure/composition.js'

export const app = new Hono()

const dependencies = createDependencies()

app.route('/', health)
app.route('/', createDocumentsRoutes(dependencies))
