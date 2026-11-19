// One shared Upstash Redis client for the whole server.
//
// Used by the rate limiter and the public NASA cache so both reuse a single
// client instead of constructing one each. Returns null when the two REST
// variables are absent — callers then fall back to in-memory behaviour.
import { Redis } from '@upstash/redis'

let client: Redis | null | undefined

export function sharedRedis(): Redis | null {
  if (client !== undefined) return client
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? '').trim()
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim()
  client = url && token ? new Redis({ url, token }) : null
  return client
}
