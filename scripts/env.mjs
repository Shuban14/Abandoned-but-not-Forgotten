// Minimal .env loader for the plain-Node maintenance scripts.
//
// Next.js loads these files itself when it runs, but `node scripts/db.mjs` does
// not. Values already present in the environment always win, and nothing is
// ever printed.
import fs from 'node:fs'
import path from 'node:path'

const FILES = ['.env.local', '.env.production.local', '.env']

export function loadEnv(files = FILES) {
  for (const name of files) {
    let raw
    try {
      raw = fs.readFileSync(path.join(process.cwd(), name), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
  }
}

/** Returns the trimmed DATABASE_URL or exits with setup instructions. */
export function requireDatabaseUrl() {
  const url = (process.env.DATABASE_URL ?? '').trim()
  if (!url) {
    console.error(`
  DATABASE_URL is not set.

  Mission storage is PostgreSQL (Neon). Create a Neon database and put its
  connection string in .env.local (never commit it):

    DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require

  Locally that file is ignored by git. On Vercel add DATABASE_URL under
  Project → Settings → Environment Variables (Production + Preview).
`)
    process.exit(1)
  }
  return url
}
