// Import a legacy export into PostgreSQL (Neon).
//
//   npm run db:import                          reads .data/exports/missions-export.json
//   npm run db:import -- --from other.json     reads another export file
//   npm run db:import -- --dry-run             validate only, write nothing
//
// Safe to run more than once: rows are matched by primary key, so an existing
// mission is never duplicated and never overwritten. Launch-site names and both
// timestamps are carried over from the export.
import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'
import { migrateUp } from '../lib/migrations.mjs'
import { loadEnv, requireDatabaseUrl } from './env.mjs'
import { importMissions, missionsFromPayload } from './lib/mission-transfer.mjs'

loadEnv()

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

function inputPath() {
  const fromIndex = args.indexOf('--from')
  if (fromIndex !== -1) {
    const value = args[fromIndex + 1]
    if (!value || value.startsWith('--')) {
      console.error('import-missions: --from needs a file path')
      process.exit(1)
    }
    return path.resolve(process.cwd(), value)
  }
  const positional = args.find((arg) => !arg.startsWith('--'))
  if (positional) return path.resolve(process.cwd(), positional)
  return path.join(process.cwd(), '.data', 'exports', 'missions-export.json')
}

const inPath = inputPath()
if (!fs.existsSync(inPath)) {
  console.error(`No export file at ${inPath}. Run \`npm run db:export-sqlite\` first.`)
  process.exit(1)
}

let payload
try {
  payload = JSON.parse(fs.readFileSync(inPath, 'utf8'))
} catch {
  console.error(`${inPath} is not valid JSON.`)
  process.exit(1)
}

const missions = missionsFromPayload(payload)
if (!missions.length) {
  console.log('The export contains no missions — nothing to import.')
  process.exit(0)
}

if (Number(payload?.schemaVersion ?? 1) < 2) {
  console.log(
    'Note: this export predates schema version 2 and may not carry launch-site names.\n' +
      '      Re-run `npm run db:export-sqlite` to export the full record set.',
  )
}

let sql
try {
  sql = neon(requireDatabaseUrl())
} catch (error) {
  console.error('Cannot connect:', error instanceof Error ? error.message : 'invalid database configuration')
  process.exit(1)
}

try {
  if (!dryRun) await migrateUp(sql)
  const report = await importMissions(sql, missions, { dryRun })
  console.log(
    `${dryRun ? 'Dry run: would import' : 'Imported'} ${report.inserted} of ${report.total} mission record(s); ` +
      `${report.skipped} already present or unusable.`,
  )
  if (report.invalid.length) {
    const counts = new Map()
    for (const reason of report.invalid) counts.set(reason, (counts.get(reason) ?? 0) + 1)
    for (const [reason, count] of counts) console.log(`  skipped ${count}: ${reason}`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown error'
  // Never echo the connection string, even if a driver error embeds it.
  console.error('Import failed:', message.replace(/postgres(ql)?:\/\/\S+/gi, 'postgres://***'))
  process.exit(1)
}
