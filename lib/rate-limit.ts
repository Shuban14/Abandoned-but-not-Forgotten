// Shared, server-side rate limiting for the public API.
//
// Two backends, chosen at runtime:
//   • Upstash Redis (when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
//     set) — an atomic sliding window shared by every function instance. This is
//     the only mode that truly protects the deployment as a whole.
//   • A bounded in-memory fixed window as a production-safe fallback when Redis
//     is not configured or is failing, so a single instance still cannot be
//     hammered and the API degrades rather than failing open completely.
//
// The fallback is *not* equivalent to shared limiting, and the process says so:
// `/api/health` reports `checks.rateLimit` and this module logs one sanitised
// warning when it degrades (never a token, IP or header value).
//
// Identifiers are SHA-256 hashed before they leave the process, so no raw IP is
// stored in Redis.
import { createHash } from 'node:crypto'
import { Ratelimit } from '@upstash/ratelimit'
import { fail, PUBLIC_CORS_HEADERS } from './http'
import { checkSharedStore } from './health-core.mjs'
import { clientIpFromHeaders, createRateLimiter, rateLimitHeaders, retryAfterSeconds } from './rate-limit-core.mjs'
import { sharedRedis } from './redis'

export type PolicyName = 'read' | 'missionsRead' | 'missionsWrite'

const redis = sharedRedis()

const limiters = new Map<PolicyName, Ratelimit>()

/**
 * One `Ratelimit` per policy. Each call is a single atomic Upstash command
 * (sliding window), so separate instances cannot race past the limit with
 * independent reads and writes.
 */
async function sharedLimit(name: string, identifier: string) {
  const policyName = name as PolicyName
  let limiter = limiters.get(policyName)
  if (!limiter) {
    const policy = await import('./rate-limit-core.mjs').then((core) => core.POLICIES[policyName])
    limiter = new Ratelimit({
      redis: redis!,
      prefix: `space-relics:${name}`,
      limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
      analytics: false,
    })
    limiters.set(policyName, limiter)
  }
  const result = await limiter.limit(identifier)
  return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset }
}

const limiter = createRateLimiter({
  shared: redis ? sharedLimit : null,
  onDegraded: () => {
    console.warn('[rate-limit] shared limiter unavailable; serving from the per-instance fallback (degraded)')
  },
})

/**
 * Rate-limit status for diagnostics.
 * `mode: 'upstash'` is the only value that means deployment-wide enforcement.
 */
export function rateLimitStatus(): { mode: 'upstash' | 'memory' | 'upstash-degraded'; degraded: boolean } {
  return { mode: limiter.mode(), degraded: limiter.degraded() }
}

/** True when the shared store has both of its REST variables. */
export function isRedisConfigured(): boolean {
  return redis !== null
}

/**
 * Probes the shared store with a real `PING`.
 *
 * The health endpoint must not claim Redis is healthy just because its
 * environment variables exist, and it must not spend rate-limit quota or hang
 * on an unreachable host: `checkSharedStore` bounds the probe and reports
 * `not configured`, `unreachable` or `timed out` without leaking anything.
 */
export function pingRedis(timeoutMs = 1500) {
  const client = redis
  return checkSharedStore(client ? () => client.ping() : null, { timeoutMs })
}

/**
 * Client address as seen by the platform.
 *
 * `x-real-ip` (set by the edge) wins, then Vercel's forwarded chain, then the
 * **last** `x-forwarded-for` entry — the hop the proxy added. The first entry is
 * attacker-controlled and is never used. See `lib/rate-limit-core.mjs`.
 */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers)
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export type RateLimitGate = { blocked: Response | null; headers: Record<string, string> }

/**
 * Applies the named policy to the caller.
 *
 * Returns a ready 429 response when the limit is exceeded, plus the headers a
 * successful response should echo. Nothing is required from the caller beyond
 * the route handler.
 */
export async function guardRateLimit(
  request: Request,
  name: PolicyName,
  /** Public read endpoints must still expose their CORS policy on a 429. */
  cors = false,
): Promise<RateLimitGate> {
  const decision = await limiter.check(name, hashIdentifier(clientIp(request)))
  const headers = rateLimitHeaders(decision)
  if (decision.allowed) return { blocked: null, headers }

  const blocked = fail(
    429,
    'rate_limited',
    'Too many requests. Please try again shortly.',
    undefined,
    {
      ...(cors ? PUBLIC_CORS_HEADERS : {}),
      ...headers,
      'Retry-After': String(retryAfterSeconds(decision, Date.now())),
      'Cache-Control': 'no-store',
    },
  )
  return { blocked, headers }
}
