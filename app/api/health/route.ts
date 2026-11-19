import { isDatabaseConfigured, isHostedDeployment, pingDatabase } from '@/lib/db'
import { healthStatus } from '@/lib/health-core.mjs'
import { fail, ok } from '@/lib/http'
import { isRedisConfigured, pingRedis, rateLimitStatus } from '@/lib/rate-limit'
import { relicCounts } from '@/lib/relics'
import type { HealthReport } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Minimal service status: is the app reachable, is storage available, is the
 * public dataset readable, is the shared rate limiter really answering.
 *
 * The rate-limit store is *probed*, not inferred from its configuration: a
 * deployment with the right variables but an unreachable Redis is degraded,
 * not healthy.
 *
 * Deliberately excluded: connection strings, database or filesystem paths,
 * environment values, hostnames, stack traces, and any global mission or user
 * statistic.
 */
export async function GET() {
  const started = Date.now()
  const checks: HealthReport['checks'] = {
    database: { ok: false, detail: 'unavailable' },
    relicData: { ok: false, records: 0 },
    rateLimit: { ok: false, mode: 'memory', detail: 'not checked' },
    redis: { ok: false, configured: false, detail: 'not checked' },
  }

  try {
    await pingDatabase()
    checks.database = { ok: true, detail: 'available' }
  } catch {
    checks.database = { ok: false, detail: isDatabaseConfigured() ? 'unavailable' : 'not configured' }
  }

  try {
    const counts = await relicCounts()
    checks.relicData = { ok: counts.total > 0, records: counts.total }
  } catch {
    checks.relicData = { ok: false, records: 0 }
  }

  // A real command against the shared store, with a bounded timeout and no
  // rate-limit quota consumed.
  checks.redis = isRedisConfigured()
    ? await pingRedis()
    : { configured: false, ok: false, detail: 'not configured' }

  const rl = rateLimitStatus()
  const shared = rl.mode === 'upstash' && checks.redis.ok
  checks.rateLimit = {
    ok: shared,
    mode: rl.mode,
    detail: shared
      ? 'shared (upstash)'
      : rl.mode === 'upstash-degraded' || (checks.redis.configured && !checks.redis.ok)
        ? 'shared store unreachable; per-instance fallback'
        : 'in-memory fallback; not shared between instances',
  }

  const verdict = healthStatus({
    databaseOk: checks.database.ok,
    relicOk: checks.relicData.ok,
    redis: checks.redis,
    hosted: isHostedDeployment(),
  })

  const report: HealthReport = {
    status: verdict.status as HealthReport['status'],
    service: 'space-relics-api',
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
    checks,
  }

  if (verdict.status !== 'ok') {
    return fail(503, 'degraded', 'The backend is reachable but not fully healthy.', { data: report })
  }
  return ok(report)
}
