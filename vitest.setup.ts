/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

process.loadEnvFile('.env')

// The integration tests upload through the real app, so every uploaded
// document was written to the repo's ./uploads by DiskFileStorage and never
// removed -- 371 stray 11-byte 'hello world' files had accumulated there by
// the time this was added. Redirecting storage per test file keeps the
// working tree clean without the tests having to track individual keys.
const uploadsDirectory = mkdtempSync(join(tmpdir(), 'securedoc-uploads-'))
process.env.UPLOADS_DIR = uploadsDirectory

afterAll(() => {
  rmSync(uploadsDirectory, { recursive: true, force: true })
})
