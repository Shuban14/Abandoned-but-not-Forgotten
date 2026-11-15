import { getRoverPhotos, isRoverId } from '@/lib/planet-api'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/rover-photos?rover=m20|msl - latest raw images (NASA/JPL). */
export async function GET(request: Request) {
  const rover = new URL(request.url).searchParams.get('rover')
  if (!isRoverId(rover)) return fail(400, 'invalid_rover', 'rover must be m20 or msl.')

  try {
    return ok(await getRoverPhotos(rover), { maxAge: 900 })
  } catch {
    return fail(502, 'upstream_unavailable', 'Rover photos are unavailable right now.')
  }
}
