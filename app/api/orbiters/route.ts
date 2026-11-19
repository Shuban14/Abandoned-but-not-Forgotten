import { getOrbiters, isPlanetBody } from '@/lib/planet-api'
import { failPublic, ok, preflight } from '@/lib/http'
import { guardRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CORS preflight for this public read-only endpoint. */
export function OPTIONS() {
  return preflight()
}

/** GET /api/orbiters?body=moon|mars - live sub-satellite tracks (NASA JPL Horizons). */
export async function GET(request: Request) {
  const gate = await guardRateLimit(request, 'read', true)
  if (gate.blocked) return gate.blocked

  const body = new URL(request.url).searchParams.get('body')
  if (!isPlanetBody(body)) {
    return failPublic(400, 'invalid_body', 'body must be moon or mars.', undefined, gate.headers)
  }

  try {
    return ok(await getOrbiters(body), { maxAge: 300, cors: true, headers: gate.headers })
  } catch {
    return failPublic(502, 'upstream_unavailable', 'Live orbiter positions are unavailable right now.', undefined, gate.headers)
  }
}
