import { PostgresUserRepository } from './PostgresUserRepository.js'

/**
 * Grants or revokes admin out-of-band.
 *
 * This exists as a script rather than an endpoint because registration is
 * public: any admin-granting path reachable over HTTP would be reachable by
 * everyone. Revocation lives here too so that undoing a mistaken promotion
 * does not require hand-written SQL.
 *
 * The mode is supplied by the npm script, not by the operator:
 *   npm run db:promote-admin -- alice@example.com
 *   npm run db:demote-admin  -- alice@example.com
 */
type Mode = 'promote' | 'demote'

interface ModeCopy {
  /** The npm script an operator actually types, used in the usage line. */
  command: string
  /** State the user is already in, so the run is a no-op. */
  alreadyMessage: (username: string, email: string) => string
  successMessage: (username: string, email: string) => string
  failureVerb: string
}

const MODES: Record<Mode, ModeCopy> = {
  promote: {
    command: 'db:promote-admin',
    alreadyMessage: (username, email) => `${username} <${email}> is already an admin. Nothing to do.`,
    successMessage: (username, email) => `Promoted ${username} <${email}> to admin.`,
    failureVerb: 'promote'
  },
  demote: {
    command: 'db:demote-admin',
    alreadyMessage: (username, email) => `${username} <${email}> is already a regular user. Nothing to do.`,
    successMessage: (username, email) => `Demoted ${username} <${email}> to a regular user.`,
    failureVerb: 'demote'
  }
}

function parseMode(raw: string | undefined): Mode {
  if (raw === 'promote' || raw === 'demote') {
    return raw
  }
  // Reaching here means package.json is wired wrong, not that the operator
  // mistyped -- they never pass this argument.
  console.error(`Internal error: expected mode 'promote' or 'demote', got ${String(raw)}`)
  process.exit(1)
}

async function setAdminRole(): Promise<void> {
  const mode = parseMode(process.argv[2])
  const copy = MODES[mode]
  const shouldBeAdmin = mode === 'promote'

  const email = process.argv[3]
  if (email === undefined || email.length === 0) {
    console.error(`Usage: npm run ${copy.command} -- <email>`)
    process.exit(1)
  }

  const repository = new PostgresUserRepository()
  const user = await repository.findByEmail(email)
  if (user === null) {
    // Exiting non-zero matters here: a silent no-op on a typo'd address would
    // leave the operator believing they had changed access they had not.
    console.error(`No user found with email ${email}. Nobody was ${copy.failureVerb}d.`)
    process.exit(1)
  }

  if (user.isAdmin === shouldBeAdmin) {
    console.log(copy.alreadyMessage(user.username, email))
    process.exit(0)
  }

  await repository.setAdminStatus(user.id, shouldBeAdmin)
  console.log(copy.successMessage(user.username, email))
  process.exit(0)
}

setAdminRole().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to change admin role: ${message}`)
  process.exit(1)
})
