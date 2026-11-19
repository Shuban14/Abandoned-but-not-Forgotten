// Server-only PostgreSQL access.
//
// Production storage is a managed PostgreSQL database (Neon) reached through
// the Neon serverless driver: each query is a short-lived HTTPS request, so
// nothing depends on a connection surviving a function invocation and there is
// no per-request connection to open or close.
//
// On a developer machine (and only there) `DATABASE_URL` may be absent: the app
// then falls back to an embedded PostgreSQL (PGlite) stored under `.data/pglite`,
// so a local run is fully working — mission log, health check and writes — with
// no credentials and no server to install. That directory is gitignored.
//
// The fallback is refused outright in a hosted deployment. A local store on a
// serverless filesystem would accept writes and then lose them with the
// instance, so without `DATABASE_URL` a hosted build reports the database as
// unavailable and stays read-only instead of silently keeping data on disk.
//
// `DATABASE_URL` is a server-only secret. It is never read by client code, never
// returned by an API and never logged.
import { neon } from '@neondatabase/serverless'
import { migrateUp } from './migrations.mjs'

/** Thrown when the database is not configured or cannot be reached. */
export class DatabaseUnavailableError extends Error {
  constructor(message = 'database unavailable') {
    super(message)
    this.name = 'DatabaseUnavailableError'
  }
}

/** Neon's tagged-template helper, or the local adapter with the same shape. */
type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>

let clientPromise: Promise<Sql> | null = null
let schemaReady: Promise<void> | null = null

function connectionString(): string {
  return (process.env.DATABASE_URL ?? '').trim()
}

/** True when a hosted database is configured (the local fallback needs none). */
export function isDatabaseConfigured(): boolean {
  return connectionString().length > 0
}

/**
 * Environment flags set by hosting platforms. Their presence means this process
 * is a deployed build rather than somebody's machine.
 */
const HOSTED_ENV_FLAGS = [
  'VERCEL',
  'VERCEL_ENV',
  'NOW_REGION',
  'NETLIFY',
  'CF_PAGES',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_EXECUTION_ENV',
  'RENDER',
  'RAILWAY_ENVIRONMENT',
  'FLY_APP_NAME',
  'K_SERVICE',
  'KUBERNETES_SERVICE_HOST',
] as const

/** True when running on a hosting platform instead of a local machine. */
export function isHostedDeployment(): boolean {
  return HOSTED_ENV_FLAGS.some((flag) => Boolean(process.env[flag]))
}

/** The embedded database is a local-development convenience, never a fallback. */
export function allowsLocalDatabase(): boolean {
  return connectionString().length === 0 && !isHostedDeployment()
}

async function createClient(): Promise<Sql> {
  const url = connectionString()
  if (url) return neon(url) as unknown as Sql

  // A hosted build must use a real database. Refusing here (rather than
  // falling through to a local directory) is what keeps a deployed instance
  // from accepting writes into storage that disappears with it.
  if (isHostedDeployment()) {
    throw new DatabaseUnavailableError('DATABASE_URL is not set in a hosted deployment')
  }

  // Embedded PostgreSQL for local runs. Imported lazily so a deployment that
  // ships without the dev dependency still boots and simply reports the
  // database as unavailable instead of crashing at import time.
  let PGlite: typeof import('@electric-sql/pglite').PGlite
  try {
    ;({ PGlite } = await import('@electric-sql/pglite'))
  } catch {
    throw new DatabaseUnavailableError('no DATABASE_URL and no local database engine')
  }

  const dataDir = (process.env.PGLITE_DIR ?? '.data/pglite').trim() || '.data/pglite'
  const db = new PGlite(dataDir)

  // Same tagged-template contract the migrations and queries already use, with
  // every value bound as a parameter.
  const sql: Sql = async (strings, ...values) => {
    let text = strings[0]
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`
    const result = await db.query<Record<string, unknown>>(text, values, { rowMode: 'object' })
    return result.rows as unknown[]
  }

  return sql
}

function getClient(): Promise<Sql> {
  if (!clientPromise) {
    clientPromise = createClient().catch((error: unknown) => {
      // Do not cache a failure: the next request may succeed.
      clientPromise = null
      throw error
    })
  }
  return clientPromise
}

/**
 * Ready-to-use `sql` tagged-template function. The first call in a process also
 * applies any pending migration once; later calls reuse the same promise, so a
 * warm instance never re-runs DDL.
 */
export async function getSql(): Promise<Sql> {
  const sql = await getClient()
  if (!schemaReady) {
    schemaReady = migrateUp(sql)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Do not cache a failure: the next request should be able to retry once
        // the database is reachable again.
        schemaReady = null
        throw error
      })
  }
  await schemaReady
  return sql
}

/** Cheap liveness probe used by the health route. */
export async function pingDatabase(): Promise<void> {
  const sql = await getClient()
  await sql`SELECT 1 AS ok`
}
