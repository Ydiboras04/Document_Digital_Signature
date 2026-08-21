# Real Registration Flow (Flutter) — Design Spec

Date: 2026-08-20
Status: Approved

## Purpose

Replace the Flutter app's fake Login screen (username/password fields
that don't correspond to anything the backend supports — there is no
authentication mechanism, only registration) with a real registration
flow: on-device Ed25519 keypair generation, a call to the backend's
`POST /users`, and secure local storage of the resulting identity.

This is the first real (non-mockup) feature in the Flutter app. Everything
else currently in `flutter_digital_sign/` — the document list, upload,
signing, and verification screens — remains a static UI mockup; each
becomes its own follow-up sub-project once this one exists to build on.

## Target Environment

Windows desktop (`flutter run -d windows`), talking to the backend at
`http://localhost:3000` — both processes run on the same machine, so no
special network aliasing (e.g. Android's `10.0.2.2`) is needed.

## New Dependencies

Added via `flutter pub add` (letting pub resolve versions compatible with
this project's `sdk: ^3.12.2` constraint, rather than hand-pinning):

- `http` — REST calls to the backend.
- `cryptography` — pure-Dart Ed25519 keypair generation (Dart has no
  built-in Ed25519 support).
- `flutter_secure_storage` — persists the identity, backed by Windows
  Credential Manager/DPAPI on desktop, Keychain/Keystore on mobile.

## Architecture

Introduces a thin port/adapter split for the network layer, mirroring the
pattern already used throughout the backend in this project (`UserApi`
abstract interface + `HttpUserApi` real implementation + `FakeUserApi`
test double) — so widget tests never need a live server.

```
lib/core/network/user_api.dart          # abstract UserApi + HttpUserApi
lib/core/crypto/ed25519_key_pair.dart   # wraps the `cryptography` package
lib/core/storage/identity_storage.dart  # wraps flutter_secure_storage
lib/features/register/presentation/pages/register_page.dart
lib/features/register/presentation/widgets/register_form.dart
test/core/network/fake_user_api.dart
```

`lib/features/login/` (the existing fake Login screen) is removed
entirely — its files are replaced by the new `register` feature, not kept
alongside it.

## Components

**`Ed25519KeyPair`**: wraps the `cryptography` package's Ed25519 key
generation. Exposes the raw 32-byte public key and whatever the
`cryptography` package's private key material needs to be, in a form
`IdentityStorage` can persist and later use to sign things (signing itself
is out of scope for this sub-project — only generation and storage).

**`UserApi`** (abstract) / **`HttpUserApi`**: one method,
`register(username, email, publicKeyBytes) -> RegisterResult`, POSTing to
`/users` with the public key base64-encoded (matching the backend's
existing `documents`/`signatures` request convention). Maps the real
HTTP response into a small result type distinguishing success (returns
the server-assigned `userId`) from failure (duplicate email, or any other
error) — the UI needs to tell these apart to either navigate forward or
show an inline error.

**`IdentityStorage`**: wraps `flutter_secure_storage` with two operations:
`save(userId, keyPair)` and `load() -> StoredIdentity?` (null if nothing
saved yet). This is what `WelcomePage` checks at startup to decide whether
to skip registration.

## Flow

1. **`WelcomePage`** (modified): on `initState`, calls
   `IdentityStorage.load()`. If it returns a saved identity, navigate
   directly to the `next` route (document list) — no button, no
   registration screen shown at all. If null, render exactly as today
   (the "Start" button), now pointing at a `register` route instead of
   `login`.
2. **`RegisterPage`/`RegisterForm`** (new, replacing `LoginPage`/
   `LoginForm`): two text fields — username, email. No password field.
   On submit:
   - `Ed25519KeyPair.generate()`.
   - `UserApi.register(username, email, keyPair.publicKeyBytes)`.
   - On success: `IdentityStorage.save(userId, keyPair)`, then navigate to
     `next`.
   - On failure (e.g. the real backend's `409 DuplicateEmailError`, or any
     other error): show the error message inline on the form; do not
     navigate, do not save anything to secure storage.

## Testing

Widget tests using `FakeUserApi` (in-memory, same shape as the backend's
`FakeUserRepository` — configurable to succeed or fail, records what it
was called with) instead of a real HTTP call:
- Successful registration: fills the form, submits, confirms navigation
  to the document list, and confirms `IdentityStorage` now holds the new
  identity.
- Duplicate-email failure: `FakeUserApi` configured to return the
  duplicate-email failure case; confirms an error message appears and the
  app stays on the Register screen.
- `WelcomePage` skip-to-document-list behavior: pre-populate
  `IdentityStorage` with a fake identity before pumping the widget,
  confirm it navigates straight to `next` without showing the Register
  screen.

## Out of Scope

- Real document list, upload, signing, or verification screens — still
  static mockups, each its own future sub-project.
- Any way to sign out, switch identities, or recover an account on a new
  device — there is exactly one identity per device install for now.
- Actually using the generated private key to sign anything — that's the
  signing-flow sub-project, once it exists.
