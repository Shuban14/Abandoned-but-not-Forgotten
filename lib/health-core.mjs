// Health decisions for `/api/health`.
//
// Plain JavaScript so the route handler and the test suite share one
// implementation, and so every dependency scenario can be tested without a
// network, a database or Upstash credentials.

const TIMED_OUT = Symbol('timed-out')

/**
 * Probes the shared rate-limit store with a lightweight command.
 *
 * `ping` is injected (the route passes `() => redis.ping()`) so tests can
 * simulate a healthy store, a broken one, or one that never answers. The probe
 * is bounded by `timeoutMs`; nothing here reads, writes or consumes a
 * rate-limit key, and no credential or endpoint ever reaches the result.
 *
 * @param {(() => Promise<unknown>) | null | undefined} ping
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ configured: boolean, ok: boolean, detail: string }>}
 */
export async function checkSharedStore(ping, { timeoutMs = 1500 } = {}) {
  if (typeof ping !== 'function') {
    return { configured: false, ok: false, detail: 'not configured' }
  }

  let timer = null
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
    })
    const result = await Promise.race([Promise.resolve().then(ping), timeout])
    if (result === TIMED_OUT) return { configured: true, ok: false, detail: 'timed out' }
    return { configured: true, ok: true, detail: 'reachable' }
  } catch {
    return { configured: true, ok: false, detail: 'unreachable' }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * Overall service verdict.
 *
 * Locally, in-memory rate limiting is the documented default and does not by
 * itself fail the check. In a hosted deployment the shared store is a required
 * dependency: missing credentials, an unreachable store and a timeout are all
 * degraded.
 *
 * @param {{
 *   databaseOk: boolean,
 *   relicOk: boolean,
 *   redis: { configured: boolean, ok: boolean },
 *   hosted: boolean,
 * }} state
 */
export function healthStatus({ databaseOk, relicOk, redis, hosted }) {
  const sharedHealthy = Boolean(redis?.configured && redis?.ok)
  const ok = Boolean(databaseOk && relicOk && (!hosted || sharedHealthy))
  return { ok, status: ok ? 'ok' : 'degraded' }
}
