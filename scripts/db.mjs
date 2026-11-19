// Migration CLI (plain Node, no loader, no build step).
//
//   npm run db:migrate                 apply pending migrations (voluntary only)
//   npm run db:rollback -- --dry-run   show what a rollback would destroy
//   npm run db:rollback -- --yes       undo the newest applied migration (local DB)
//   npm run db:status                  show applied + pending migrations
//
// Rollback is destructive: the migration `down` functions drop tables or
// columns. Against any database that is not on this machine it therefore needs
// three separate opt-ins (`--yes`, `--allow-production`, and an explicit
// `--confirm=DELETE-DATA`), and it prints the affected tables first. Nothing in
// this CLI is invoked by the build or by the app, so a deployment can never
// trigger a rollback.
import { neon } from '@neondatabase/serverless'
import {
  appliedVersions,
  latestApplied,
  migrateDown,
  migrateUp,
  pendingMigrations,
} from '../lib/migrations.mjs'
import { loadEnv, requireDatabaseUrl } from './env.mjs'

loadEnv()

const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const CONFIRM_TOKEN = 'DELETE-DATA'

/** Strips anything that looks like a connection string from a driver message. */
function sanitize(message) {
  return message
    .replace(/postgres(ql)?:\/\/\S+/gi, 'postgres://***')
    .replace(/(password|token)=\S+/gi, '$1=***')
}

/**
 * Classifies the configured database without ever printing it.
 *
 * Anything not on this machine is treated as production: staging databases and
 * shared preview databases are just as expensive to lose as the live one, and
 * this CLI has no way to tell them apart.
 */
function classifyTarget(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return { valid: false, production: true, reason: 'DATABASE_URL is not a valid URL' }
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    return { valid: false, production: true, reason: 'DATABASE_URL is not a PostgreSQL URL' }
  }

  const host = url.hostname.toLowerCase()
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(default)'
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])
  const isLocal = localHosts.has(host)

  const signals = []
  if (!isLocal && host.endsWith('.neon.tech')) signals.push('hosted Neon database')
  if (!isLocal && /supabase|amazonaws|azure|render|railway|planetscale|fly\.dev|neon\.tech/.test(host)) {
    signals.push('hosted provider host')
  }
  if (/prod/i.test(database)) signals.push('database name mentions "prod"')
  if (process.env.VERCEL_ENV === 'production') signals.push('VERCEL_ENV=production')

  return {
    valid: true,
    host,
    database,
    isLocal,
    // Remote ⇒ production-equivalent. Local hosts are the only safe default.
    production: !isLocal,
    signals,
  }
}

function describePlan() {
  return [
    'A rollback runs the newest applied migration\'s DOWN step. That step is',
    'destructive: it removes tables and/or columns and the mission records in',
    'them. There is no undo. Take a backup first (Neon → Branches → Restore, or',
    '`pg_dump`), and prefer a forward-only fix (a new additive migration).',
  ].join('\n')
}

async function countMissions(sql) {
  try {
    const rows = await sql`SELECT count(*)::int AS count FROM missions`
    return Number(rows?.[0]?.count ?? 0)
  } catch {
    return null
  }
}

async function rollback(sql, target, raw) {
  // Guard first: a remote database is never touched without all three opt-ins,
  // and we refuse before opening a connection when the opt-ins are missing.
  if (target.production) {
    console.log(`Target: REMOTE / PRODUCTION-EQUIVALENT database "${target.database}"`)
    if (target.signals.length) console.log(`Production signals: ${target.signals.join(', ')}`)
    console.log(describePlan())
    if (!has('--allow-production')) {
      console.error(
        '\nBLOCKED: this database is not local, so rollback is refused by default.\n' +
          'If you really mean to destroy this data, re-run with:\n' +
          '  npm run db:rollback -- --yes --allow-production --confirm=' + CONFIRM_TOKEN,
      )
      process.exitCode = 1
      return
    }
    const confirm = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length)
    if (confirm !== CONFIRM_TOKEN) {
      console.error(
        `\nBLOCKED: missing confirmation token. Re-run with --confirm=${CONFIRM_TOKEN} to confirm you want the data gone.`,
      )
      process.exitCode = 1
      return
    }
  }

  const newest = await latestApplied(sql)
  if (!newest) {
    console.log('Nothing to roll back.')
    return
  }

  const records = await countMissions(sql)

  console.log(`\nRollback plan: ${newest.name} — ${newest.summary}`)
  console.log(`Affected: ${newest.affects.join('; ')}`)
  if (records !== null) console.log(`Mission records currently stored: ${records}`)
  console.log(`Target: ${target.production ? 'REMOTE / PRODUCTION-EQUIVALENT' : 'local'} database "${target.database}"`)
  if (target.signals.length) console.log(`Production signals: ${target.signals.join(', ')}`)
  console.log('')

  if (has('--dry-run')) {
    console.log('Dry run: no changes were made.')
    return
  }

  if (!has('--yes') && !has('--force')) {
    console.log(describePlan())
    console.error('\nBLOCKED: rollback needs an explicit confirmation. Re-run with --yes.')
    process.exitCode = 1
    return
  }

  console.log(describePlan())
  const undone = await migrateDown(sql)
  console.log(undone ? `Rolled back: ${undone}` : 'Nothing to roll back.')
}

try {
  let raw
  try {
    raw = requireDatabaseUrl()
  } catch {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
    process.exit(1)
  }

  const target = classifyTarget(raw)
  if (!target.valid) {
    console.error(`Invalid database configuration: ${target.reason}`)
    process.exit(1)
  }

  const sql = neon(raw)

  if (has('--down')) {
    await rollback(sql, target, raw)
  } else if (has('--status')) {
    const applied = await appliedVersions(sql)
    const pending = await pendingMigrations(sql)
    console.log(`applied: ${applied.join(', ') || '(none)'}`)
    console.log(`pending: ${pending.join(', ') || '(none)'}`)
  } else {
    const applied = await migrateUp(sql)
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
  }

  if (!has('--down')) {
    console.log(`applied: ${(await appliedVersions(sql)).join(', ') || '(none)'}`)
    console.log(`pending: ${(await pendingMigrations(sql)).join(', ') || '(none)'}`)
  }
} catch (error) {
  // Never print the connection string or driver internals.
  console.error('Migration failed:', sanitize(error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
