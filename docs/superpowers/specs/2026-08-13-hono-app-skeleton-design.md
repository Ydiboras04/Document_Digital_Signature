# Hono App Skeleton — Design Spec

Date: 2026-08-13
Status: Approved

## Purpose

Stand up the HTTP interface-adapter layer of SecureDoc Chain's backend: a
minimal, runnable Hono application with no business logic wired in yet. This
proves the framework is correctly installed and configured, and gives later
sub-projects (use cases, real endpoints) a place to attach routes.

This is a skeleton only. It does not call into `src/domain` — there is no
use-case layer yet for it to call. Real business endpoints, request
validation, auth, structured error responses, CORS, and logging are all out
of scope and will follow in later design/plan cycles.

## Runtime & Dependencies

Target runtime: **Node.js**, via the `@hono/node-server` adapter.

New dependencies:
- `hono` (runtime)
- `@hono/node-server` (runtime — Node adapter for Hono)
- `tsx` (devDependency — runs/watches the TypeScript entrypoint directly in
  dev; the project has no bundler or ts-node today)

## Project Layout

```
src/
  domain/           (existing, unchanged)
  interface-adapters/
    http/
      app.ts              # exports configured Hono instance
      server.ts           # Node entrypoint: serve(app) via @hono/node-server
      routes/
        health.ts          # GET /health route
      health.test.ts       # Vitest test using app.request()
```

## Components

- **`app.ts`**: exports a configured `Hono` instance with routes registered.
  The app itself is exported (not a running server), so it can be tested
  directly via Hono's built-in `app.request()` without starting a real HTTP
  server.
- **`routes/health.ts`**: registers `GET /health`, returning
  `{ status: "ok" }` with a 200. This is the one concrete endpoint in the
  skeleton, included to prove routing works end-to-end.
- **`server.ts`**: the Node process entrypoint. Imports `app` from `app.ts`
  and starts it with `@hono/node-server`'s `serve()`. Reads `PORT` from the
  environment (default `3000`).

## Error Handling

None beyond Hono's built-in defaults: default 404 for unmatched routes,
default 500 for uncaught throws. No `app.onError()` global handler yet —
deferred until real endpoints exist with real domain errors that need
mapping to HTTP status codes.

## Testing

- `health.test.ts` colocated next to the route it tests, consistent with the
  domain layer's colocated-test convention.
- Uses Vitest + Hono's `app.request('/health')` to assert a 200 response and
  the expected JSON body. No real server process is started for this test.

## package.json Changes

New scripts:
- `"dev": "tsx watch src/interface-adapters/http/server.ts"`
- `"build": "tsc"`
- `"start": "node dist/interface-adapters/http/server.js"`

## Out of Scope (future sub-projects)

- Real business routes (Upload, Sign, Verify).
- Use-case layer wiring.
- Request validation.
- Auth middleware.
- Structured/global error handling (`app.onError()`).
- CORS.
- Logging.
- PostgreSQL / infrastructure wiring.
