// Types shared by the API routes and the browser client.
// Client-safe: this module must never import node:* modules.

export type PlanetId = 'moon' | 'mars'
export type RelicCategory = 'crewed' | 'rover' | 'sample-return' | 'lander'
export type ExplorerMode = 'junior' | 'analyst'

export const CATEGORIES: { id: RelicCategory; label: string }[] = [
  { id: 'crewed', label: 'Crewed missions' },
  { id: 'rover', label: 'Rovers' },
  { id: 'sample-return', label: 'Sample return' },
  { id: 'lander', label: 'Landers & probes' },
]

export function isCategory(value: unknown): value is RelicCategory {
  return CATEGORIES.some((entry) => entry.id === value)
}

export function isPlanet(value: unknown): value is PlanetId {
  return value === 'moon' || value === 'mars'
}

export const PLANET_LABELS: Record<PlanetId, string> = {
  moon: "Earth's Moon",
  mars: 'Mars',
}

/** A piece of hardware humanity left behind, derived from the existing dataset. */
export type Relic = {
  /** Stable slug, e.g. `moon-apollo-11`. */
  id: string
  name: string
  planet: PlanetId
  latitude: number
  longitude: number
  /** True when the dataset itself flags the coordinates as rounded. */
  approximate: boolean
  agency: string
  year: number
  /** `kind` exactly as recorded in the dataset. */
  kind: string
  category: RelicCategory
  /** Wikipedia article title shipped with the record. */
  wikiTitle: string
  source: {
    dataset: string
    credit: string
    record: string
  }
}

export type MissionTarget = 'leo' | 'moon' | 'mars'

/** Payload the Launch Lab frame sends when a mission ends. */
export type MissionInput = {
  siteId: string
  target: MissionTarget
  success: boolean
  partial: boolean
  speedBudgetMps: number
  requiredSpeedMps: number
  twr: number
  weightT: number
  stages: number
  parts: string[]
  failureCode?: string | null
}

/** A mission that the server confirmed it stored. */
export type MissionRecord = MissionInput & {
  id: string
  siteName: string
  createdAt: string
}

export type HealthReport = {
  status: 'ok' | 'degraded'
  service: string
  time: string
  latencyMs: number
  checks: {
    database: { ok: boolean; detail: string }
    relicData: { ok: boolean; records: number }
  }
}

export type ApiEnvelope<T> = {
  data: T
  meta?: Record<string, unknown>
}

export type ApiErrorBody = {
  error: { code: string; message: string }
}

export type RelicListMeta = {
  planet: PlanetId | 'all'
  category: RelicCategory | 'all'
  total: number
  counts: Record<PlanetId, number>
}
