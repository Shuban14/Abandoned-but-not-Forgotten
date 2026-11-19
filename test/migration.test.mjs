// End-to-end migration test: a representative legacy SQLite mission log is
// exported through the same code the CLI uses, imported into a real PostgreSQL
// engine (PGlite), and compared field by field. No Neon credentials required.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateUp } from '../lib/migrations.mjs'
import { rowToMission, importMissions, missionsFromPayload } from '../scripts/lib/mission-transfer.mjs'

const db = new PGlite()
const sql = (strings, ...values) => {
  let text = strings[0]
  for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`
  return db.query(text, values).then((result) => result.rows)
}

after(async () => {
  await db.close()
})

function makeLegacyDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), 'space-relics-'))
  const file = path.join(dir, 'space-relics.db')
  const legacy = new DatabaseSync(file)
  legacy.exec(`
    CREATE TABLE missions (
      id TEXT,
      session_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      target TEXT NOT NULL,
      success INTEGER NOT NULL,
      partial INTEGER NOT NULL,
      speed_budget_mps INTEGER NOT NULL,
      required_speed_mps INTEGER NOT NULL,
      twr REAL NOT NULL,
      weight_t REAL NOT NULL,
      stages INTEGER NOT NULL,
      parts_json TEXT NOT NULL,
      failure_code TEXT,
      created_at TEXT NOT NULL
    )
  `)

  const rows = [
    {
      id: 'mission-1',
      session_id: '11111111-1111-4111-8111-111111111111',
      site_id: 'shar',
      site_name: 'Satish Dhawan Space Centre',
      target: 'moon',
      success: 1,
      partial: 0,
      speed_budget_mps: 9800,
      required_speed_mps: 11600,
      twr: 1.42,
      weight_t: 420.5,
      stages: 3,
      parts_json: JSON.stringify(['nose', 'commsat', 'solar']),
      failure_code: null,
      created_at: '2026-01-01T10:00:00.000Z',
    },
    {
      id: 'mission-2',
      session_id: '11111111-1111-4111-8111-111111111111',
      site_id: 'cape',
      site_name: 'Cape Canaveral',
      target: 'mars',
      success: 0,
      partial: 1,
      speed_budget_mps: 12000,
      required_speed_mps: 13000,
      twr: 1.1,
      weight_t: 900,
      stages: 2,
      parts_json: JSON.stringify(['capsule']),
      failure_code: 'lowDv',
      created_at: '2026-02-01T10:00:00.000Z',
    },
    {
      id: 'mission-3',
      session_id: '22222222-2222-4222-8222-222222222222',
      site_id: 'baikonur',
      site_name: 'Baikonur Cosmodrome',
      target: 'leo',
      success: 1,
      partial: 0,
      speed_budget_mps: 7800,
      required_speed_mps: 7800,
      twr: 1.6,
      weight_t: 300,
      stages: 1,
      parts_json: '[]',
      failure_code: null,
      created_at: '2026-03-01T10:00:00.000Z',
    },
  ]

  const insert = legacy.prepare(`
    INSERT INTO missions (
      id, session_id, site_id, site_name, target, success, partial,
      speed_budget_mps, required_speed_mps, twr, weight_t, stages,
      parts_json, failure_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of rows) {
    insert.run(
      row.id, row.session_id, row.site_id, row.site_name, row.target,
      row.success, row.partial, row.speed_budget_mps, row.required_speed_mps,
      row.twr, row.weight_t, row.stages, row.parts_json, row.failure_code,
      row.created_at,
    )
  }
  legacy.close()
  return { dir, file, rows }
}

