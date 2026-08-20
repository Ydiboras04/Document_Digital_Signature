/// <reference types="node" />


import { defineConfig } from 'drizzle-kit'
import process from 'process'

process.loadEnvFile('.env')

export default defineConfig({
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
})
