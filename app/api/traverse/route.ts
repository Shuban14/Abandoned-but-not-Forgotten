import { getTraverse, isRoverId } from '@/lib/planet-api'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/traverse?rover=m20|msl - rover drive path (NASA/JPL MMGIS). */
export async function GET(request: Request) {
  const rover = new URL(request.url).searchParams.get('rover')
  if (!isRoverId(rover)) return fail(400, 'invalid_rover', 'rover must be m20 or msl.')

  try {
    return ok(await getTraverse(rover), { maxAge: 3600 })
  } catch {
    return fail(502, 'upstream_unavailable', 'Rover drive paths are unavailable right now.')
  }
}
