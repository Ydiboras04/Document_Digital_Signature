# DiskFileStorage — Design Spec

Date: 2026-08-20
Status: Approved

## Purpose

Replace `InMemoryFileStorage` with a real, disk-backed implementation of the
`FileStorage` port, so uploaded document content survives a server
restart. This closes the last remaining backend gap identified after the
Postgres migration and the Ed25519 CryptoProvider work; after this, the
only thing left before the Flutter mobile app is the Flutter mobile app
itself.

## Scope

Only `store()` changes implementation. The `FileStorage` port itself is
unchanged (`store(bytes: Uint8Array): Promise<string>` — still no read
method). Retrieving stored file content (a download endpoint, a `read()`
port method) is explicitly out of scope — a separate future sub-project if
there's ever an actual need for it.

## DiskFileStorage

```
src/infrastructure/DiskFileStorage.ts       # replaces InMemoryFileStorage.ts
src/infrastructure/DiskFileStorage.test.ts  # replaces InMemoryFileStorage.test.ts
```

- Constructor takes an optional `directory` parameter, defaulting to
  `'./uploads'` (same optional-param pattern as `FakeClock`'s
  `fixedTime`). Ensures the directory exists via
  `fs.mkdirSync(directory, { recursive: true })`.
- `store(bytes)`: generates a key via `crypto.randomUUID()` (same as
  `InMemoryFileStorage` today), writes the bytes to `<directory>/<uuid>`
  via `fs.promises.writeFile()`, and returns the UUID — an opaque key, not
  an absolute path.

**Why an opaque key, not an absolute path:** `Document.filePath` already
gets serialized directly in HTTP responses (`toDocumentJson()`). Returning
an absolute filesystem path would leak local directory structure to API
clients; a bare UUID carries no such information and matches
`InMemoryFileStorage`'s existing return-value shape exactly (a `Map` key,
also just the UUID).

## Git

`uploads/` (the default directory) is added to `.gitignore` — uploaded
content is user data, not source.

## Error Handling

Write failures (disk full, permission denied, etc.) propagate as rejected
promises, uncaught — same convention as every other infrastructure port
since the original Upload sub-project's spec: `Result` is reserved for
expected domain/business outcomes, not infrastructure failures.

## Testing

`DiskFileStorage.test.ts` writes real files into the actual `uploads/`
directory (no separate test-only directory) — but tracks every file path
it creates during the test run and deletes them in `afterEach`, so
repeated test runs don't accumulate garbage in `uploads/`.

Coverage mirrors `InMemoryFileStorage.test.ts`'s existing shape: `store()`
returns a non-empty string key, two calls return different keys — plus a
new assertion specific to real disk storage: the file actually exists on
disk afterward, with the exact bytes that were stored.

## Composition

`composition.ts`: `InMemoryFileStorage` → `DiskFileStorage`.

## Out of Scope

- Any way to read stored content back (download route, `FileStorage` read
  method).
- Cloud/object storage (S3-equivalent) — local disk only, consistent with
  the project's "no Docker, no hosted service" choice for Postgres too.
- The Flutter mobile app — the one remaining item after this sub-project,
  per the user's stated build order.
