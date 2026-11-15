// Durable server-side storage: SQLite through Node's built-in `node:sqlite`
// driver. No native build step and no extra dependency; the database lives on
// disk in `.data/` (git-ignored) and survives restarts and rebuilds.
//
// Node 22.5+ is required: `node:sqlite` does not exist on older runtimes.
// See the `engines` field in package.json and README.md.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import {
  appliedVersions,
  ensureMigrationTable,
  migrateDown as runDown,
  migrateUp as runUp,
  pendingMigrations,
} from './migrations.mjs'

export const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), '.data', 'space-relics.db')

let instance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (instance) return instance

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  ensureMigrationTable(db)
  runUp(db)

  instance = db
  return instance
}

/** Undo the newest applied migration. Returns its name, or null when empty. */
export function migrateDown(): string | null {
  return runDown(getDb())
}

export function closeDb() {
  if (!instance) return
  instance.close()
  instance = null
}

export function migrationStatus() {
  const db = getDb()
  return {
    path: DB_PATH,
    applied: appliedVersions(db),
    pending: pendingMigrations(db),
  }
}
