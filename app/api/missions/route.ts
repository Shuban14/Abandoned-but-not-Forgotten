import { createSession, fail, getSessionId, isSameOrigin, ok, readJson } from '@/lib/http'
import { listMissions, saveMission, validateMissionInput } from '@/lib/missions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/missions?limit=n - missions saved by this anonymous session. */
export async function GET(request: Request) {
  const session = getSessionId(request)
  if (!session) return ok([], { meta: { session: 'none' } })

  const limitParam = new URL(request.url).searchParams.get('limit')
  let limit = 10
  if (limitParam !== null) {
    const parsed = Number(limitParam)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return fail(400, 'invalid_limit', 'limit must be an integer between 1 and 50.')
    }
    limit = parsed
  }

  try {
    return ok(listMissions(session, limit))
  } catch {
    return fail(503, 'database_unavailable', 'The mission log is unavailable right now.')
  }
}

/** POST /api/missions - persist a finished launch. Returns the stored record. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return fail(403, 'forbidden_origin', 'Mission writes must come from the Space Relics app.')
  }

  const parsed = await readJson(request)
  if (!parsed.ok) return fail(400, 'invalid_json', 'The request body must be valid JSON.')

  const result = validateMissionInput(parsed.body)
  if (!result.ok) {
    return fail(422, 'validation_failed', 'Some mission fields are invalid.', { issues: result.errors })
  }

  let session = getSessionId(request)
  let cookie: string | null = null
  if (!session) {
    const created = createSession()
    session = created.id
    cookie = created.cookie
  }

  try {
    const record = saveMission(session, result.value)
    const response = ok(record, { status: 201 })
    if (cookie) response.headers.append('Set-Cookie', cookie)
    return response
  } catch {
    return fail(503, 'database_unavailable', 'The mission could not be saved.')
  }
}
