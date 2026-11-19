// Shared logic for moving the legacy SQLite mission log into PostgreSQL.
//
// Framework-free and side-effect free so the CLI wrappers and the test suite
// (`test/mission-migration.test.mjs`) exercise the exact same conversion code.
// The conversion is deliberately schema-tolerant: the v1 SQLite table is read
// through its real column list, so optional columns are carried over when they
// exist and never invented when they do not.

import { resolveSiteName } from '../../lib/launch-sites.mjs'

/** Shape of the export file currently written by `db:export-sqlite`. */
export const EXPORT_SCHEMA_VERSION = 2

/** Targets accepted by the PostgreSQL CHECK constraint. */
export const TARGETS = ['leo', 'moon', 'mars']

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/

const asString = (value) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value))
const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const asBoolean = (value) => value === true || value === 1 || value === '1' || value === 'true'

/**
 * Parses a timestamp without inventing one.
 * @param {unknown} value
 * @returns {string | null} ISO string, or null when absent/unparseable
 */
export function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Converts one SQLite row into an export record.
 *
 * @param {Record<string, unknown>} row
 * @param {Set<string>} columns column names that really exist in the table
 */
export function rowToMission(row, columns) {
  const has = (name) => columns.has(name)

  const mission = {
    id: asString(row.id),
    sessionId: asString(row.session_id),
    siteId: asString(row.site_id),
    // The v1 schema stores the full launch-site name; dropping it here is what
    // made migrated missions show "shar" instead of "Satish Dhawan Space Centre".
    siteName: has('site_name') ? asString(row.site_name).trim() : '',
    target: asString(row.target),
    success: asBoolean(row.success),
    partial: asBoolean(row.partial),
    speedBudgetMps: asNumber(row.speed_budget_mps),
    requiredSpeedMps: asNumber(row.required_speed_mps),
    twr: asNumber(row.twr),
    weightT: asNumber(row.weight_t),
    stages: asNumber(row.stages),
    parts: parseParts(row.parts_json),
    failureCode: row.failure_code === null || row.failure_code === undefined ? null : asString(row.failure_code),
    createdAt: toIsoTimestamp(row.created_at),
  }

  // Optional columns: carried over only when the legacy table actually has them.
  if (has('updated_at')) mission.updatedAt = toIsoTimestamp(row.updated_at)
  if (has('name')) mission.name = asString(row.name)
  if (has('description')) mission.description = asString(row.description)

  // Never fall back to the raw id: use the canonical table first, the id last.
  mission.siteName = resolveSiteName(mission)

  return mission
}

/** @param {unknown} raw */
function parseParts(raw) {
  if (Array.isArray(raw)) return raw.filter((part) => typeof part === 'string')
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((part) => typeof part === 'string') : []
  } catch {
    return []
  }
}

/**
 * Wraps exported missions in the file envelope.
 * @param {ReturnType<typeof rowToMission>[]} missions
 * @param {{ source?: string }} [meta]
 */
export function buildExportPayload(missions, meta = {}) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: meta.source ?? 'sqlite:legacy mission log',
    count: missions.length,
    missions,
  }
}

/**
 * Validates and normalises one exported mission for import.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, reason: string }}
 */
export function normalizeForImport(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' }
  const mission = /** @type {Record<string, unknown>} */ (raw)

  const id = asString(mission.id)
  if (!ID_RE.test(id)) return { ok: false, reason: 'invalid mission id' }

  const sessionId = asString(mission.sessionId)
  if (!SESSION_RE.test(sessionId)) return { ok: false, reason: 'invalid session id' }

  const target = asString(mission.target)
  if (!TARGETS.includes(target)) return { ok: false, reason: 'unknown mission target' }

  // A mission needs a creation time to keep its place in the log; inventing one
  // would silently rewrite history, so an unusable value is rejected instead.
  const createdAt = toIsoTimestamp(mission.createdAt)
  if (!createdAt) return { ok: false, reason: 'missing created timestamp' }

  const updatedAt = toIsoTimestamp(mission.updatedAt) ?? createdAt
  const siteId = asString(mission.siteId)

  return {
    ok: true,
    value: {
      id,
      sessionId,
      siteId,
      siteName: resolveSiteName({ siteId, siteName: mission.siteName }),
      target,
      success: asBoolean(mission.success),
      partial: asBoolean(mission.partial),
      speedBudgetMps: Math.round(asNumber(mission.speedBudgetMps)),
      requiredSpeedMps: Math.round(asNumber(mission.requiredSpeedMps)),
      twr: asNumber(mission.twr),
      weightT: asNumber(mission.weightT),
      stages: Math.round(asNumber(mission.stages)),
      parts: parseParts(mission.parts),
      failureCode: mission.failureCode ? asString(mission.failureCode) : null,
      createdAt,
      updatedAt,
    },
  }
}

/** Reads the missions array out of an export envelope (or a bare array). */
export function missionsFromPayload(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.missions)) return payload.missions
  return []
}

/**
 * Inserts missions through a Neon-compatible tagged-template `sql` function.
 *
 * Rows are matched by primary key and never overwritten, so the import is
 * repeatable: a second run inserts nothing and reports the rows as existing.
 * Nothing is written when `dryRun` is set.
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>} sql
 * @param {unknown[]} missions
 * @param {{ dryRun?: boolean }} [options]
 */
export async function importMissions(sql, missions, { dryRun = false } = {}) {
  const report = { total: missions.length, inserted: 0, skipped: 0, invalid: [], dryRun }

  for (const raw of missions) {
    const normalised = normalizeForImport(raw)
    if (!normalised.ok) {
      report.skipped += 1
      report.invalid.push(normalised.reason)
      continue
    }
    if (dryRun) {
      report.inserted += 1
      continue
    }

    const value = normalised.value
    const rows = await sql`
      INSERT INTO missions (
        id, session_id, site_id, site_name, target, success, partial,
        speed_budget_mps, required_speed_mps, twr, weight_t, stages,
        parts_json, failure_code, created_at, updated_at
      ) VALUES (
        ${value.id}, ${value.sessionId}, ${value.siteId}, ${value.siteName},
        ${value.target}, ${value.success}, ${value.partial},
        ${value.speedBudgetMps}, ${value.requiredSpeedMps}, ${value.twr},
        ${value.weightT}, ${value.stages}, ${JSON.stringify(value.parts)},
        ${value.failureCode}, ${value.createdAt}, ${value.updatedAt}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `
    if (rows.length) report.inserted += 1
    else report.skipped += 1
  }

  return report
}
