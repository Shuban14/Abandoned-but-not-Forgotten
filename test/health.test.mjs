// Health check: the shared rate-limit store must be probed for real, and every
// dependency scenario must resolve to the documented status.

import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSharedStore, healthStatus } from '../lib/health-core.mjs'

const healthyRedis = { configured: true, ok: true }

test('redis reachable', async () => {
  let calls = 0
  const result = await checkSharedStore(async () => {
    calls += 1
    return 'PONG'
  })

  assert.deepEqual(result, { configured: true, ok: true, detail: 'reachable' })
  assert.equal(calls, 1, 'a real command is issued rather than trusting the config')
})

test('redis credentials missing', async () => {
  const result = await checkSharedStore(null)
  assert.deepEqual(result, { configured: false, ok: false, detail: 'not configured' })
})

test('redis unreachable', async () => {
  const result = await checkSharedStore(async () => {
    throw new Error('ECONNREFUSED https://secret-host.upstash.io')
  })

  assert.deepEqual(result, { configured: true, ok: false, detail: 'unreachable' })
  assert.ok(!JSON.stringify(result).includes('upstash.io'), 'no host or credential leaks')
})

test('redis timeout is bounded', async () => {
  const started = Date.now()
  const result = await checkSharedStore(() => new Promise(() => undefined), { timeoutMs: 40 })
  const elapsed = Date.now() - started

  assert.deepEqual(result, { configured: true, ok: false, detail: 'timed out' })
  assert.ok(elapsed < 1000, 'the probe does not hang the health check')
})

test('all dependencies healthy', () => {
  const verdict = healthStatus({ databaseOk: true, relicOk: true, redis: healthyRedis, hosted: true })
  assert.deepEqual(verdict, { ok: true, status: 'ok' })
})

test('database unavailable fails the check', () => {
  const verdict = healthStatus({ databaseOk: false, relicOk: true, redis: healthyRedis, hosted: true })
  assert.equal(verdict.status, 'degraded')
})

test('hosted deployment without Redis credentials is degraded', () => {
  const verdict = healthStatus({
    databaseOk: true,
    relicOk: true,
    redis: { configured: false, ok: false },
    hosted: true,
  })
  assert.equal(verdict.status, 'degraded')
})

test('hosted deployment with an unreachable Redis is degraded', () => {
  const verdict = healthStatus({
    databaseOk: true,
    relicOk: true,
    redis: { configured: true, ok: false },
    hosted: true,
  })
  assert.equal(verdict.status, 'degraded')
})

test('local development on the memory fallback stays healthy', () => {
  const verdict = healthStatus({
    databaseOk: true,
    relicOk: true,
    redis: { configured: false, ok: false },
    hosted: false,
  })
  assert.deepEqual(verdict, { ok: true, status: 'ok' })
})
