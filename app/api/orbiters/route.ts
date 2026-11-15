import { getOrbiters, isPlanetBody } from '@/lib/planet-api'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/orbiters?body=moon|mars - live sub-satellite tracks (NASA JPL Horizons). */
export async function GET(request: Request) {
  const body = new URL(request.url).searchParams.get('body')
  if (!isPlanetBody(body)) return fail(400, 'invalid_body', 'body must be moon or mars.')

  try {
    return ok(await getOrbiters(body), { maxAge: 300 })
  } catch {
    return fail(502, 'upstream_unavailable', 'Live orbiter positions are unavailable right now.')
  }
}
