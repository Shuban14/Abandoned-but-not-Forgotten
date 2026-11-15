// Relic data access (server only).
//
// Single source of truth: `public/space/planets/data/missions.json`, the same
// file the 3D Planet Explorer loads in the browser. Nothing is duplicated and
// no coordinates, dates or facts are invented here - every field is copied
// straight out of that dataset (NASA/USGS public-domain landing coordinates;
// see Lonch game/launch-lab/CREDITS.md).
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PlanetId, Relic, RelicCategory } from './types'

export type { PlanetId, Relic, RelicCategory }

type LandingRecord = {
  name: string
  agency: string
  year: number
  lat: number
  lon: number
  kind: string
  wiki: string
  approx?: boolean
}

type MissionsFile = Record<PlanetId, { radiusKm: number; landings: LandingRecord[] }>

const DATA_FILE = path.join(process.cwd(), 'public', 'space', 'planets', 'data', 'missions.json')
const DATASET_NAME = 'planets/data/missions.json'
const DATASET_CREDIT = 'NASA / USGS landing coordinates (public domain)'

export const PLANET_IDS: PlanetId[] = ['moon', 'mars']

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function categoryOf(kind: string): RelicCategory {
  if (/crewed/i.test(kind)) return 'crewed'
  if (/rover/i.test(kind)) return 'rover'
  if (/sample return/i.test(kind)) return 'sample-return'
  return 'lander'
}

let cache: Relic[] | null = null
let pending: Promise<Relic[]> | null = null

async function load(): Promise<Relic[]> {
  if (cache) return cache
  if (pending) return pending
  pending = (async () => {
    const raw = await fs.readFile(DATA_FILE, 'utf8')
    const file = JSON.parse(raw) as MissionsFile
    const out: Relic[] = []
    for (const planet of PLANET_IDS) {
      const landings = file[planet]?.landings ?? []
      for (const l of landings) {
        out.push({
          id: `${planet}-${slugify(l.name)}`,
          name: l.name,
          planet,
          latitude: l.lat,
          longitude: l.lon,
          approximate: l.approx === true,
          agency: l.agency,
          year: l.year,
          kind: l.kind,
          category: categoryOf(l.kind),
          wikiTitle: l.wiki,
          source: { dataset: DATASET_NAME, credit: DATASET_CREDIT, record: l.name },
        })
      }
    }
    out.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
    cache = out
    return out
  })()
  try {
    return await pending
  } finally {
    pending = null
  }
}

export type RelicQuery = {
  planet?: PlanetId | 'all'
  category?: RelicCategory
  q?: string
  limit?: number
}

export async function listRelics(query: RelicQuery = {}): Promise<Relic[]> {
  const all = await load()
  const q = query.q?.trim().toLowerCase()
  let items = all
  if (query.planet && query.planet !== 'all') items = items.filter((r) => r.planet === query.planet)
  if (query.category) items = items.filter((r) => r.category === query.category)
  if (q) {
    items = items.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.agency.toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q),
    )
  }
  return query.limit ? items.slice(0, query.limit) : items
}

export async function getRelic(id: string): Promise<Relic | null> {
  return (await load()).find((r) => r.id === id) ?? null
}

export async function relicCounts(): Promise<Record<PlanetId, number> & { total: number }> {
  const all = await load()
  return {
    total: all.length,
    moon: all.filter((r) => r.planet === 'moon').length,
    mars: all.filter((r) => r.planet === 'mars').length,
  }
}

export function isPlanetId(value: unknown): value is PlanetId {
  return value === 'moon' || value === 'mars'
}
