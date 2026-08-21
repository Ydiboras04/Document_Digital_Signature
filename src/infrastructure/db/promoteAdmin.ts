import { PostgresUserRepository } from './PostgresUserRepository.js'

/**
 * Grants admin out-of-band. This exists as a script rather than an endpoint
 * because registration is public: any admin-granting path reachable over HTTP
 * would be reachable by everyone.
 *
 * Usage: npm run db:promote-admin -- alice@example.com
 */
async function promoteAdmin(): Promise<void> {
  const email = process.argv[2]
  if (email === undefined || email.length === 0) {
    console.error('Usage: npm run db:promote-admin -- <email>')
    process.exit(1)
  }

  const repository = new PostgresUserRepository()
  const user = await repository.findByEmail(email)
  if (user === null) {
    // Exiting non-zero matters here: a silent no-op on a typo'd address would
    // leave the operator believing they had granted access they had not.
    console.error(`No user found with email ${email}. Nobody was promoted.`)
    process.exit(1)
  }

  if (user.isAdmin) {
    console.log(`${user.username} <${email}> is already an admin. Nothing to do.`)
    process.exit(0)
  }

  await repository.setAdminStatus(user.id, true)
  console.log(`Promoted ${user.username} <${email}> to admin.`)
  process.exit(0)
}

promoteAdmin()
