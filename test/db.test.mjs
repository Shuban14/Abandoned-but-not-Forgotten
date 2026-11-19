// Database tests against a real PostgreSQL engine (PGlite, in-memory WASM).
//
// This proves the migrations and the mission SQL are valid PostgreSQL, that
// session scoping works, and that a rollback really removes the schema — all
// without needing Neon credentials. It does not test the Neon HTTP transport
// itself; that is exercised only by a deployed instance with DATABASE_URL set.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import {
  appliedVersions,
  migrateDown,
  migrateUp,
  pendingMigrations,
} from '../lib/migrations.mjs'

const db = new PGlite()

/** Adapter that turns the tagged-template calls into parameterised PGlite SQL. */
function sql(strings, ...values) {
  let text = strings[0]
  for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`
  return db.query(text, values).then((result) => result.rows)
}

function mission(overrides) {
  return {
    id: crypto.randomUUID(),
    sessionId: '11111111-1111-4111-8111-111111111111',
    siteId: 'shar',
    siteName: 'Satish Dhawan Space Centre',
    target: 'moon',
    success: true,
    partial: false,
    speedBudgetMps: 9800,
    requiredSpeedMps: 11600,
    twr: 1.42,
    weightT: 420.5,
    stages: 3,
    parts: ['nose', 'commsat', 'solar'],
    failureCode: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

async function insertMission(m) {
  await sql`
    INSERT INTO missions (
      id, session_id, site_id, site_name, target, success, partial,
      speed_budget_mps, required_speed_mps, twr, weight_t, stages,
      parts_json, failure_code, created_at
    ) VALUES (
      ${m.id}, ${m.sessionId}, ${m.siteId}, ${m.siteName}, ${m.target},
      ${m.success}, ${m.partial}, ${m.speedBudgetMps}, ${m.requiredSpeedMps},
      ${m.twr}, ${m.weightT}, ${m.stages}, ${JSON.stringify(m.parts)},
      ${m.failureCode ?? null}, ${m.createdAt}
    )
  `
}

async function listMissions(sessionId, limit) {
  return sql`
    SELECT id, session_id, site_name, success, twr, parts_json, created_at
    FROM missions
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `
}

after(async () => {
  await db.close()
})

test('migrations build the schema on a fresh database', async () => {
  const applied = await migrateUp(sql)
  assert.deepEqual(applied, ['001_create_missions', '002_add_mission_updated_at'])
  assert.deepEqual(await appliedVersions(sql), [1, 2])
  assert.deepEqual(await pendingMigrations(sql), [])

  const table = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'missions'`
  assert.equal(table.length, 1)
})

test('migrations are idempotent', async () => {
  assert.deepEqual(await migrateUp(sql), [])
})

test('missions insert and stay scoped to their session', async () => {
  const a1 = mission({ createdAt: '2026-01-01T10:00:00.000Z' })
  const a2 = mission({ createdAt: '2026-02-01T10:00:00.000Z', success: false, failureCode: 'lowDv' })
  const b1 = mission({
    sessionId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-03-01T10:00:00.000Z',
  })
  await insertMission(a1)
  await insertMission(a2)
  await insertMission(b1)

  const mine = await listMissions(a1.sessionId, 10)
  assert.equal(mine.length, 2)
  assert.deepEqual(
    mine.map((row) => row.id),
    [a2.id, a1.id],
    'newest first',
  )
  assert.equal(mine[0].success, false)
  assert.equal(mine[1].success, true)
  assert.deepEqual(JSON.parse(mine[1].parts_json), ['nose', 'commsat', 'solar'])

  const other = await listMissions(b1.sessionId, 10)
  assert.deepEqual(other.map((row) => row.id), [b1.id])

  const limited = await listMissions(a1.sessionId, 1)
  assert.equal(limited.length, 1)
})

test('schema constraints reject bad rows', async () => {
  await assert.rejects(() => insertMission(mission({ target: 'jupiter' })), /violates check constraint/)
  await assert.rejects(() => insertMission(mission({ id: 'fixed-id' })).then(() => insertMission(mission({ id: 'fixed-id' }))), /duplicate key/)
})

test('rolling back removes the schema and re-running rebuilds it', async () => {
  // v2 is the newest applied migration, so it goes first.
  assert.equal(await migrateDown(sql), '002_add_mission_updated_at')
  assert.equal(await migrateDown(sql), '001_create_missions')
  const table = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'missions'`
  assert.equal(table.length, 0)

  assert.deepEqual(await migrateUp(sql), ['001_create_missions', '002_add_mission_updated_at'])
  assert.equal((await listMissions('11111111-1111-4111-8111-111111111111', 10)).length, 0)
})
