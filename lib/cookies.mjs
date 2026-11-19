// Cookie parsing for the anonymous mission session.
//
// Deliberately plain JavaScript: the API route (`lib/http.ts`) and the Node
// test suite both use exactly this code, so the parsing that guards session
// ownership is the parsed thing the tests exercise.
//
// A malformed cookie is never an exception. Anything that is not a well-formed
// session id is treated as "no session", which downgrades the request to
// unauthenticated/brand-new rather than failing it.

/** Name of the anonymous session cookie. */
export const SESSION_COOKIE = 'sr_sid'

/** Canonical lowercase UUID. Anything else is not one of our sessions. */
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Browsers cap cookies at ~4 KB; a header far beyond that is not ours. */
const MAX_COOKIE_HEADER = 8192

/** Longest acceptable session value (a canonical UUID is 36 characters). */
const MAX_SESSION_LENGTH = 36

/**
 * Decodes one cookie value, returning null instead of throwing when the
 * percent encoding is malformed (`%`, `%ZZ`, lone surrogates...).
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function safeDecodeCookieValue(raw) {
  if (typeof raw !== 'string') return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/**
 * Reads a single cookie value from a raw `Cookie` header.
 * Returns null for a missing header, a malformed header, a duplicate name that
 * decodes badly, or a value that fails to decode.
 *
 * @param {string | null | undefined} header
 * @param {string} name
 * @returns {string | null}
 */
export function readCookieValue(header, name) {
  if (!header || typeof header !== 'string') return null
  if (header.length > MAX_COOKIE_HEADER) return null
  if (!header.includes(name)) return null

  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    if (trimmed.slice(0, eq).trim() !== name) continue
    const raw = trimmed.slice(eq + 1)
    // A quoted value is legal in the header grammar but never written by us.
    const unquoted = raw.length > 1 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
    return safeDecodeCookieValue(unquoted)
  }
  return null
}

/**
 * True when `value` looks exactly like a session id this app issues.
 * @param {unknown} value
 */
export function isValidSessionId(value) {
  return typeof value === 'string' && value.length === MAX_SESSION_LENGTH && SESSION_RE.test(value)
}

/**
 * The session id carried by a request's `Cookie` header, or null.
 * Invalid, oversized, empty and malformed values all collapse to null.
 *
 * @param {string | null | undefined} header
 * @returns {string | null}
 */
export function sessionFromCookieHeader(header) {
  const value = readCookieValue(header, SESSION_COOKIE)
  return isValidSessionId(value) ? value : null
}
