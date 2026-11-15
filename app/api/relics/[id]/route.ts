import { getRelic } from '@/lib/relics'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/relics/:id */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id || id.length > 120) return fail(400, 'invalid_id', 'A relic id is required.')

  try {
    const relic = await getRelic(id)
    if (!relic) return fail(404, 'not_found', `No relic with the id "${id}".`)
    return ok(relic, { maxAge: 60 })
  } catch {
    return fail(500, 'relic_data_unavailable', 'The relic dataset could not be read.')
  }
}
