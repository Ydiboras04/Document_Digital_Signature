# DiskFileStorage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `InMemoryFileStorage` with `DiskFileStorage`, a real disk-backed implementation of the `FileStorage` port, so uploaded document content survives a server restart.

**Architecture:** `DiskFileStorage` implements the exact same `FileStorage` port (`store(bytes: Uint8Array): Promise<string>`) — no port changes. It writes to a `./uploads/` directory using Node's built-in `fs`/`fs/promises`, returning a `crypto.randomUUID()` key (same scheme as `InMemoryFileStorage` today) rather than an absolute path.

**Tech Stack:** Node's built-in `node:fs`, `node:fs/promises`, `node:path`, `node:crypto`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-20-disk-file-storage-design.md`

## Global Constraints

- `FileStorage` port shape is unchanged — still `store()` only, no read/retrieve method or route added.
- `store()` returns an opaque UUID key, never an absolute filesystem path — `Document.filePath` is serialized directly in HTTP responses via `toDocumentJson()`, so an absolute path would leak local directory structure to API clients.
- Write failures propagate as rejected promises, uncaught — same convention as every other infrastructure port.
- `uploads/` (the default storage directory) is gitignored — uploaded content is user data, not source.
- All new files use explicit `.js` extensions on relative imports, per the established convention.
- Tests colocated with source, and clean up every file they create in `afterEach` — they write into the real `uploads/` directory (no separate test directory), so leftover test files would otherwise accumulate there across runs.

---

### Task 1: DiskFileStorage

**Files:**
- Create: `src/infrastructure/DiskFileStorage.ts` (replaces `InMemoryFileStorage.ts`)
- Create: `src/infrastructure/DiskFileStorage.test.ts` (replaces `InMemoryFileStorage.test.ts`)
- Delete: `src/infrastructure/InMemoryFileStorage.ts`
- Delete: `src/infrastructure/InMemoryFileStorage.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `FileStorage` port (existing, `src/use-cases/ports/FileStorage.ts`).
- Produces: `DiskFileStorage` implementing `FileStorage` — constructor `(directory: string = './uploads')`, method `store(bytes: Uint8Array): Promise<string>`. Task 2's `composition.ts` constructs one instance.

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/DiskFileStorage.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DiskFileStorage } from './DiskFileStorage.js'

const createdFiles: string[] = []

afterEach(async () => {
  await Promise.all(createdFiles.map((path) => unlink(path).catch(() => {})))
  createdFiles.length = 0
})

describe('DiskFileStorage', () => {
  it('returns a non-empty string key when storing bytes', async () => {
    const storage = new DiskFileStorage()

    const key = await storage.store(new Uint8Array([1, 2, 3]))
    createdFiles.push(join('./uploads', key))

    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('returns different keys for different store calls', async () => {
    const storage = new DiskFileStorage()

    const key1 = await storage.store(new Uint8Array([1, 2, 3]))
    createdFiles.push(join('./uploads', key1))
    const key2 = await storage.store(new Uint8Array([4, 5, 6]))
    createdFiles.push(join('./uploads', key2))

    expect(key1).not.toBe(key2)
  })

  it('writes the exact bytes to disk under the returned key', async () => {
    const storage = new DiskFileStorage()
    const bytes = new Uint8Array([10, 20, 30, 40])

    const key = await storage.store(bytes)
    const filePath = join('./uploads', key)
    createdFiles.push(filePath)

    const written = await readFile(filePath)
    expect(new Uint8Array(written)).toEqual(bytes)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- DiskFileStorage.test.ts`
Expected: FAIL — `Cannot find module './DiskFileStorage.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/infrastructure/DiskFileStorage.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileStorage } from '../use-cases/ports/FileStorage.js'

export class DiskFileStorage implements FileStorage {
  constructor(private readonly directory: string = './uploads') {
    mkdirSync(this.directory, { recursive: true })
  }

  async store(bytes: Uint8Array): Promise<string> {
    const key = randomUUID()
    await writeFile(join(this.directory, key), bytes)
    return key
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- DiskFileStorage.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Delete the old InMemoryFileStorage files**

```bash
rm src/infrastructure/InMemoryFileStorage.ts src/infrastructure/InMemoryFileStorage.test.ts
```

- [ ] **Step 6: Add uploads/ to .gitignore**

Add this line to `.gitignore`:
```
uploads/
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: FAILS at this point — `composition.ts` still imports the now-deleted `InMemoryFileStorage`. This is expected; Task 2 fixes it.

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/DiskFileStorage.ts src/infrastructure/DiskFileStorage.test.ts .gitignore
git add -u src/infrastructure/InMemoryFileStorage.ts src/infrastructure/InMemoryFileStorage.test.ts
git commit -m "feat: add DiskFileStorage, a real disk-backed FileStorage implementation"
```

(`git add -u` stages the deletions — `git add` alone doesn't pick up removed files.)

---

### Task 2: Wire DiskFileStorage into composition and verify persistence

**Files:**
- Modify: `src/infrastructure/composition.ts`

**Interfaces:**
- Consumes: `DiskFileStorage` from Task 1.
- Produces: nothing new — `createDependencies()` now persists uploaded file content to real disk. Final task of this plan.

- [ ] **Step 1: Update composition.ts**

In `src/infrastructure/composition.ts`, change:
```ts
import { InMemoryFileStorage } from './InMemoryFileStorage.js'
```
to:
```ts
import { DiskFileStorage } from './DiskFileStorage.js'
```

And change:
```ts
  const fileStorage = new InMemoryFileStorage()
```
to:
```ts
  const fileStorage = new DiskFileStorage()
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all 127 tests pass (126 from the end of the Ed25519 sub-project, +1 net: `DiskFileStorage.test.ts`'s 3 tests replace `InMemoryFileStorage.test.ts`'s 2).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors — the first clean typecheck since Task 1 Step 7.

- [ ] **Step 4: Manually verify persistence across a server restart**

Run: `npm run dev`

In a separate terminal, upload a document:
```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Persistence Test","uploaderId":"user-alice","fileBytes":"aGVsbG8gd29ybGQ="}'
```
Note the `filePath` from the response.

Confirm the file exists on disk with the exact content (decode `aGVsbG8gd29ybGQ=` is `hello world`):
```bash
cat uploads/<filePath>
```
Expected: prints `hello world`.

Now stop the dev server (Ctrl+C) — this simulates a restart. Confirm the file is STILL there after the process has exited:
```bash
cat uploads/<filePath>
```
Expected: still prints `hello world` — proving the content survived the server stopping, unlike `InMemoryFileStorage`, which would have lost it.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/composition.ts
git commit -m "feat: wire DiskFileStorage into composition root"
```

---

## Post-plan state

After Task 2, uploaded document content is durably persisted to `./uploads/` on disk and survives a server restart — closing the last remaining backend gap. Combined with the real Postgres migration and real Ed25519 verification, SecureDoc Chain's backend is now fully "real" apart from the intentionally-deferred file-retrieval capability. The Flutter mobile app is the one remaining item, per the user's stated build order.
