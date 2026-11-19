import { createSession, fail, getSessionId, isSameOrigin, MAX_MISSION_BYTES, ok, readJson } from '@/lib/http'
import { listMissions, saveMission, validateMissionInput } from '@/lib/missions'
import { guardRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Session-scoped data: never cached by a browser, CDN or proxy. */
const PRIVATE = 'private, no-store'

/** GET /api/missions?limit=n - missions saved by this anonymous session. */
export async function GET(request: Request) {
  const gate = await guardRateLimit(request, 'missionsRead')
  if (gate.blocked) return gate.blocked

  const session = getSessionId(request)
  if (!session) return ok([], { meta: { session: 'none' }, cache: PRIVATE, headers: gate.headers })

  const limitParam = new URL(request.url).searchParams.get('limit')
  let limit = 10
  if (limitParam !== null) {
    const parsed = Number(limitParam)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return fail(400, 'invalid_limit', 'limit must be an integer between 1 and 50.', undefined, gate.headers)
    }
    limit = parsed
  }

  try {
    return ok(await listMissions(session, limit), { cache: PRIVATE, headers: gate.headers })
  } catch {
    // No driver message, host, query or stack trace may reach the client.
    return fail(503, 'database_unavailable', 'The mission log is unavailable right now.', undefined, gate.headers)
  }
}

/**
 * POST /api/missions - persist a finished launch. Returns the stored record.
 * Stricter rate limit than the read endpoints, exact same-origin required.
 */
export async function POST(request: Request) {
  const gate = await guardRateLimit(request, 'missionsWrite')
  if (gate.blocked) return gate.blocked

  if (!isSameOrigin(request)) {
    return fail(
      403,
      'forbidden_origin',
      'Mission writes must come from the Space Relics app.',
      undefined,
      gate.headers,
    )
  }

  const parsed = await readJson(request, MAX_MISSION_BYTES)
  if (!parsed.ok) return fail(parsed.status, parsed.code, parsed.message, undefined, gate.headers)

  const result = validateMissionInput(parsed.body)
  if (!result.ok) {
    return fail(
      422,
      'validation_failed',
      'Some mission fields are invalid.',
      { issues: result.errors },
      gate.headers,
    )
  }

  let session = getSessionId(request)
  let cookie: string | null = null
  if (!session) {
    const created = createSession()
    session = created.id
    cookie = created.cookie
  }

  try {
    const record = await saveMission(session, result.value)
    const response = ok(record, { status: 201, cache: PRIVATE, headers: gate.headers })
    if (cookie) response.headers.append('Set-Cookie', cookie)
    return response
  } catch {
    return fail(503, 'database_unavailable', 'The mission could not be saved.', undefined, gate.headers)
  }
}
