import { countMissions } from '@/lib/missions'
import { migrationStatus } from '@/lib/db'
import { relicCounts } from '@/lib/relics'
import { fail, ok } from '@/lib/http'
import type { HealthReport } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Simple service status. Never exposes credentials, paths or stack traces. */
export async function GET() {
  const started = Date.now()
  const checks: HealthReport['checks'] = {
    database: { ok: false, detail: 'unavailable' },
    relicData: { ok: false, records: 0 },
  }

  try {
    const status = migrationStatus()
    const missions = countMissions()
    checks.database = {
      ok: true,
      detail: `sqlite · ${status.applied.length} migration${status.applied.length === 1 ? '' : 's'} applied · ${missions} saved mission${missions === 1 ? '' : 's'}`,
    }
  } catch {
    checks.database = { ok: false, detail: 'database unreachable' }
  }

  try {
    const counts = await relicCounts()
    checks.relicData = { ok: counts.total > 0, records: counts.total }
  } catch {
    checks.relicData = { ok: false, records: 0 }
  }

  const report: HealthReport = {
    status: checks.database.ok && checks.relicData.ok ? 'ok' : 'degraded',
    service: 'space-relics-api',
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
    checks,
  }

  if (report.status !== 'ok') {
    return fail(503, 'degraded', 'The backend is reachable but not fully healthy.', { data: report })
  }
  return ok(report)
}
