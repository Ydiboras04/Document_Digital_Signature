# Hono App Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a minimal, runnable Hono HTTP app on Node.js with a single `GET /health` route, proving the interface-adapter layer is wired correctly — with no business logic attached yet.

**Architecture:** `app.ts` exports a configured `Hono` instance built from a `routes/health.ts` sub-app; `server.ts` is the only file that actually starts a listening process, via `@hono/node-server`. Keeping `app` and `server` separate means the app can be tested with Hono's in-memory `app.request()` without ever binding a port.

**Tech Stack:** Hono 4.x, `@hono/node-server` 2.x (Node adapter), `tsx` (dev-time TS runner), Vitest (already in the project), TypeScript (already in the project).

## Global Constraints

- Runtime is Node.js (not Bun, not Cloudflare Workers) — per spec `docs/superpowers/specs/2026-08-13-hono-app-skeleton-design.md`.
- No business routes, use-case wiring, validation, auth, global error handler, CORS, or logging in this plan — explicitly out of scope per spec.
- New HTTP code lives under `src/interface-adapters/http/`, matching the folder name chosen in brainstorming (not `src/http/` or `src/api/`).
- Tests colocated with source files, consistent with the existing domain-layer convention (see `src/domain/entities/Document.test.ts` for the pattern).
- `package.json` already has `"type": "module"` — all new files use ESM `import`/`export` syntax, no `require()`.

---

### Task 1: Add Hono dependencies and npm scripts

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `hono`, `@hono/node-server` as runtime dependencies; `tsx`, `@types/node` as devDependencies; `dev`, `build`, `start` npm scripts. Later tasks' code (`import { Hono } from 'hono'`, `import { serve } from '@hono/node-server'`) depends on these being installed.

- [ ] **Step 1: Install the runtime dependencies**

Run:
```bash
npm install hono@^4.13.1 @hono/node-server@^2.1.0
```

- [ ] **Step 2: Install the dev dependencies**

Run:
```bash
npm install -D tsx@^4.23.12 @types/node@^24.13.1
```

`@types/node` is required because `server.ts` (Task 4) reads `process.env.PORT` — without it, TypeScript has no type for the global `process`, and `npm run typecheck` fails with `Cannot find name 'process'`. The version is pinned to the `24.x` line to match the installed Node runtime (`node --version` → `v24.11.1`), not the newer `26.x` typings line which may describe APIs not present in this runtime.

- [ ] **Step 3: Add `dev`, `build`, and `start` scripts**

Open `package.json` and update the `"scripts"` block to:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "dev": "tsx watch src/interface-adapters/http/server.ts",
  "build": "tsc",
  "start": "node dist/interface-adapters/http/server.js"
}
```

- [ ] **Step 4: Verify installation**

Run: `npm run typecheck`
Expected: passes with no errors (no new source files exist yet, so this just confirms the install didn't break anything).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Hono, node-server, and tsx dependencies"
```

---

### Task 2: Health route + failing test (TDD red)

**Files:**
- Create: `src/interface-adapters/http/routes/health.ts`
- Test: `src/interface-adapters/http/health.test.ts`

**Interfaces:**
- Consumes: `Hono` class from the `hono` package (installed in Task 1).
- Produces: `health` — a named export from `routes/health.ts`, typed `Hono`, with a `GET /health` route registered on it returning `{ status: 'ok' }` as JSON with a 200 status. Task 3 (`app.ts`) mounts this export via `app.route('/', health)`.

- [ ] **Step 1: Write the failing test**

Create `src/interface-adapters/http/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { app } from './app'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })
})
```

Note: this test imports `./app`, which doesn't exist yet — that's created in Task 3. This is intentional; the test defines the full contract (route path, status, body shape) before either `health.ts` or `app.ts` exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- health.test.ts`
Expected: FAIL — `Cannot find module './app'` (or similar module-resolution error), since `app.ts` doesn't exist yet.

- [ ] **Step 3: Create the health route**

Create `src/interface-adapters/http/routes/health.ts`:

```ts
import { Hono } from 'hono'

export const health = new Hono()

health.get('/health', (c) => c.json({ status: 'ok' }))
```

- [ ] **Step 4: Commit**

```bash
git add src/interface-adapters/http/routes/health.ts src/interface-adapters/http/health.test.ts
git commit -m "test: add failing health route test and health route"
```

(The test still fails after this step — `app.ts` is created in Task 3. Committing here keeps the red-test-plus-implementation-unit together as one reviewable step, matching the domain layer's TDD pattern.)

---

### Task 3: App assembly (TDD green)

**Files:**
- Create: `src/interface-adapters/http/app.ts`

**Interfaces:**
- Consumes: `health` from `./routes/health` (produced in Task 2).
- Produces: `app` — a named export from `app.ts`, typed `Hono`, with the health sub-app mounted. Task 4 (`server.ts`) and Task 2's test both import this export directly.

- [ ] **Step 1: Create the app**

Create `src/interface-adapters/http/app.ts`:

```ts
import { Hono } from 'hono'
import { health } from './routes/health'

export const app = new Hono()

app.route('/', health)
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- health.test.ts`
Expected: PASS — 1 test passed.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all previously-passing domain tests still pass, plus the new health test — total test count increases by 1 (51 → 52).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/interface-adapters/http/app.ts
git commit -m "feat: assemble Hono app with health route"
```

---

### Task 4: Node server entrypoint

**Files:**
- Create: `src/interface-adapters/http/server.ts`

**Interfaces:**
- Consumes: `app` from `./app` (produced in Task 3); `serve` from `@hono/node-server` (installed in Task 1).
- Produces: nothing consumed by other source files — this is the process entrypoint, invoked directly by `npm run dev` / `npm start`, not imported anywhere.

- [ ] **Step 1: Create the server entrypoint**

Create `src/interface-adapters/http/server.ts`:

```ts
import { serve } from '@hono/node-server'
import { app } from './app'

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors. (This is what confirms the `@types/node` install in Task 1 was necessary and sufficient — `process.env` resolves correctly.)

- [ ] **Step 3: Start the dev server and manually verify**

Run: `npm run dev`
Expected console output: `Server listening on http://localhost:3000`

In a separate terminal, run:
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok"}`

Stop the dev server (Ctrl+C) once verified.

- [ ] **Step 4: Verify the production build works too**

Run:
```bash
npm run build
npm start
```
Expected console output: `Server listening on http://localhost:3000`

Verify again with `curl http://localhost:3000/health` → `{"status":"ok"}`, then stop the server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add src/interface-adapters/http/server.ts
git commit -m "feat: add Node server entrypoint for Hono app"
```

---

## Post-plan state

After Task 4, running `npm run dev` (or `npm run build && npm start`) starts a real HTTP server on port 3000 (overridable via `PORT`) that responds to `GET /health` with `{"status":"ok"}`. `npm test` and `npm run typecheck` both pass. No route touches `src/domain` — the domain core remains fully framework-independent, as verified in the earlier testing step. Real business endpoints, use-case wiring, and error handling are follow-up sub-projects per the spec.
