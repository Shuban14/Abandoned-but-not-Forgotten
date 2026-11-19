// One-off export of the legacy local SQLite mission log.
//
// The old release stored missions in `.data/space-relics.db`. Nothing here is
// needed in production any more; this script exists so existing local records
// can be moved into PostgreSQL instead of being silently discarded.
//
//   npm run db:export-sqlite                      → .data/exports/missions-export.json
//   npm run db:export-sqlite -- --out notes.json  → .data/exports/notes.json
//   npm run db:export-sqlite -- --out ../x.json --allow-outside
//
// The export contains anonymous session identifiers, which are what the API
// uses to decide who owns a mission. It is therefore written only inside the
// git-ignored `.data/exports/` directory by default, is never silently
// overwritten, and never prints a session id to the console.
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from './env.mjs'
import { buildExportPayload, rowToMission } from './lib/mission-transfer.mjs'

loadEnv()

const WARNING =
  'WARNING: This export contains private mission records and session identifiers.\n' +
  '         Keep this file confidential. Never commit or publicly share it.'

const DEFAULT_EXPORT_DIR = path.join(process.cwd(), '.data', 'exports')
const DEFAULT_EXPORT_NAME = 'missions-export.json'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)

function usage(message) {
  if (message) console.error(`export-sqlite: ${message}\n`)
  console.error('Usage: node scripts/export-sqlite.mjs [--out <file>] [--force] [--allow-outside]')
  process.exit(1)
}

/** Supports both `--out <file>` and a bare positional path (previous CLI). */
function requestedOutput() {
  const outIndex = args.indexOf('--out')
  if (outIndex !== -1) {
    const value = args[outIndex + 1]
    if (!value || value.startsWith('--')) usage('--out needs a file path')
    return value
  }
  const positional = args.find((arg) => !arg.startsWith('--'))
  return positional ?? null
}

/**
 * Resolves and validates the destination. Anything outside `.data/exports/`
 * needs the explicit `--allow-outside` escape hatch, and path traversal is
 * rejected before the escape hatch is even considered.
 */
function resolveDestination() {
  const requested = requestedOutput()

  if (requested && requested.includes('\0')) usage('invalid destination')

  const target = requested
    ? path.resolve(process.cwd(), requested)
    : path.join(DEFAULT_EXPORT_DIR, DEFAULT_EXPORT_NAME)

  // Path traversal: the resolved path must stay under the export directory.
  const relative = path.relative(DEFAULT_EXPORT_DIR, target)
  const insideExportDir = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)

  if (!insideExportDir && !flag('--allow-outside')) {
    usage(
      `refusing to write outside the protected export directory (${DEFAULT_EXPORT_DIR}).\n` +
        'Pass --allow-outside only if you understand that the file contains session identifiers.',
    )
  }

  return { target, insideExportDir }
}

const { target: outPath, insideExportDir } = resolveDestination()

if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
  usage(`${outPath} is a directory`)
}

if (fs.existsSync(outPath) && !flag('--force')) {
  usage(`${outPath} already exists. Pass --force to overwrite it deliberately.`)
}

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), '.data', 'space-relics.db')

if (!fs.existsSync(dbPath)) {
  console.log('No legacy SQLite database found — nothing to export.')
  process.exit(0)
}

let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  console.error('Reading the legacy file needs Node 22.5+ (node:sqlite). Run this on a newer Node.')
  process.exit(1)
}

const db = new DatabaseSync(dbPath, { readOnly: true })
let missions
try {
  const columns = new Set(db.prepare('PRAGMA table_info(missions)').all().map((column) => column.name))
  if (!columns.size) {
    console.log('The legacy database has no missions table — nothing to export.')
    process.exit(0)
  }
  const rows = db.prepare('SELECT * FROM missions ORDER BY created_at').all()
  // siteName, created_at and the optional updated_at travel with every record.
  missions = rows.map((row) => rowToMission(row, columns))
} finally {
  db.close()
}

const payload = buildExportPayload(missions, { source: 'sqlite:.data/space-relics.db (v1 schema)' })

console.log(WARNING)
console.log(`Writing ${missions.length} mission record(s) to ${outPath}`)
if (!insideExportDir) console.log('Note: the destination is outside .data/exports/ and is not covered by the default ignore rules.')

fs.mkdirSync(path.dirname(outPath), { recursive: true })
// 0600 on POSIX: readable only by the account running the migration.
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), { mode: 0o600 })

console.log(`Exported ${missions.length} mission record(s).`)
console.log('Next: npm run db:import -- ' + (insideExportDir ? '--from ' + path.relative(process.cwd(), outPath) : '--from ' + outPath))
