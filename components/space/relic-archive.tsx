'use client'

import { AlertTriangle, ArrowUpRight, Loader2, MapPin, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api, errorMessage } from '@/lib/api-client'
import MissionFilm from './mission-film'
import {
  CATEGORIES,
  PLANET_LABELS,
  type ExplorerMode,
  type MissionRecord,
  type PlanetId,
  type Relic,
  type RelicCategory,
} from '@/lib/types'

const PLANETS: { id: PlanetId; label: string; accent: string }[] = [
  { id: 'moon', label: 'Moon', accent: '#C6D0E0' },
  { id: 'mars', label: 'Mars', accent: '#E99570' },
]

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]))
const TARGET_LABEL: Record<string, string> = { leo: 'Low Earth orbit', moon: 'Lunar transfer', mars: 'Mars transfer' }

function fmtCoord(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`
}

function fmtPrecise(value: number) {
  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

function wikiUrl(title: string) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

type RelicState = { status: 'loading' | 'ready' | 'error'; items: Relic[]; message?: string }
type LogState = { status: 'loading' | 'ready' | 'error'; items: MissionRecord[]; message?: string }
type HealthState = 'checking' | 'ok' | 'degraded' | 'offline'

export default function RelicArchive() {
  const [planet, setPlanet] = useState<PlanetId>('moon')
  const [category, setCategory] = useState<RelicCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ExplorerMode>('junior')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filmToken, setFilmToken] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [relics, setRelics] = useState<RelicState>({ status: 'loading', items: [] })
  const [log, setLog] = useState<LogState>({ status: 'loading', items: [] })
  const [health, setHealth] = useState<HealthState>('checking')

  // Relic list: planet + category are filtered by the backend.
  useEffect(() => {
    const controller = new AbortController()
    setRelics((prev) => ({ status: 'loading', items: prev.items }))
    api
      .relics({ planet, category }, controller.signal)
      .then(({ items }) => {
        setRelics({ status: 'ready', items })
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.cancelled) return
        setRelics({ status: 'error', items: [], message: errorMessage(error) })
      })
    return () => controller.abort()
  }, [planet, category, reloadToken])

  // Saved missions for this anonymous session.
  const loadLog = useCallback((signal?: AbortSignal) => {
    setLog((prev) => ({ status: 'loading', items: prev.items }))
    api
      .missions(8, signal)
      .then((items) => setLog({ status: 'ready', items }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.cancelled) return
        setLog({ status: 'error', items: [], message: errorMessage(error) })
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadLog(controller.signal)
    return () => controller.abort()
  }, [loadLog])

  // Backend reachability, kept subtle.
  useEffect(() => {
    const controller = new AbortController()
    api
      .health(controller.signal)
      .then((report) => setHealth(report.status === 'ok' ? 'ok' : 'degraded'))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.cancelled) return
        setHealth('offline')
      })
    return () => controller.abort()
  }, [])

  // Selecting a record starts its mission film; clicking again replays it.
  const startFilm = useCallback((id: string) => {
    setSelectedId(id)
    setFilmToken((value) => value + 1)
    // Stacked layout: the player lives in the detail panel below the list.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      window.setTimeout(() => {
        document.getElementById('relic-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 60)
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return relics.items
    return relics.items.filter(
      (relic) =>
        relic.name.toLowerCase().includes(q) ||
        relic.agency.toLowerCase().includes(q) ||
        relic.kind.toLowerCase().includes(q),
    )
  }, [relics.items, query])

  const selected = useMemo(
    () => visible.find((relic) => relic.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  )

  const healthLabel =
    health === 'ok'
      ? 'Backend connected'
      : health === 'degraded'
        ? 'Backend degraded'
        : health === 'offline'
          ? 'Backend unreachable'
          : 'Checking backend'

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-8 sm:pt-32">
      <header className="max-w-2xl">
        <p className="font-hand text-2xl uppercase tracking-[0.18em] text-ivory">The relic archive</p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-[0.08em] text-starlight sm:text-4xl">
          FORGOTTEN HARDWARE
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-moon/85">
          Landers, rovers and probes still sitting where they fell silent. Every record below is served
          from the same mission dataset that drives the 3D explorers — coordinates and dates are the
          published NASA and USGS values, not embellishments.
        </p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-orbit/25 bg-white/[0.03] px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.22em] text-moon">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${
              health === 'ok' ? 'bg-[#3ddc84]' : health === 'offline' ? 'bg-[#E99570]' : 'bg-gold'
            }`}
          />
          {healthLabel}
        </p>
      </header>

      {/* ---------- filters ---------- */}
      <div className="mt-9 flex flex-col gap-4">
        <div role="tablist" aria-label="Planet" className="flex w-full max-w-xs gap-1 rounded-full bg-white/[0.04] p-1">
          {PLANETS.map((option) => {
            const active = planet === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setPlanet(option.id)
                  setSelectedId(null)
                }}
                className={`flex-1 rounded-full py-1.5 font-display text-[11px] font-medium uppercase tracking-[0.28em] transition-colors duration-300 ${
                  active ? 'text-void' : 'text-moon hover:text-starlight'
                }`}
                style={active ? { background: option.accent } : undefined}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCategory('all')}
            aria-pressed={category === 'all'}
            className={`rounded-full border px-3.5 py-1.5 font-display text-[10px] uppercase tracking-[0.2em] transition-colors ${
              category === 'all'
                ? 'border-electric/60 bg-electric/15 text-starlight'
                : 'border-orbit/25 text-moon hover:border-orbit/50 hover:text-starlight'
            }`}
          >
            All
          </button>
          {CATEGORIES.map((entry) => {
            const active = category === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setCategory(entry.id)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 font-display text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  active
                    ? 'border-electric/60 bg-electric/15 text-starlight'
                    : 'border-orbit/25 text-moon hover:border-orbit/50 hover:text-starlight'
                }`}
              >
                {entry.label}
              </button>
            )
          })}
        </div>

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-moon/60" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, agency or type…"
            aria-label="Search relics"
            className="w-full rounded-full border border-orbit/25 bg-white/[0.04] py-2.5 pl-11 pr-4 text-sm text-starlight placeholder:text-moon/50 focus:border-electric/60 focus:outline-none"
          />
        </div>
      </div>

      {/* ---------- results ---------- */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <div>
          <p className="mb-3 font-display text-[10px] uppercase tracking-[0.22em] text-moon/70">
            {relics.status === 'ready'
              ? `${visible.length} ${visible.length === 1 ? 'record' : 'records'} · ${PLANET_LABELS[planet]}`
              : `${PLANET_LABELS[planet]}`}
          </p>

          {relics.status === 'loading' && (
            <div className="grid gap-3 sm:grid-cols-2" aria-busy>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="glass h-[86px] animate-pulse rounded-2xl opacity-60" />
              ))}
            </div>
          )}

          {relics.status === 'error' && (
            <div className="glass rounded-2xl p-5">
              <p className="flex items-center gap-2 font-display text-[10px] uppercase tracking-[0.22em] text-gold">
                <AlertTriangle className="size-4" aria-hidden />
                Archive unavailable
              </p>
              <p className="mt-2 text-sm leading-relaxed text-moon/85">{relics.message}</p>
              <p className="mt-1 text-xs leading-relaxed text-moon/60">
                This is a connection problem, not an empty dataset.
              </p>
              <button
                type="button"
                onClick={() => setReloadToken((n) => n + 1)}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-electric/40 bg-electric/10 px-4 py-2 font-display text-[10px] uppercase tracking-[0.2em] text-starlight transition-colors hover:border-electric/80 hover:bg-electric/20"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Retry
              </button>
            </div>
          )}

          {relics.status === 'ready' && visible.length === 0 && (
            <div className="glass rounded-2xl p-5">
              <p className="font-display text-[10px] uppercase tracking-[0.22em] text-moon">No records found</p>
              <p className="mt-2 text-sm leading-relaxed text-moon/80">
                {query.trim()
                  ? `Nothing on ${PLANET_LABELS[planet]} matches “${query.trim()}”.`
                  : `The dataset currently lists no ${CATEGORY_LABEL.get(category as RelicCategory)?.toLowerCase() ?? 'relics'} on ${PLANET_LABELS[planet]}.`}
              </p>
              {query.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-4 font-display text-[10px] uppercase tracking-[0.2em] text-electric underline-offset-4 hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          )}

          {relics.status !== 'error' && visible.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visible.map((relic) => {
                const active = selected?.id === relic.id
                return (
                  <li key={relic.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setSelectedId(relic.id)}
                      aria-pressed={active}
                      className={`group flex w-full flex-col gap-1 rounded-2xl border p-4 text-left transition-colors duration-300 ${
                        active
                          ? 'border-electric/60 bg-electric/10'
                          : 'border-orbit/20 bg-white/[0.02] hover:border-orbit/45 hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="flex w-full items-start justify-between gap-2">
                        <span className="font-display text-sm font-medium tracking-wide text-starlight">
                          {relic.name}
                        </span>
                        <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-moon/70">
                          {relic.year}
                        </span>
                      </span>
                      <span className="text-xs text-moon/75">
                        {relic.agency} · {relic.kind}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] text-moon/55">
                        <MapPin className="size-3" aria-hidden />
                        {fmtCoord(relic.latitude, 'N', 'S')} · {fmtCoord(relic.longitude, 'E', 'W')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => startFilm(relic.id)}
                      aria-label={`Play the 3D mission film for ${relic.name}`}
                      className="absolute bottom-3 right-3 rounded-full border border-orbit/40 bg-void/70 px-2.5 py-1 font-display text-[9px] uppercase tracking-[0.16em] text-moon transition-colors hover:border-electric/70 hover:text-starlight"
                    >
                      Film
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ---------- detail ---------- */}
        <aside id="relic-detail" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
          {selected ? (
            <div className="glass rounded-3xl p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[10px] uppercase tracking-[0.22em] text-electric">
                    {PLANET_LABELS[selected.planet]} · {CATEGORY_LABEL.get(selected.category)}
                  </p>
                  <h2 className="mt-1.5 font-display text-xl font-medium tracking-wide text-starlight">
                    {selected.name}
                  </h2>
                </div>
                <span className="shrink-0 rounded-full border border-orbit/30 px-2.5 py-1 font-display text-[10px] uppercase tracking-[0.16em] text-moon">
                  {selected.year}
                </span>
              </div>

              <MissionFilm relic={selected} autoPlayToken={filmToken} />

              <div role="group" aria-label="Explorer mode" className="mt-5 flex rounded-full bg-white/[0.04] p-1">
                {(['junior', 'analyst'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    aria-pressed={mode === option}
                    className={`flex-1 rounded-full py-1.5 font-display text-[10px] font-medium uppercase tracking-[0.2em] transition-colors ${
                      mode === option ? 'bg-starlight text-void' : 'text-moon hover:text-starlight'
                    }`}
                  >
                    {option === 'junior' ? 'Junior explorer' : 'Mission analyst'}
                  </button>
                ))}
              </div>

              {mode === 'junior' ? (
                <JuniorView relic={selected} />
              ) : (
                <AnalystView relic={selected} />
              )}

              <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-orbit/20 pt-4">
                <Link
                  href={`/${selected.planet}`}
                  className="inline-flex items-center gap-2 font-display text-[10px] uppercase tracking-[0.2em] text-electric transition-opacity hover:opacity-80"
                >
                  Open in 3D
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
                <a
                  href={wikiUrl(selected.wikiTitle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-display text-[10px] uppercase tracking-[0.2em] text-moon transition-colors hover:text-starlight"
                >
                  Source reference
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </div>
            </div>
          ) : (
            <div className="glass rounded-3xl p-6 text-sm leading-relaxed text-moon/70">
              Select a record to read its file.
            </div>
          )}
        </aside>
      </div>

      {/* ---------- mission log ---------- */}
      <section className="mt-20" aria-labelledby="mission-log-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-hand text-2xl uppercase tracking-[0.18em] text-ivory">Your launches</p>
            <h2
              id="mission-log-heading"
              className="mt-2 font-display text-2xl font-medium tracking-[0.08em] text-starlight"
            >
              MISSION LOG
            </h2>
          </div>
          <button
            type="button"
            onClick={() => loadLog()}
            className="inline-flex items-center gap-2 rounded-full border border-orbit/30 px-4 py-2 font-display text-[10px] uppercase tracking-[0.2em] text-moon transition-colors hover:border-electric/60 hover:text-starlight"
          >
            <RefreshCw className={`size-3.5 ${log.status === 'loading' ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>

        <p className="mt-3 max-w-xl text-sm leading-relaxed text-moon/75">
          Every flight you finish in the Launch Lab is written to the server database and listed here.
          Records are tied to this browser&apos;s anonymous session, so nothing needs an account.
        </p>

        <div className="mt-5">
          {log.status === 'loading' && log.items.length === 0 && (
            <div className="glass flex items-center gap-3 rounded-2xl p-4 text-sm text-moon">
              <Loader2 className="size-4 animate-spin text-electric" aria-hidden />
              Loading your mission log…
            </div>
          )}

          {log.status === 'error' && (
            <div className="glass rounded-2xl p-4">
              <p className="text-sm text-moon/85">{log.message}</p>
              <button
                type="button"
                onClick={() => loadLog()}
                className="mt-3 font-display text-[10px] uppercase tracking-[0.2em] text-electric underline-offset-4 hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {log.status === 'ready' && log.items.length === 0 && (
            <div className="glass rounded-2xl p-5">
              <p className="text-sm text-moon/80">
                No missions logged yet. Build a rocket, pick a launch site and fly it — the result lands
                here automatically.
              </p>
              <Link
                href="/game"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-starlight px-5 py-2.5 font-display text-[10px] font-medium uppercase tracking-[0.22em] text-void transition-colors hover:bg-white"
              >
                Open Launch Lab
              </Link>
            </div>
          )}

          {log.items.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {log.items.map((mission) => (
                <li key={mission.id} className="rounded-2xl border border-orbit/20 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[10px] uppercase tracking-[0.2em] text-electric">
                      {TARGET_LABEL[mission.target] ?? mission.target}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.16em] ${
                        mission.success
                          ? 'bg-[#3ddc84]/15 text-[#3ddc84]'
                          : 'bg-[#E99570]/15 text-[#E99570]'
                      }`}
                    >
                      {mission.success ? 'Success' : mission.partial ? 'Partial' : 'Failed'}
                    </span>
                  </div>
                  <p className="mt-2 font-display text-sm text-starlight">{mission.siteName}</p>
                  <p className="mt-1 text-xs text-moon/70">
                    {(mission.speedBudgetMps / 1000).toFixed(2)} / {(mission.requiredSpeedMps / 1000).toFixed(1)} km/s ·{' '}
                    {mission.stages} {mission.stages === 1 ? 'stage' : 'stages'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-moon/45">
                    {new Date(mission.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function JuniorView({ relic }: { relic: Relic }) {
  const kind = relic.kind.replace(/\s*\([^)]*\)/g, '').toLowerCase()
  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm leading-relaxed text-moon/90">
        A {kind} on {PLANET_LABELS[relic.planet]}, left there by {relic.agency} in {relic.year}.
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-display text-[9px] uppercase tracking-[0.2em] text-moon/55">Who</dt>
          <dd className="mt-1 text-moon/90">{relic.agency}</dd>
        </div>
        <div>
          <dt className="font-display text-[9px] uppercase tracking-[0.2em] text-moon/55">When</dt>
          <dd className="mt-1 text-moon/90">{relic.year}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-display text-[9px] uppercase tracking-[0.2em] text-moon/55">Where</dt>
          <dd className="mt-1 font-mono text-xs text-moon/90">
            {fmtCoord(relic.latitude, 'N', 'S')} · {fmtCoord(relic.longitude, 'E', 'W')}
            {relic.approximate && <span className="ml-2 text-moon/50">(approximate)</span>}
          </dd>
        </div>
      </dl>
      <p className="rounded-xl border border-orbit/20 bg-white/[0.03] p-3 text-xs leading-relaxed text-moon/70">
        Turn on Mission analyst for the exact coordinates, dataset record and source credit.
      </p>
    </div>
  )
}

function AnalystView({ relic }: { relic: Relic }) {
  const rows: { term: string; value: string }[] = [
    { term: 'Record ID', value: relic.id },
    { term: 'Agency', value: relic.agency },
    { term: 'Landing year', value: String(relic.year) },
    { term: 'Class as recorded', value: relic.kind },
    { term: 'Latitude', value: fmtPrecise(relic.latitude) },
    { term: 'Longitude', value: fmtPrecise(relic.longitude) },
    { term: 'Coordinate accuracy', value: relic.approximate ? 'Rounded / approximate' : 'As published' },
    { term: 'Dataset', value: relic.source.dataset },
    { term: 'Record', value: relic.source.record },
  ]
  return (
    <div className="mt-5">
      <dl className="divide-y divide-orbit/15 text-sm">
        {rows.map((row) => (
          <div key={row.term} className="flex items-start justify-between gap-4 py-2">
            <dt className="font-display text-[9px] uppercase tracking-[0.2em] text-moon/55">{row.term}</dt>
            <dd className="max-w-[58%] text-right font-mono text-[11px] leading-relaxed text-moon/90">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[11px] leading-relaxed text-moon/55">{relic.source.credit}</p>
    </div>
  )
}
