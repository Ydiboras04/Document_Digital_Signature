# SecureDoc Chain: Cryptographic Document Management & Multi-Signature System

A robust, centralized document signing and tracking system built with **Clean Architecture**, leveraging asymmetric cryptography and chained digital signatures to ensure absolute data integrity, non-repudiation, and an immutable chronological audit trail.

---

## 🏗️ Architecture & System Design

```
+-------------------------------------------------------------------+
|                        MOBILE CLIENT (Flutter)                    |
|                                                                   |
|  +-----------------------+         +---------------------------+  |
|  | Biometric Auth        |         | Local Secure Storage      |  |
|  | (Local Authentication)|         | (Private Key - NEVER exits)  |
|  +-----------------------+         +---------------------------+  |
|               |                                  |                |
|               +-----------------+----------------+                |
|                                 |                                 |
|                      Generates Signature                          |
|             (Hash + Private Key -> Digital Signature)             |
+---------------------------------|---------------------------------+
                                  | HTTP (REST API)
                                  v
+-------------------------------------------------------------------+
|                     BACKEND SERVER (Hono + TypeScript)            |
|                                                                   |
|   +-----------------------------------------------------------+   |
|   | Clean Architecture Layers:                                |   |
|   | - Domain Core (Entities & Chaining Rules)                 |   |
|   | - Use Cases (Upload, Sign, Verify)                        |   |
|   | - Interface Adapters (Hono Controllers)                   |   |
|   | - Infrastructure (Database ORM / Storage)                 |   |
|   +-----------------------------------------------------------+   |
|                                 |                                 |
|                    Verifies using Public Key                      |
+---------------------------------|---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                  DATABASE (PostgreSQL / Relational)               |
|                                                                   |
|  - Users (id, username, email, publicKey)                         |
|  - Documents (id, title, filePath, originalHash, uploaderId)      |
|  - Signatures (id, documentId, userId, previousSignatureId, data) |
+-------------------------------------------------------------------+
```

---

## 🔐 Core Cryptographic Workflow

### 1. Key Generation (Account Creation)
* **On Device:** When a user registers through the Flutter mobile app, a cryptographic key pair (Private Key and Public Key) is generated locally.
* **Storage Split:**
  * **Private Key:** Stored securely in the device's hardware-backed secure storage (`flutter_secure_storage`) and locked behind biometric verification (`local_auth`). It never leaves the physical phone.
  * **Public Key:** Transmitted to the server and stored in the PostgreSQL database mapped to the user profile.

### 2. Document Upload & Hashing
* An administrator or user uploads a document (e.g., PDF) to the platform via the mobile application.
* The server stores the file and calculates its initial cryptographic hash (`originalHash`).

### 3. The Chained Multi-Signature Stack
When a user signs a document, the application builds a secure verification chain:
* **First Signer:** Combines the document hash with their **Private Key** to generate `Signature 1`.
* **Subsequent Signers:** Combines the document hash, the *previous signature reference* (`previousSignatureId`), and their own **Private Key** to generate the next signature in the stack.
* **Database Representation:** Stored sequentially using relational foreign keys (`previousSignatureId`), allowing the backend to reconstruct and verify the complete history of approvals.

---

## 🗄️ Database Schema Design (PostgreSQL)

### `Users` Table
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `userId` | UUID / Serial | Primary Key | Unique identifier for the user |
| `username` | VARCHAR | NOT NULL | User display name |
| `email` | VARCHAR | UNIQUE, NOT NULL | User account email |
| `publicKey` | TEXT | NOT NULL | Public key uploaded from the mobile device |
| `createdAt` | TIMESTAMP | DEFAULT NOW() | Account creation timestamp |

### `Documents` Table
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `documentId` | UUID / Serial | Primary Key | Unique document identifier |
| `title` | VARCHAR | NOT NULL | Title or description of the document |
| `filePath` | TEXT | NOT NULL | Storage path (e.g., cloud object storage or server disk) |
| `originalHash` | TEXT | NOT NULL | Initial SHA-256 hash of the uploaded document |
| `uploaderId` | UUID | Foreign Key (`Users`) | User who initially uploaded the document |
| `uploadDate` | TIMESTAMP | DEFAULT NOW() | Timestamp of upload |

### `Signatures` Table (The Stacking Chain)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `signatureId` | UUID / Serial | Primary Key | Unique signature event identifier |
| `documentId` | UUID | Foreign Key (`Documents`) | Target document being signed |
| `userId` | UUID | Foreign Key (`Users`) | User who applied this signature |
| `previousSignatureId`| UUID | Foreign Key (`Signatures`, Nullable) | Points to the prior signature in the chain (enforces stacking) |
| `signatureData` | TEXT | NOT NULL | The cryptographic signature output |
| `signedAt` | TIMESTAMP | DEFAULT NOW() | Timestamp when the signature was applied |

---

## 🛠️ Technology Stack & Architecture

* **Mobile Frontend:** **Flutter** (Cross-platform UI, Secure Storage, Local Biometric Authentication)
* **Backend API:** **Hono** running on **TypeScript** (High performance, minimal footprint, edge-ready)
* **Architecture Pattern:** **Clean Architecture** (Strict separation of concerns: Domain Core, Use Cases, Controllers, Infrastructure)
* **Database:** **PostgreSQL** (Relational integrity, ACID compliance, optimized for sequential querying and relational audit trails)

---

## ✨ Key Advantages & Security Guarantees

1. **Absolute Data Integrity:** Any modification to the document or prior signatures invalidates the entire mathematical chain instantly.
2. **Non-Repudiation:** Because private keys are bound to user hardware and biometrics, signers cannot falsely deny their actions.
3. **Zero-Trust Server Design:** Compromising the central database or server does not allow an attacker to forge user signatures, as private keys are never stored server-side.
4. **Verifiable Audit Trail:** Provides an unalterable, chronological sequence of approvals suitable for administrative and official workflows.

---

## 🚀 Setup & Bootstrapping

### Environment

Set `DATABASE_URL` and `JWT_SECRET` before running the server or any of the scripts below (both are documented in `.env.example`; the server refuses to start without `JWT_SECRET`).

### Getting an admin: the first-run bootstrap

Only one endpoint requires the admin role (`POST /documents`), and by design **there is no way to grant it over HTTP** — registration (`POST /users`) always creates a regular user, on purpose. A fresh deployment therefore starts with zero admins, and the product stays inert (nobody can upload a document) until an operator with database access promotes someone. This is expected, not a bug — do this once per environment:

1. Run migrations: `npm run db:migrate`
2. (Dev only) Seed fixture data: `npm run db:seed`
3. Register a user through the app (or via `POST /users`) — this is how that person gets an identity.
4. Promote that user to admin from a machine with `DATABASE_URL` access: `npm run db:promote-admin -- <that user's email>`
5. Restart the client, or wait for the user's current session token to expire.

**Promotion is not instant.** The server reads the admin flag from the JWT, not from the database, on every request — so a promotion only takes effect the next time that user obtains a token: immediately if they restart the app (or otherwise re-authenticate), or automatically within an hour when their current token expires. Seeing the upload control stay hidden right after running the script is expected, not a failure — it is the fail-closed trade-off described in the design spec, and it resolves itself without further action.