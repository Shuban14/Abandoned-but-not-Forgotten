import { isPlanetId, listRelics, relicCounts } from '@/lib/relics'
import { isCategory } from '@/lib/types'
import { fail, ok } from '@/lib/http'
import type { RelicCategory, RelicListMeta } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/relics
 *   ?planet=moon | mars | all   (default: all)
 *   ?category=crewed | rover | sample-return | lander
 *   ?q=search text
 *   ?limit=n
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const planetParam = params.get('planet') ?? 'all'
  if (planetParam !== 'all' && !isPlanetId(planetParam)) {
    return fail(400, 'invalid_planet', "planet must be 'moon', 'mars' or 'all'.")
  }

  const categoryParam = params.get('category')
  if (categoryParam && !isCategory(categoryParam)) {
    return fail(400, 'invalid_category', 'category is not recognised.')
  }

  const q = params.get('q') ?? undefined
  if (q && q.length > 80) return fail(400, 'invalid_query', 'q must be 80 characters or fewer.')

  const limitParam = params.get('limit')
  let limit: number | undefined
  if (limitParam !== null) {
    const parsed = Number(limitParam)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      return fail(400, 'invalid_limit', 'limit must be an integer between 1 and 200.')
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
    return ok(items, { maxAge: 60, meta })
  } catch {
    return fail(500, 'relic_data_unavailable', 'The relic dataset could not be read.')
  }
}
