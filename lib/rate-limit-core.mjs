// Rate-limiting core: policies, the in-memory store, client-address handling
// and the shared→local fallback. Plain JavaScript so the Next.js server and the
// Node test suite exercise the same code path.
//
// Nothing here talks to Upstash directly: the caller passes a `shared` function
// (`(name, identifier) => Promise<{success, limit, remaining, reset}>`) and the
// core decides what to do when it is absent, slow or broken.

/** Per-endpoint budgets. Writes are far cheaper to abuse than reads. */
export const POLICIES = {
  read: { limit: 120, windowSeconds: 60 },
  missionsRead: { limit: 60, windowSeconds: 60 },
  missionsWrite: { limit: 10, windowSeconds: 60 },
}

/**
 * A bounded fixed-window counter used when no shared store is configured (or
 * when it fails). Per instance only — it slows a single hammering client but
 * cannot enforce a deployment-wide quota.
 *
 * @param {{ maxKeys?: number }} [options]
 */
export function createMemoryStore({ maxKeys = 5000 } = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map()

  return {
    /** @param {keyof POLICIES} name @param {string} identifier @param {number} now */
    limit(name, identifier, now) {
      const policy = POLICIES[name]
      if (!policy) throw new Error(`unknown rate-limit policy: ${name}`)

      if (buckets.size > maxKeys) {
        for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
        if (buckets.size > maxKeys) buckets.clear()
      }

      const key = `${name}:${identifier}`
      const existing = buckets.get(key)
      if (!existing || existing.resetAt <= now) {
        const bucket = { count: 1, resetAt: now + policy.windowSeconds * 1000 }
        buckets.set(key, bucket)
        return { allowed: true, limit: policy.limit, remaining: policy.limit - 1, reset: bucket.resetAt }
      }

      existing.count += 1
      return {
        allowed: existing.count <= policy.limit,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - existing.count),
        reset: existing.resetAt,
      }
    },

    /** Test helper: current number of tracked keys. */
    size() {
      return buckets.size
    },
  }
}

/**
 * Client address as reported by the deployment proxy.
 *
 * Order matters:
 *   1. `x-real-ip` — set by Vercel's edge, not forwarded from the client.
 *   2. `x-vercel-forwarded-for` — Vercel's own forwarded chain.
 *   3. `x-forwarded-for` — the **last** entry, i.e. the hop added by the proxy
 *      that actually accepted the connection. The earlier entries are whatever
 *      the client chose to send and must never be trusted.
 *
 * Locally none of these exist, which yields the constant `local` bucket.
 *
 * @param {{ get(name: string): string | null }} headers
 * @returns {string}
 */
export function clientIpFromHeaders(headers) {
  const real = headers.get('x-real-ip')
  if (real && real.trim()) return real.trim()

  const vercel = headers.get('x-vercel-forwarded-for')
  if (vercel) {
    const parts = vercel.split(',').map((part) => part.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }

  return 'local'
}

/** Response headers describing the remaining budget. */
export function rateLimitHeaders(decision) {
  return {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(Math.max(0, decision.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(decision.reset / 1000)),
  }
}

/** Whole seconds until the current window resets (at least 1). */
export function retryAfterSeconds(decision, now) {
  return Math.max(1, Math.ceil((decision.reset - now) / 1000))
}

/**
 * Builds the limiter used by the API.
 *
 * `shared` is the distributed limiter (Upstash). If it is missing, the limiter
 * runs in `memory` mode; if it throws, it degrades to memory for that request,
 * reports itself as `degraded` until the next success, and never turns a Redis
 * outage into a site outage.
 *
 * @param {{
 *   shared?: ((name: string, identifier: string) => Promise<{ success: boolean, limit: number, remaining: number, reset: number }>) | null,
 *   store?: { limit: (name: string, identifier: string, now: number) => { allowed: boolean, limit: number, remaining: number, reset: number } },
 *   now?: () => number,
 *   onDegraded?: () => void,
 * }} [options]
 */
export function createRateLimiter({ shared = null, store = createMemoryStore(), now = () => Date.now(), onDegraded } = {}) {
  let degraded = false

  return {
    /** `upstash`, `memory`, or `upstash-degraded` while Redis is failing. */
    mode() {
      if (!shared) return 'memory'
      return degraded ? 'upstash-degraded' : 'upstash'
    },

    /** True when limits are not being enforced across instances. */
    degraded() {
      return !shared || degraded
    },

    /**
     * @param {keyof POLICIES} name
     * @param {string} identifier
     */
    async check(name, identifier) {
      if (shared) {
        try {
          const result = await shared(name, identifier)
          degraded = false
          return {
            allowed: result.success === true,
            limit: result.limit,
            remaining: result.remaining,
            reset: result.reset,
          }
        } catch {
          if (!degraded) {
            degraded = true
            onDegraded?.()
          }
        }
      }
      return store.limit(name, identifier, now())
    },
  }
}
