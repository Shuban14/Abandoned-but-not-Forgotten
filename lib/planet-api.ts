// Planet Explorer data service (server side).
//
// Ported from the original `Lonch game/launch-lab/api/server.js` so the whole
// product runs on one backend instead of a second local server on port 3999.
// Behaviour is unchanged: the same upstream services, the same TTLs, the same
// memory + disk cache with single-flight and stale-on-error fallback.
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PlanetId } from './types'

const CACHE_DIR = path.join(process.cwd(), '.cache', 'planet-api')
const DATA_FILE = path.join(process.cwd(), 'public', 'space', 'planets', 'data', 'missions.json')
const UA = 'SpaceRelics/1.0 (educational viewer)'

type CacheEntry = { at: number; data: unknown }
const mem = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

export class UpstreamError extends Error {}

function cacheFile(key: string) {
  return path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`)
}

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = mem.get(key)
  if (hit && now - hit.at < ttlMs) return hit.data as T
  if (inflight.has(key)) return inflight.get(key) as Promise<T>

  const file = cacheFile(key)
  const task = (async () => {
    try {
      const data = await load()
      mem.set(key, { at: Date.now(), data })
      await fs.mkdir(CACHE_DIR, { recursive: true })
      await fs.writeFile(file, JSON.stringify({ at: Date.now(), data })).catch(() => {})
      return data
    } catch (error) {
      // Upstream down: serve the last good copy rather than an error.
      const stale = hit ? { data: hit.data } : await fs.readFile(file, 'utf8').then((t) => JSON.parse(t)).catch(() => null)
      if (stale?.data) return { ...(stale.data as Record<string, unknown>), stale: true } as unknown as T
      throw error
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, task as Promise<unknown>)
  return task
}

async function getJSON<T = Record<string, unknown>>(url: string, timeout = 30_000): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new UpstreamError(`${response.status} from ${new URL(url).host}`)
  return (await response.json()) as T
}

type MissionsFile = Record<PlanetId, { orbiters: { name: string; hid?: number; periodH?: number }[] }>
let missionsPromise: Promise<MissionsFile> | null = null

function readMissions(): Promise<MissionsFile> {
  if (!missionsPromise) {
    missionsPromise = fs
      .readFile(DATA_FILE, 'utf8')
      .then((raw) => JSON.parse(raw) as MissionsFile)
      .catch((error) => {
        missionsPromise = null
        throw error
      })
  }
  return missionsPromise
}

// ---------- NASA JPL Horizons: real sub-satellite tracks ----------
const BODY_ID: Record<PlanetId, string> = { moon: '301', mars: '499' }
const AU = 149_597_870.7
const RADIUS: Record<PlanetId, number> = { moon: 1737.4, mars: 3389.5 }

const pad = (n: number) => String(n).padStart(2, '0')
const horizonsTime = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`

type OrbiterTrack = {
  name: string
  live: boolean
  stepMin?: number
  reason?: string
  points?: { t: number; lat: number; lon: number; alt: number }[]
}

async function track(body: PlanetId, orbiter: { name: string; hid?: number; periodH?: number }): Promise<OrbiterTrack> {
  const periodMin = Math.min((orbiter.periodH ?? 2) * 60, 3600)
  const step = Math.max(1, Math.round(periodMin / 120))
  const start = new Date(Date.now() - 5 * 60_000)
  const stop = new Date(Date.now() + (periodMin + 10) * 60_000)
  const query = new URLSearchParams({
    format: 'json',
    COMMAND: `'${BODY_ID[body]}'`,
    CENTER: `'500@${orbiter.hid}'`,
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    START_TIME: `'${horizonsTime(start)}'`,
    STOP_TIME: `'${horizonsTime(stop)}'`,
    STEP_SIZE: `'${step}m'`,
    QUANTITIES: "'14,20'",
    CSV_FORMAT: "'YES'",
  })

  let payload: { result?: string } | null = null
  for (let attempt = 1; ; attempt++) {
    try {
      payload = await getJSON(`https://ssd.jpl.nasa.gov/api/horizons.api?${query}`, 45_000)
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (attempt >= 4 || !/^(503|429|502)/.test(message)) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }

  const result = payload?.result ?? ''
  const from = result.indexOf('$$SOE')
  const to = result.indexOf('$$EOE')
  if (from < 0) {
    const last = result.trim().split('\n').filter(Boolean).pop() || 'no data'
    return { name: orbiter.name, live: false, reason: last.replace(/^\s*\*+\s*/, '').slice(0, 160) }
  }

  const westPositive = /West-longitude positive/i.test(result)
  const points = result
    .slice(from + 5, to)
    .trim()
    .split('\n')
    .map((line) => {
      const cells = line.split(',').map((s) => s.trim())
      let lon = parseFloat(cells[3])
      if (westPositive) lon = 360 - lon
      lon = ((lon + 540) % 360) - 180
      const t = Date.parse(cells[0].replace(/-(\w{3})-/, ' $1 ') + ' UTC')
      return {
        t,
        lat: +parseFloat(cells[4]).toFixed(4),
        lon: +lon.toFixed(4),
        alt: Math.round(parseFloat(cells[5]) * AU - RADIUS[body]),
      }
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat))

  return { name: orbiter.name, live: true, stepMin: step, points }
}

export async function getOrbiters(body: PlanetId) {
  return cached(`orb-${body}`, 30 * 60_000, async () => {
    const missions = await readMissions()
    const list = (missions[body]?.orbiters ?? []).filter((o) => o.hid !== undefined)
    const orbiters: OrbiterTrack[] = []
    for (const orbiter of list) {
      // One request at a time: Horizons rejects bursts with HTTP 503.
      orbiters.push(
        await track(body, orbiter).catch((error: unknown) => ({
          name: orbiter.name,
          live: false,
          reason: error instanceof Error ? error.message : 'unavailable',
        })),
      )
    }
    return { body, fetchedAt: new Date().toISOString(), source: 'NASA JPL Horizons', orbiters }
  })
}

// ---------- NASA/JPL MMGIS rover traverse + raw photos ----------
const TRAVERSE: Record<string, string> = {
  m20: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json',
  msl: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json',
}

export type RoverId = 'm20' | 'msl'
export const isRoverId = (value: unknown): value is RoverId => value === 'm20' || value === 'msl'

type GeoFeature = {
  geometry?: { type?: string; coordinates?: unknown }
  properties?: { sol?: number }
}

type TraverseFile = { features?: GeoFeature[] }

export async function getTraverse(rover: RoverId) {
  return cached(`trav-${rover}`, 6 * 3600_000, async () => {
    const geojson = await getJSON<TraverseFile>(TRAVERSE[rover], 60_000)
    const points: [number, number][] = []
    for (const feature of geojson.features ?? []) {
      const geometry = feature.geometry ?? {}
      const lines =
        geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? (geometry.coordinates as unknown[])
            : []
      for (const line of lines) {
        for (const coordinate of line as [number, number][]) {
          points.push([+coordinate[0].toFixed(6), +coordinate[1].toFixed(6)])
        }
      }
    }
    // Keep at most ~3000 points, always keeping the current position.
    const every = Math.max(1, Math.ceil(points.length / 3000))
    const slim = points.filter((_, index) => index % every === 0)
    const last = points[points.length - 1]
    if (last && slim[slim.length - 1] !== last) slim.push(last)
    const lastSol = geojson.features?.at(-1)?.properties?.sol ?? null
    return { rover, points: slim, current: last ?? null, lastSol, source: 'NASA/JPL MMGIS' }
  })
}

type NasaImage = {
  sol: number
  camera?: string
  taken?: string
  thumb?: string
  full?: string
  link?: string
}

export async function getRoverPhotos(rover: RoverId) {
  return cached(`photos-${rover}`, 3600_000, async () => {
    if (rover === 'm20') {
      const payload = await getJSON<{ images?: Record<string, unknown>[] }>(
        'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=60&page=0&order=sol+desc',
      )
      type Raw = {
        sol?: number
        sample_type?: string
        camera?: { instrument?: string }
        title?: string
        date_taken_utc?: string
        image_files?: { small?: string; medium?: string; large?: string; full_res?: string }
        link?: string
      }
      const items: NasaImage[] = ((payload.images ?? []) as Raw[])
        .filter((image) => image.sample_type === 'Full')
        .map((image) => ({
          sol: Number(image.sol),
          camera: image.camera?.instrument || image.title?.split(':').pop()?.trim(),
          taken: image.date_taken_utc,
          thumb: image.image_files?.small || image.image_files?.medium,
          full: image.image_files?.large || image.image_files?.full_res,
          link: image.link,
        }))
        .filter((image) => image.thumb)
      return { rover, items: items.slice(0, 24), credit: 'NASA/JPL-Caltech' }
    }

    const payload = await getJSON<{ items?: Record<string, unknown>[] }>(
      'https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=60&page=0&condition_1=msl:mission',
    )
    type Raw = {
      sol?: number
      instrument?: string
      date_taken?: string
      https_url?: string
      link?: string
      is_thumbnail?: boolean | string
    }
    const items: NasaImage[] = ((payload.items ?? []) as Raw[])
      .filter((item) => item.is_thumbnail !== true && item.is_thumbnail !== 'True')
      .map((item) => ({
        sol: Number(item.sol),
        camera: item.instrument,
        taken: item.date_taken,
        thumb: item.https_url,
        full: item.https_url,
        link: `https://mars.nasa.gov${item.link ?? ''}`,
      }))
      .filter((image) => image.thumb)
    return { rover, items: items.slice(0, 24), credit: 'NASA/JPL-Caltech/MSSS' }
  })
}

export const isPlanetBody = (value: unknown): value is PlanetId => value === 'moon' || value === 'mars'
