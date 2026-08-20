import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    // Postgres-backed tests share one real database with no per-file
    // isolation; cleanDatabase() wipes whole tables, so test files must
    // run one at a time or a concurrently-running file's cleanup can
    // delete another file's in-progress test data mid-run.
    fileParallelism: false
  }
})
