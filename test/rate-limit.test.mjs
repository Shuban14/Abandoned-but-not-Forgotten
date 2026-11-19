import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLICIES,
  createMemoryStore,
  clientIpFromHeaders,
  createRateLimiter,
  rateLimitHeaders,
  retryAfterSeconds,
} from '../lib/rate-limit-core.mjs'

function headers(entries) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name) => map.get(name.toLowerCase()) ?? null }
}

test('memory store allows requests below the limit', () => {
  const store = createMemoryStore()
  const now = 1_000_000
  for (let i = 0; i < POLICIES.read.limit; i += 1) {
    const decision = store.limit('read', 'client-a', now)
    assert.equal(decision.allowed, true)
  }
})

test('memory store blocks the request that exceeds the limit', () => {
  const store = createMemoryStore()
  const now = 1_000_000
  for (let i = 0; i < POLICIES.read.limit; i += 1) store.limit('read', 'client-a', now)
  const blocked = store.limit('read', 'client-a', now)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.remaining, 0)
})

test('memory store tracks independent clients separately', () => {
  const store = createMemoryStore()
  const now = 1_000_000
  for (let i = 0; i < POLICIES.read.limit; i += 1) store.limit('read', 'client-a', now)
  const other = store.limit('read', 'client-b', now)
  assert.equal(other.allowed, true)
})

test('memory store resets after the window elapses', () => {
  const store = createMemoryStore()
  const now = 1_000_000
  for (let i = 0; i < POLICIES.read.limit; i += 1) store.limit('read', 'client-a', now)
  const later = now + POLICIES.read.windowSeconds * 1000 + 1
  const decision = store.limit('read', 'client-a', later)
  assert.equal(decision.allowed, true)
})

test('retryAfterSeconds is at least one', () => {
  assert.equal(retryAfterSeconds({ reset: 1_000_000 }, 999_999), 1)
  assert.equal(retryAfterSeconds({ reset: 1_005_000 }, 1_000_000), 5)
})

test('rateLimitHeaders serialises the decision', () => {
  const headers = rateLimitHeaders({ limit: 10, remaining: 3, reset: 1_700_000_000_000 })
  assert.equal(headers['X-RateLimit-Limit'], '10')
  assert.equal(headers['X-RateLimit-Remaining'], '3')
  assert.equal(headers['X-RateLimit-Reset'], '1700000000')
})

test('client IP prefers x-real-ip over forwarded headers', () => {
  const ip = clientIpFromHeaders(headers({
    'x-real-ip': '203.0.113.9',
    'x-forwarded-for': '198.51.100.7, 10.0.0.1',
  }))
  assert.equal(ip, '203.0.113.9')
})

test('client IP uses the last entry of x-forwarded-for, ignoring attacker-controlled first entry', () => {
  const ip = clientIpFromHeaders(headers({
    'x-forwarded-for': '1.2.3.4, 5.6.7.8, 10.0.0.1',
  }))
  assert.equal(ip, '10.0.0.1')
})

test('client IP handles a single forwarded entry', () => {
  const ip = clientIpFromHeaders(headers({ 'x-forwarded-for': '192.0.2.5' }))
  assert.equal(ip, '192.0.2.5')
})

test('client IP prefers the vercel chain over x-forwarded-for', () => {
  const ip = clientIpFromHeaders(headers({
    'x-vercel-forwarded-for': '203.0.113.1, 10.0.0.9',
    'x-forwarded-for': '1.1.1.1',
  }))
  assert.equal(ip, '10.0.0.9')
})

test('client IP falls back to local when no proxy headers exist', () => {
  assert.equal(clientIpFromHeaders(headers({})), 'local')
})

test('limiter reports memory mode when no shared store is configured', () => {
  const limiter = createRateLimiter({ store: createMemoryStore() })
  assert.equal(limiter.mode(), 'memory')
  assert.equal(limiter.degraded(), true)
})

test('limiter reports upstash mode when a shared store is configured', async () => {
  const shared = async () => ({ success: true, limit: 5, remaining: 4, reset: Date.now() + 1000 })
  const limiter = createRateLimiter({ shared, store: createMemoryStore() })
  const decision = await limiter.check('read', 'client')
  assert.equal(decision.allowed, true)
  assert.equal(limiter.mode(), 'upstash')
  assert.equal(limiter.degraded(), false)
})

test('limiter degrades to memory and reports degraded when the shared store throws', async () => {
  const shared = async () => { throw new Error('redis down') }
  let degradedReported = false
  const limiter = createRateLimiter({
    shared,
    store: createMemoryStore(),
    onDegraded: () => { degradedReported = true },
  })
  const decision = await limiter.check('read', 'client')
  assert.equal(decision.allowed, true)
  assert.equal(limiter.mode(), 'upstash-degraded')
  assert.equal(limiter.degraded(), true)
  assert.equal(degradedReported, true)
})

test('limiter uses the shared store decision when it denies', async () => {
  const shared = async () => ({ success: false, limit: 5, remaining: 0, reset: Date.now() + 1000 })
  const limiter = createRateLimiter({ shared, store: createMemoryStore() })
  const decision = await limiter.check('missionsWrite', 'client')
  assert.equal(decision.allowed, false)
})
