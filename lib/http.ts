// Small helpers shared by the API routes: consistent JSON envelopes,
// cache headers, same-origin checks and the anonymous mission session.
import { randomUUID } from 'node:crypto'
import type { ApiErrorBody, ApiEnvelope } from './types'

export const SESSION_COOKIE = 'sr_sid'
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function ok<T>(data: T, init: { status?: number; maxAge?: number; meta?: Record<string, unknown> } = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': init.maxAge ? `public, max-age=${init.maxAge}` : 'no-store',
  })
  const body: ApiEnvelope<T> = init.meta ? { data, meta: init.meta } : { data }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  const body: ApiErrorBody & Record<string, unknown> = { error: { code, message }, ...extra }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** Rejects cross-origin writes. Reads the Origin the browser sends. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true // same-origin fetches from older clients omit it
  try {
    const target = new URL(request.url)
    const from = new URL(origin)
    return from.host === target.host
  } catch {
    return false
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** Anonymous, temporary mission session: no account required. */
export function getSessionId(request: Request): string | null {
  const value = readCookie(request, SESSION_COOKIE)
  return value && SESSION_RE.test(value) ? value : null
}

export function createSession(): { id: string; cookie: string } {
  const id = randomUUID()
  const cookie = [
    `${SESSION_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=2592000', // 30 days
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
  return { id, cookie }
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false }
  }
}
