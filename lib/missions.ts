// Mission persistence + server-side validation.
// The browser is never trusted: every value is re-checked here before it is
// written, and stored values are re-typed and rounded.
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { MissionInput, MissionRecord, MissionTarget } from './types'

/** Launch sites shipped by the game (`public/space/sim.js`). */
export const LAUNCH_SITES: Record<string, string> = {
  shar: 'Satish Dhawan Space Centre',
  kourou: 'Guiana Space Centre',
  cape: 'Cape Canaveral',
  baikonur: 'Baikonur Cosmodrome',
  jiuquan: 'Jiuquan Launch Centre',
  tanegashima: 'Tanegashima Space Center',
  mahia: 'Mahia Peninsula',
  vandenberg: 'Vandenberg (polar launches)',
}

const TARGETS: MissionTarget[] = ['leo', 'moon', 'mars']
const PART_ID = /^[a-zA-Z]{2,16}$/

export type ValidationResult =
  | { ok: true; value: MissionInput }
  | { ok: false; errors: string[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function validateMissionInput(raw: unknown): ValidationResult {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['body must be a JSON object'] }
  }
  const b = raw as Record<string, unknown>

  const siteId = typeof b.siteId === 'string' ? b.siteId : ''
  if (!LAUNCH_SITES[siteId]) errors.push('siteId must be one of the known launch sites')

  const target = typeof b.target === 'string' ? (b.target as MissionTarget) : ('' as MissionTarget)
  if (!TARGETS.includes(target)) errors.push("target must be 'leo', 'moon' or 'mars'")

  if (typeof b.success !== 'boolean') errors.push('success must be a boolean')
  if (b.partial !== undefined && typeof b.partial !== 'boolean') errors.push('partial must be a boolean')

  if (!isNum(b.speedBudgetMps) || b.speedBudgetMps < 0 || b.speedBudgetMps > 100_000) {
    errors.push('speedBudgetMps must be a number between 0 and 100000')
  }
  if (!isNum(b.requiredSpeedMps) || b.requiredSpeedMps <= 0 || b.requiredSpeedMps > 100_000) {
    errors.push('requiredSpeedMps must be a number between 1 and 100000')
  }
  if (!isNum(b.twr) || b.twr < 0 || b.twr > 100) errors.push('twr must be a number between 0 and 100')
  if (!isNum(b.weightT) || b.weightT < 0 || b.weightT > 10_000) {
    errors.push('weightT must be a number between 0 and 10000')
  }
  if (!isNum(b.stages) || !Number.isInteger(b.stages) || b.stages < 1 || b.stages > 12) {
    errors.push('stages must be an integer between 1 and 12')
  }

  let parts: string[] = []
  if (!Array.isArray(b.parts)) errors.push('parts must be an array')
  else if (b.parts.length > 64) errors.push('parts must contain at most 64 entries')
  else if (!b.parts.every((p) => typeof p === 'string' && PART_ID.test(p))) {
    errors.push('parts must contain part identifiers only')
  } else parts = b.parts as string[]

  let failureCode: string | null = null
  if (b.failureCode !== undefined && b.failureCode !== null) {
    if (typeof b.failureCode !== 'string' || b.failureCode.length > 48) {
      errors.push('failureCode must be a string of at most 48 characters')
    } else failureCode = b.failureCode
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      siteId,
      target,
      success: b.success as boolean,
      partial: (b.partial as boolean | undefined) ?? false,
      speedBudgetMps: Math.round(clampNum(b.speedBudgetMps as number, 0, 100_000)),
      requiredSpeedMps: Math.round(clampNum(b.requiredSpeedMps as number, 1, 100_000)),
      twr: Math.round(clampNum(b.twr as number, 0, 100) * 100) / 100,
      weightT: Math.round(clampNum(b.weightT as number, 0, 10_000) * 10) / 10,
      stages: b.stages as number,
      parts,
      failureCode,
    },
  }
}

type Row = {
  id: string
  site_id: string
  site_name: string
  target: string
  success: number
  partial: number
  speed_budget_mps: number
  required_speed_mps: number
  twr: number
  weight_t: number
  stages: number
  parts_json: string
  failure_code: string | null
  created_at: string
}

function toRecord(row: Row): MissionRecord {
  let parts: string[] = []
  try {
    const parsed = JSON.parse(row.parts_json)
    if (Array.isArray(parsed)) parts = parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    parts = []
  }
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    target: row.target as MissionTarget,
    success: row.success === 1,
    partial: row.partial === 1,
    speedBudgetMps: Number(row.speed_budget_mps),
    requiredSpeedMps: Number(row.required_speed_mps),
    twr: Number(row.twr),
    weightT: Number(row.weight_t),
    stages: Number(row.stages),
    parts,
    failureCode: row.failure_code,
    createdAt: row.created_at,
  }
}

export function saveMission(sessionId: string, input: MissionInput): MissionRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO missions (
         id, session_id, site_id, site_name, target, success, partial,
         speed_budget_mps, required_speed_mps, twr, weight_t, stages,
         parts_json, failure_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      input.siteId,
      LAUNCH_SITES[input.siteId],
      input.target,
      input.success ? 1 : 0,
      input.partial ? 1 : 0,
      input.speedBudgetMps,
      input.requiredSpeedMps,
      input.twr,
      input.weightT,
      input.stages,
      JSON.stringify(input.parts),
      input.failureCode ?? null,
      createdAt,
    )
  return { ...input, id, siteName: LAUNCH_SITES[input.siteId], createdAt }
}

export function listMissions(sessionId: string, limit = 10): MissionRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM missions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(sessionId, limit) as Row[]
  return rows.map(toRecord)
}

export function countMissions(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM missions').get() as { n: number } | undefined
  return Number(row?.n ?? 0)
}
