// Small helpers shared by the API routes: consistent JSON envelopes, caching,
// CORS policy, body limits, exact-origin checks and the anonymous session.
//
// Policy summary
//   • Public scientific reads (relics, orbiters, rover photos, traverse) are
//     open: no account, no consumer API key, and a wildcard read-only CORS
//     header so third parties may fetch them from a browser.
//   • Mission data is session-scoped and never public: no CORS header, always
//     `private, no-store`.
//   • Mission writes require an exact same-origin Origin.
import { randomUUID } from 'node:crypto'
import { SESSION_COOKIE, sessionFromCookieHeader } from './cookies.mjs'
import type { ApiErrorBody, ApiEnvelope } from './types'

export { SESSION_COOKIE }

/** Hard cap for JSON request bodies (a mission payload is ~300 bytes). */
export const MAX_MISSION_BYTES = 8 * 1024

/** Read-only CORS policy for the public data endpoints. */
export const PUBLIC_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
}

export type OkInit = {
  status?: number
  /** Browser cache lifetime in seconds. Public reads also get a longer CDN TTL. */
  maxAge?: number
  meta?: Record<string, unknown>
  /** Emit the wildcard read-only CORS headers (public GET endpoints only). */
  cors?: boolean
  /** Explicit Cache-Control value, e.g. `private, no-store`. */
  cache?: string
  headers?: Record<string, string>
}

function cacheControl(init: OkInit): string {
  if (init.cache) return init.cache
  if (!init.maxAge) return 'no-store'
  // `max-age` for the browser, a longer `s-maxage` for the CDN, and a
  // stale-while-revalidate window so a NASA hiccup does not reach the user.
  return `public, max-age=${init.maxAge}, s-maxage=${init.maxAge * 5}, stale-while-revalidate=86400`
}

export function ok<T>(data: T, init: OkInit = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl(init),
    'X-Content-Type-Options': 'nosniff',
  })
  if (init.cors) for (const [key, value] of Object.entries(PUBLIC_CORS_HEADERS)) headers.set(key, value)
  if (init.headers) for (const [key, value] of Object.entries(init.headers)) headers.set(key, value)

  const body: ApiEnvelope<T> = init.meta ? { data, meta: init.meta } : { data }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

export function fail(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const body: ApiErrorBody & Record<string, unknown> = { error: { code, message }, ...extra }
  const responseHeaders = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (headers) for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value)
  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

/**
 * Error reply for a public read-only endpoint. Carries the same CORS policy as
 * a success, so a third-party browser can read the status and message instead
 * of seeing an opaque network error.
 */
export function failPublic(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return fail(status, code, message, extra, { ...PUBLIC_CORS_HEADERS, ...headers })
}

/** 204 reply for CORS preflight on the public read-only endpoints. */
export function preflight() {
  return new Response(null, {
    status: 204,
    headers: { ...PUBLIC_CORS_HEADERS, 'Cache-Control': 'public, max-age=86400' },
  })
}

/**
 * The canonical origin of this deployment.
 *
 * `APP_ORIGIN` (server-only, e.g. `https://space-relics.vercel.app`) is the
 * trusted configuration. It is optional: preview deployments change host per
 * build, so the request origin is also accepted as an exact match — but only as
 * an exact protocol + host + port equality check against the browser's Origin
 * header, never a substring or bare-host comparison.
 */
export function appOrigin(request: Request): string {
  const configured = (process.env.APP_ORIGIN ?? '').trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    } catch {
      // Misconfigured value: fall through to the request origin.
    }
  }
  return new URL(request.url).origin
}

function requestOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin
  } catch {
    return null
  }
}

/**
 * Exact same-origin check for state-changing requests (mission writes).
 *
 * A browser always sends `Origin` on a cross-origin POST; if it is absent we
 * only accept an explicit `Sec-Fetch-Site: same-origin` signal, which a
 * third-party page cannot forge. Host-only or scheme-less comparisons are gone.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const allowed = new Set<string>([appOrigin(request)])
  const own = requestOrigin(request)
  if (own) allowed.add(own)

  if (!origin) {
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite !== 'same-origin') return false
    // Cross-check that the browser is really talking to us.
    const referer = request.headers.get('referer')
    if (!referer) return true
    try {
      return allowed.has(new URL(referer).origin)
    } catch {
      return false
    }
  }

  try {
    return allowed.has(new URL(origin).origin)
  } catch {
    return false
  }
}

/**
 * Anonymous, temporary mission session: no account required.
 *
 * A malformed or oversized cookie is treated as "no session" rather than
 * throwing: `decodeURIComponent` used to be able to crash an API request with
 * a single hand-written `Cookie` header. Validation (UUID shape + length) lives
 * in `lib/cookies.mjs`, which the tests exercise directly.
 */
export function getSessionId(request: Request): string | null {
  return sessionFromCookieHeader(request.headers.get('cookie'))
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

export type JsonReadResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; code: string; message: string }

/**
 * Parses a JSON body after enforcing a byte limit and the content type.
 * Nothing about the failure (no stack trace, no parser internals) reaches the
 * client.
 */
export async function readJson(request: Request, maxBytes = MAX_MISSION_BYTES): Promise<JsonReadResult> {
  const declaredType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (declaredType !== 'application/json') {
    return {
      ok: false,
      status: 415,
      code: 'unsupported_media_type',
      message: 'Content-Type must be application/json.',
    }
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, code: 'payload_too_large', message: 'The request body is too large.' }
  }

  if (!request.body) {
    return { ok: false, status: 400, code: 'invalid_json', message: 'A JSON body is required.' }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, status: 413, code: 'payload_too_large', message: 'The request body is too large.' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'The request body could not be read.' }
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'The request body must be valid JSON.' }
  }
}
