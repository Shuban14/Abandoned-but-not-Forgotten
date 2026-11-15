// Migration CLI (plain Node, no loader, no build step).
//   npm run db:migrate    apply pending migrations
//   npm run db:rollback   undo the newest applied migration
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  appliedVersions,
  ensureMigrationTable,
  migrateDown,
  migrateUp,
  pendingMigrations,
} from '../lib/migrations.mjs'

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), '.data', 'space-relics.db')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')
ensureMigrationTable(db)

try {
  if (process.argv.includes('--down')) {
    const undone = migrateDown(db)
    console.log(undone ? `Rolled back: ${undone}` : 'Nothing to roll back.')
  } else {
    const applied = migrateUp(db)
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
  }
  console.log(`database: ${dbPath}`)
  console.log(`applied:  ${appliedVersions(db).join(', ') || '(none)'}`)
  console.log(`pending:  ${pendingMigrations(db).join(', ') || '(none)'}`)
} finally {
  db.close()
}
