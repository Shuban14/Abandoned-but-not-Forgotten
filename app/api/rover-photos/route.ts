import { getRoverPhotos, isRoverId } from '@/lib/planet-api'
import { failPublic, ok, preflight } from '@/lib/http'
import { guardRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CORS preflight for this public read-only endpoint. */
export function OPTIONS() {
  return preflight()
}

/** GET /api/rover-photos?rover=m20|msl - latest raw images (NASA/JPL). */
export async function GET(request: Request) {
  const gate = await guardRateLimit(request, 'read', true)
  if (gate.blocked) return gate.blocked

  const rover = new URL(request.url).searchParams.get('rover')
  if (!isRoverId(rover)) {
    return failPublic(400, 'invalid_rover', 'rover must be m20 or msl.', undefined, gate.headers)
  }

  try {
    return ok(await getRoverPhotos(rover), { maxAge: 900, cors: true, headers: gate.headers })
  } catch {
    return failPublic(502, 'upstream_unavailable', 'Rover photos are unavailable right now.', undefined, gate.headers)
  }
}