test('legacy export → PostgreSQL round trip preserves every field', async () => {
  await migrateUp(sql)

  const { dir, file, rows } = makeLegacyDatabase()
  try {
    const legacy = new DatabaseSync(file, { readOnly: true })
    const columns = new Set(legacy.prepare('PRAGMA table_info(missions)').all().map((column) => column.name))
    const sourceRows = legacy.prepare('SELECT * FROM missions ORDER BY created_at').all()
    legacy.close()

    const missions = sourceRows.map((row) => rowToMission(row, columns))
    assert.equal(missions.length, rows.length)

    const report = await importMissions(sql, missions)
    assert.equal(report.inserted, rows.length)
    assert.equal(report.skipped, 0)
    assert.deepEqual(report.invalid, [])

    const stored = await sql`SELECT id, session_id, site_id, site_name, target, success, partial, speed_budget_mps, required_speed_mps, twr, weight_t, stages, parts_json, failure_code, created_at, updated_at FROM missions ORDER BY created_at`
    assert.equal(stored.length, rows.length)

    for (let i = 0; i < rows.length; i += 1) {
      const original = rows[i]
      const record = stored[i]
      assert.equal(record.id, original.id)
      assert.equal(record.session_id, original.session_id)
      assert.equal(record.site_id, original.site_id)
      assert.equal(record.site_name, original.site_name, 'launch-site name must survive migration')
      assert.equal(record.target, original.target)
      assert.equal(record.success, Boolean(original.success))
      assert.equal(record.partial, Boolean(original.partial))
      assert.equal(record.speed_budget_mps, original.speed_budget_mps)
      assert.equal(record.required_speed_mps, original.required_speed_mps)
      assert.equal(record.twr, original.twr)
      assert.equal(record.weight_t, original.weight_t)
      assert.equal(record.stages, original.stages)
      assert.deepEqual(JSON.parse(record.parts_json), JSON.parse(original.parts_json))
      assert.equal(record.failure_code, original.failure_code)
      assert.equal(new Date(record.created_at).toISOString(), new Date(original.created_at).toISOString())
      // updated_at defaults to created_at when the legacy row had none.
      assert.equal(new Date(record.updated_at).toISOString(), new Date(original.created_at).toISOString())
    }

    // Repeatable: a second import inserts nothing and loses nothing.
    const second = await importMissions(sql, missions)
    assert.equal(second.inserted, 0)
    assert.equal(second.skipped, rows.length)
    assert.equal((await sql`SELECT count(*)::int AS count FROM missions`)[0].count, rows.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('import rejects malformed records without writing them', async () => {
  const payload = missionsFromPayload({ missions: [{ id: 'bad', sessionId: 'nope', target: 'moon', createdAt: '2026-01-01T00:00:00Z' }] })
  const report = await importMissions(sql, payload)
  assert.equal(report.inserted, 0)
  assert.equal(report.invalid.length, 1)
})

test('site name falls back to the id only when the record has none', async () => {
  // resolveSiteName is exercised through rowToMission with a missing site_name
  // column: build a legacy row without site_name and confirm the canonical
  // table fills it in.
  const dir = mkdtempSync(path.join(tmpdir(), 'space-relics-'))
  const file = path.join(dir, 'legacy.db')
  const legacy = new DatabaseSync(file)
  legacy.exec(`
    CREATE TABLE missions (
      id TEXT, session_id TEXT NOT NULL, site_id TEXT NOT NULL,
      target TEXT NOT NULL, success INTEGER NOT NULL, partial INTEGER NOT NULL,
      speed_budget_mps INTEGER NOT NULL, required_speed_mps INTEGER NOT NULL,
      twr REAL NOT NULL, weight_t REAL NOT NULL, stages INTEGER NOT NULL,
      parts_json TEXT NOT NULL, failure_code TEXT, created_at TEXT NOT NULL
    )
  `)
  legacy.prepare(`INSERT INTO missions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'mission-x', '11111111-1111-4111-8111-111111111111', 'shar', 'moon', 1, 0,
    100, 100, 1, 1, 1, '[]', null, '2026-01-01T00:00:00.000Z',
  )
  legacy.close()

  const reopened = new DatabaseSync(file, { readOnly: true })
  const columns = new Set(reopened.prepare('PRAGMA table_info(missions)').all().map((c) => c.name))
  const row = reopened.prepare('SELECT * FROM missions').get()
  reopened.close()
  const mission = rowToMission(row, columns)
  assert.equal(mission.siteName, 'Satish Dhawan Space Centre')
  rmSync(dir, { recursive: true, force: true })
})
