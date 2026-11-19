import { getRelic } from '@/lib/relics'
import { failPublic, ok, preflight } from '@/lib/http'
import { guardRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CORS preflight for this public read-only endpoint. */
export function OPTIONS() {
  return preflight()
}

/** GET /api/relics/:id */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guardRateLimit(request, 'read', true)
  if (gate.blocked) return gate.blocked

  const { id } = await params
  if (!id || id.length > 120) {
    return failPublic(400, 'invalid_id', 'A relic id is required.', undefined, gate.headers)
  }

  try {
    const relic = await getRelic(id)
    if (!relic) {
      // Echoing the requested id back is not an XSS vector here (JSON only) but
      // a fixed message keeps responses uniform.
      return failPublic(404, 'not_found', 'No relic matches that id.', undefined, gate.headers)
    }
    return ok(relic, { maxAge: 60, cors: true, headers: gate.headers })
  } catch {
    return failPublic(500, 'relic_data_unavailable', 'The relic dataset could not be read.', undefined, gate.headers)
  }
}
