import { isPlanetId, listRelics, relicCounts } from '@/lib/relics'
import { isCategory } from '@/lib/types'
import { failPublic, ok, preflight } from '@/lib/http'
import { guardRateLimit } from '@/lib/rate-limit'
import type { RelicCategory, RelicListMeta } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CORS preflight for this public read-only endpoint. */
export function OPTIONS() {
  return preflight()
}

/**
 * GET /api/relics
 *   ?planet=moon | mars | all   (default: all)
 *   ?category=crewed | rover | sample-return | lander
 *   ?q=search text
 *   ?limit=n
 *
 * Public data: no account, no API key, wildcard read-only CORS.
 */
export async function GET(request: Request) {
  const gate = await guardRateLimit(request, 'read', true)
  if (gate.blocked) return gate.blocked

  const params = new URL(request.url).searchParams

  const planetParam = params.get('planet') ?? 'all'
  if (planetParam !== 'all' && !isPlanetId(planetParam)) {
    return failPublic(400, 'invalid_planet', "planet must be 'moon', 'mars' or 'all'.", undefined, gate.headers)
  }

  const categoryParam = params.get('category')
  if (categoryParam && !isCategory(categoryParam)) {
    return failPublic(400, 'invalid_category', 'category is not recognised.', undefined, gate.headers)
  }

  const q = params.get('q') ?? undefined
  if (q && q.length > 80) {
    return failPublic(400, 'invalid_query', 'q must be 80 characters or fewer.', undefined, gate.headers)
  }

  const limitParam = params.get('limit')
  let limit: number | undefined
  if (limitParam !== null) {
    const parsed = Number(limitParam)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      return failPublic(400, 'invalid_limit', 'limit must be an integer between 1 and 200.', undefined, gate.headers)
    }
    limit = parsed
  }

  try {
    const [items, counts] = await Promise.all([
      listRelics({
        planet: planetParam === 'all' ? 'all' : planetParam,
        category: (categoryParam as RelicCategory | null) ?? undefined,
        q,
        limit,
      }),
      relicCounts(),
    ])

    const meta: RelicListMeta = {
      planet: planetParam === 'all' ? 'all' : planetParam,
      category: (categoryParam as RelicCategory | null) ?? 'all',
      total: items.length,
      counts: { moon: counts.moon, mars: counts.mars },
    }

    // Relic data only changes when the dataset is redeployed.
    return ok(items, { maxAge: 60, cors: true, meta, headers: gate.headers })
  } catch {
    return failPublic(500, 'relic_data_unavailable', 'The relic dataset could not be read.', undefined, gate.headers)
  }
}
