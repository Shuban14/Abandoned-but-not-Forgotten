// Migration engine — plain JavaScript on purpose.
//
// Both the Next.js server (`lib/db.ts`) and the CLI (`scripts/db.mjs`) use this
// file, so there is exactly one implementation and the CLI runs on the same
// Node version as the app without a TypeScript loader or extra flags.

/**
 * @typedef {{ version: number, name: string, up: string, down: string }} Migration
 */

/**
 * Ordered, additive migrations. Never edit an applied migration — add a new
 * one. Each entry carries the SQL needed to undo it (`npm run db:rollback`).
 *
 * @type {Migration[]}
 */
export const MIGRATIONS = [
  {
    version: 1,
    name: '001_create_missions',
    up: `
      CREATE TABLE IF NOT EXISTS missions (
        id                TEXT PRIMARY KEY,
        session_id        TEXT NOT NULL,
        site_id           TEXT NOT NULL,
        site_name         TEXT NOT NULL,
        target            TEXT NOT NULL CHECK (target IN ('leo','moon','mars')),
        success           INTEGER NOT NULL CHECK (success IN (0,1)),
        partial           INTEGER NOT NULL CHECK (partial IN (0,1)),
        speed_budget_mps  INTEGER NOT NULL,
        required_speed_mps INTEGER NOT NULL,
        twr               REAL NOT NULL,
        weight_t          REAL NOT NULL,
        stages            INTEGER NOT NULL,
        parts_json        TEXT NOT NULL,
        failure_code      TEXT,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_missions_session_created
        ON missions (session_id, created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_missions_session_created;
      DROP TABLE IF EXISTS missions;
    `,
  },
]

/** @param {import('node:sqlite').DatabaseSync} db */
export function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}

/** @param {import('node:sqlite').DatabaseSync} db @returns {number[]} */
export function appliedVersions(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
  return rows.map((row) => Number(row.version))
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Migration} migration
 */
function applyOne(db, migration) {
  db.exec('BEGIN')
  try {
    db.exec(migration.up)
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      migration.version,
      migration.name,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Apply every pending migration. @param {import('node:sqlite').DatabaseSync} db @returns {string[]} */
export function migrateUp(db) {
  const done = new Set(appliedVersions(db))
  const applied = []
  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue
    applyOne(db, migration)
    applied.push(migration.name)
  }
  return applied
}

/**
 * Undo the newest applied migration. Returns its name, or null when there is
 * nothing to roll back.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string | null}
 */
export function migrateDown(db) {
  const done = appliedVersions(db)
  const version = done[done.length - 1]
  if (version === undefined) return null
  const migration = MIGRATIONS.find((entry) => entry.version === version)
  if (!migration) return null

  db.exec('BEGIN')
  try {
    db.exec(migration.down)
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.version)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return migration.name
}

/** Pending migration names. @param {import('node:sqlite').DatabaseSync} db */
export function pendingMigrations(db) {
  const done = new Set(appliedVersions(db))
  return MIGRATIONS.filter((entry) => !done.has(entry.version)).map((entry) => entry.name)
}
