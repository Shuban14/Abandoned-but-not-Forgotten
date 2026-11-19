// Migration engine — plain JavaScript on purpose.
//
// Shared by the Next.js server (`lib/db.ts`) and the CLI (`scripts/db.mjs`), so
// there is exactly one definition of the schema and the CLI needs no TypeScript
// loader.
//
// The production database is PostgreSQL (Neon). Each migration is a function
// that receives the Neon query function (a tagged-template `sql` helper), so
// every statement is parameterised and no driver-specific SQL escaping is
// needed here. Statements are idempotent (`IF NOT EXISTS`) because a cold start
// can run this concurrently on two serverless instances.

/**
 * The tagged-template `sql` helper from the Neon driver (or an equivalent test
 * adapter). Typed loosely on purpose: the driver's generic call signature is
 * wider than any concrete query shape.
 * @typedef {any} Sql
 * @typedef {{
 *   version: number,
 *   name: string,
 *   summary: string,
 *   destructive: boolean,
 *   affects: string[],
 *   up: (sql: Sql) => Promise<void>,
 *   down: (sql: Sql) => Promise<void>,
 * }} Migration
 */

/** @type {Migration[]} */
export const MIGRATIONS = [
  {
    version: 1,
    name: '001_create_missions',
    summary: 'create the missions table and its session index',
    destructive: true,
    affects: ['missions (all mission records)'],
    async up(sql) {
      await sql`
        CREATE TABLE IF NOT EXISTS missions (
          id                 TEXT PRIMARY KEY,
          session_id         TEXT NOT NULL,
          site_id            TEXT NOT NULL,
          site_name          TEXT NOT NULL,
          target             TEXT NOT NULL CHECK (target IN ('leo','moon','mars')),
          success            BOOLEAN NOT NULL,
          partial            BOOLEAN NOT NULL,
          speed_budget_mps   INTEGER NOT NULL,
          required_speed_mps INTEGER NOT NULL,
          twr                DOUBLE PRECISION NOT NULL,
          weight_t           DOUBLE PRECISION NOT NULL,
          stages             INTEGER NOT NULL,
          parts_json         TEXT NOT NULL,
          failure_code       TEXT,
          created_at         TIMESTAMPTZ NOT NULL
        )
      `
      await sql`
        CREATE INDEX IF NOT EXISTS idx_missions_session_created
          ON missions (session_id, created_at DESC)
      `
    },
    async down(sql) {
      await sql`DROP INDEX IF EXISTS idx_missions_session_created`
      await sql`DROP TABLE IF EXISTS missions`
    },
  },
  {
    version: 2,
    name: '002_add_mission_updated_at',
    summary: 'add the nullable updated_at column so migrations keep both timestamps',
    // Forward-only in spirit: the column is nullable and additive, and nothing
    // in the app depends on it existing for reads of historical rows.
    destructive: true,
    affects: ['missions.updated_at (column only, no mission rows)'],
    async up(sql) {
      await sql`ALTER TABLE missions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`
    },
    async down(sql) {
      await sql`ALTER TABLE missions DROP COLUMN IF EXISTS updated_at`
    },
  },
]

/** @param {Sql} sql */
export async function ensureMigrationTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
}

/** @param {Sql} sql @returns {Promise<number[]>} */
export async function appliedVersions(sql) {
  await ensureMigrationTable(sql)
  const rows = await sql`SELECT version FROM schema_migrations ORDER BY version`
  return rows.map((row) => Number(row.version))
}

/**
 * The newest applied migration, i.e. the one a rollback would undo.
 * @param {Sql} sql
 */
export async function latestApplied(sql) {
  const done = await appliedVersions(sql)
  const version = done[done.length - 1]
  if (version === undefined) return null
  return MIGRATIONS.find((entry) => entry.version === version) ?? null
}

/** Apply every pending migration. @param {Sql} sql @returns {Promise<string[]>} */
export async function migrateUp(sql) {
  /** @type {number[]} */
  const doneRows = await appliedVersions(sql)
  const done = new Set(doneRows)
  /** @type {string[]} */
  const applied = []
  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue
    await migration.up(sql)
    await sql`
      INSERT INTO schema_migrations (version, name)
      VALUES (${migration.version}, ${migration.name})
      ON CONFLICT (version) DO NOTHING
    `
    applied.push(migration.name)
  }
  return applied
}

/**
 * Undo the newest applied migration. Returns its name, or null when there is
 * nothing to roll back.
 * @param {Sql} sql
 * @returns {Promise<string | null>}
 */
export async function migrateDown(sql) {
  const done = await appliedVersions(sql)
  const version = done[done.length - 1]
  if (version === undefined) return null
  const migration = MIGRATIONS.find((entry) => entry.version === version)
  if (!migration) return null

  await migration.down(sql)
  await sql`DELETE FROM schema_migrations WHERE version = ${migration.version}`
  return migration.name
}

/** Pending migration names. @param {Sql} sql @returns {Promise<string[]>} */
export async function pendingMigrations(sql) {
  const done = new Set(await appliedVersions(sql))
  return MIGRATIONS.filter((entry) => !done.has(entry.version)).map((entry) => entry.name)
}
