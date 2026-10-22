import type { Analysis, Heatmap, Interval, Meta, Place, Plan, SearchResult } from './types'

const BASE = `${(import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')}/api`
const TIMEOUT_MS = 60_000

/** Error envelope from the backend: {"error": {"code", "message", "field"?, "retry_after"?}}. */
export class ApiError extends Error {
  readonly code: string
  readonly field?: string
  readonly retryAfter?: number
  readonly status: number

  constructor(status: number, code: string, message: string, field?: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
    this.retryAfter = retryAfter
  }
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      signal: combined,
    })
  } catch (err) {
    if (signal?.aborted) throw err // cancelled by the user: let the caller ignore it
    if (timeout.aborted) throw new ApiError(0, 'timeout', 'The server took too long to respond. Please try again.')
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.')
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON body (e.g. a proxy error page) – handled below.
  }
  if (response.ok) return body as T

  const error = (body as { error?: { code?: string; message?: string; field?: string; retry_after?: number } })?.error
  throw new ApiError(
    response.status,
    error?.code ?? 'internal_error',
    error?.message ?? 'Something went wrong. Please try again.',
    error?.field,
    error?.retry_after,
  )
}

export const api = {
  meta: () => request<Meta>('/meta'),

  search: (q: string, near: { lat: number; lon: number } | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q })
    if (near) {
      params.set('lat', near.lat.toFixed(3))
      params.set('lon', near.lon.toFixed(3))
    }
    return request<{ results: SearchResult[] }>(`/geocode/search?${params}`, {}, signal)
  },

  reverse: (lat: number, lon: number) =>
    request<Place>(`/geocode/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`),

  routes: (
    body: { origin: Place; destination: Place; departure_time: string; load_weight_lb: number },
    signal?: AbortSignal,
  ) => request<Plan>('/routes', { method: 'POST', body: JSON.stringify(body) }, signal),

  analysis: (planId: string, interval: Interval, signal?: AbortSignal) =>
    request<Analysis>(`/plans/${planId}/analysis`, { method: 'POST', body: JSON.stringify({ interval_mi: interval }) }, signal),

  heatmap: (planId: string, signal?: AbortSignal) => request<Heatmap>(`/plans/${planId}/heatmap`, {}, signal),
}
