# UploadDocument Use Case — Design Spec

Date: 2026-08-13
Status: Approved

## Purpose

Build the first use case of SecureDoc Chain's use-case layer: `UploadDocumentUseCase`,
which turns raw file bytes into a persisted `Document`. This is the first of
three planned use cases (Upload, Sign, Verify) — each is its own sub-project,
built and reviewed independently. Sign and Verify are out of scope here.

This layer orchestrates the domain (`src/domain`) against infrastructure via
new ports. It introduces no concrete infrastructure (no real database, no
real file storage) — only the port interfaces and the use case that depends
on them, following the same pattern as `CryptoProvider` in the domain-core
sub-project.

## Project Layout

```
src/
  use-cases/
    ports/
      FileStorage.ts
      IdGenerator.ts
      DocumentRepository.ts
    upload-document/
      UploadDocumentUseCase.ts
      UploadDocumentUseCase.test.ts
    testing/
      FakeFileStorage.ts
      FakeIdGenerator.ts
      FakeDocumentRepository.ts
```

## Ports

```ts
interface FileStorage {
  store(bytes: Uint8Array): Promise<string>  // returns the stored file's path/key
}

interface IdGenerator {
  generate(): string
}

interface DocumentRepository {
  save(document: Document): Promise<void>
}
```

These are async, unlike the domain layer's `CryptoProvider` (which is pure
computation with no I/O) — they represent real I/O once a concrete adapter
is built in a later infrastructure sub-project. No other `DocumentRepository`
methods (e.g. `findById`) are needed yet; Upload only ever writes.

## `UploadDocumentUseCase`

**Input:**
```ts
interface UploadDocumentInput {
  title: string
  uploaderId: string
  fileBytes: Uint8Array
}
```

**`execute(input: UploadDocumentInput): Promise<Result<Document, InvalidDocumentError>>`**

Steps:
1. Hash the file bytes via the existing `CryptoProvider.hash()`.
2. Store the file bytes via `FileStorage.store()` → get back a `filePath`.
3. Generate a new id via `IdGenerator.generate()`.
4. Call `Document.create({ id, title, filePath, originalHash, uploaderId })`.
5. If step 4 fails, return `Result.fail(error)` — no repository write happens.
   The file bytes stored in step 2 become an orphan with no DB record; this
   is a known, accepted limitation (see "Known Limitations" below).
6. If step 4 succeeds, persist the document via `DocumentRepository.save()`,
   then return `Result.ok(document)`.

Constructor dependencies: `CryptoProvider`, `FileStorage`, `IdGenerator`,
`DocumentRepository` — all injected, all ports.

## Error Handling

- `execute()` returns `Result<Document, InvalidDocumentError>`, reusing the
  existing domain error type directly rather than inventing a new
  use-case-specific error — consistent with how `SignatureChainService`
  reuses domain errors (e.g. `DuplicateSignatureError`) rather than wrapping
  them.
- `Result` is reserved for expected domain/business outcomes (i.e. entity
  validation failure). Infrastructure failures — `FileStorage.store()` or
  `DocumentRepository.save()` rejecting — are **not** caught or wrapped here.
  They propagate as rejected promises. Handling them (mapping to HTTP error
  responses, retries, etc.) is deferred to a future sub-project (e.g. Hono's
  `app.onError()`, itself still out of scope per the Hono-skeleton spec).

## Known Limitations (accepted for this sub-project)

- **Orphaned file storage on validation failure**: if `Document.create()`
  fails after `FileStorage.store()` already succeeded, the stored bytes are
  never cleaned up and no `Document` record references them. No
  compensating transaction / saga is implemented. Acceptable because in
  practice `Document.create()` only fails on empty `title`/`uploaderId`,
  which callers are expected to catch before invoking this use case; true
  cleanup semantics can be added once a real `FileStorage` adapter exists.
- **No duplicate/uniqueness checks**: uploading the same file content or
  title multiple times is allowed and creates multiple `Document` records.
  No such business rule exists in the domain spec today.

## Testing

- `UploadDocumentUseCase.test.ts`, colocated with the use case, following
  the domain layer's colocated-test convention.
- Uses `FakeFileStorage`, `FakeIdGenerator`, `FakeDocumentRepository` (all
  new, in-memory), plus the existing `FakeCryptoProvider` from
  `src/domain/testing`. No real I/O, no framework — pure unit tests.
- Coverage target: successful upload (happy path, verifies the returned
  `Document`'s fields and that `DocumentRepository.save()` was called with
  it), and entity-validation failure (empty title → `Result.fail` with
  `InvalidDocumentError`, and `DocumentRepository.save()` is NOT called).

## Out of Scope (future sub-projects)

- `SignDocumentUseCase`, `VerifyChainUseCase`.
- Concrete adapters for `FileStorage`, `IdGenerator`, `DocumentRepository`
  (e.g. Postgres-backed repository, disk/S3-backed storage,
  `crypto.randomUUID()`-backed id generator).
- Wiring this use case into the Hono HTTP layer (a real `POST /documents`
  route).
- Cleanup/transactional guarantees for the orphaned-storage limitation above.
- `DocumentRepository` read methods (`findById`, etc.) — needed by Sign and
  Verify, not by Upload.
