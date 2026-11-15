// The one place the browser talks to the backend.
// Every component goes through this module: base URL, timeouts, cancellation,
// response parsing and error normalisation live here and nowhere else.
import type {
  ApiEnvelope,
  ApiErrorBody,
  HealthReport,
  MissionInput,
  MissionRecord,
  PlanetId,
  Relic,
  RelicCategory,
  RelicListMeta,
} from './types'

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api').replace(/\/$/, '')
const DEFAULT_TIMEOUT = 9000

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly cancelled: boolean

  constructor(message: string, status = 0, code = 'network_error', cancelled = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.cancelled = cancelled
  }
}

type RequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  method?: 'GET' | 'POST'
  body?: unknown
}

async function requestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT)

  const forwardAbort = () => controller.abort()
  options.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal?.aborted) controller.abort()

  try {
    const response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      const error = (payload as ApiErrorBody | null)?.error
      throw new ApiError(
        error?.message || `The server responded with ${response.status}.`,
        response.status,
        error?.code || 'http_error',
      )
    }

    return (payload as ApiEnvelope<T>) ?? { data: null as unknown as T }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) throw new ApiError('The request timed out. Please try again.', 0, 'timeout')
    if (options.signal?.aborted) throw new ApiError('Request cancelled.', 0, 'cancelled', true)
    throw new ApiError('Could not reach the backend. Check your connection and try again.', 0, 'network_error')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestEnvelope<T>(path, options)).data
}

export type RelicsQuery = {
  planet: PlanetId
  category?: RelicCategory | 'all'
  q?: string
}

export type RelicsResult = { items: Relic[]; meta: RelicListMeta | null }

export const api = {
  health: (signal?: AbortSignal) => request<HealthReport>('/health', { signal }),

  async relics({ planet, category, q }: RelicsQuery, signal?: AbortSignal): Promise<RelicsResult> {
    const params = new URLSearchParams({ planet })
    if (category && category !== 'all') params.set('category', category)
    if (q?.trim()) params.set('q', q.trim())
    const envelope = await requestEnvelope<Relic[]>(`/relics?${params.toString()}`, { signal })
    return { items: envelope.data ?? [], meta: (envelope.meta as RelicListMeta | undefined) ?? null }
  },

  relic: (id: string, signal?: AbortSignal) =>
    request<Relic>(`/relics/${encodeURIComponent(id)}`, { signal }),

  missions: (limit = 10, signal?: AbortSignal) =>
    request<MissionRecord[]>(`/missions?limit=${limit}`, { signal }),

  saveMission: (mission: MissionInput, signal?: AbortSignal) =>
    request<MissionRecord>('/missions', { method: 'POST', body: mission, signal }),
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
