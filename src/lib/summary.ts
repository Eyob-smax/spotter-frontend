import type { Analysis, Checkpoint, RiskOrUnknown, Route, RouteSummary } from '../api/types'
import { formatDuration, formatMiles, miles } from './format'
import { RISK_LABEL } from './risk'

const LEVEL_RANK: Record<RiskOrUnknown, number> = { unknown: -1, low: 0, moderate: 1, high: 2, severe: 3, no_travel: 4 }

export interface RouteConditions {
  maxWind: number | null
  maxGust: number | null
  maxRain: number | null
  maxSnow: number | null
  minTemp: number | null
  maxTemp: number | null
  minVisibility: number | null
  maxPrecipChance: number | null
  /** Conditions along the route by miles covered, most common first. */
  conditions: { label: string; miles: number }[]
  /** The riskiest checkpoint (first one at the highest level), or null if the route is all Low/unknown. */
  worst: Checkpoint | null
}

/** Worst weather the truck meets along a route, taken from each checkpoint's forecast at its ETA. */
export function routeConditions(checkpoints: Checkpoint[]): RouteConditions {
  const known = checkpoints.filter((c) => c.weather)
  const values = (pick: (c: Checkpoint) => number | null | undefined) =>
    known.map(pick).filter((v): v is number => v != null)
  const max = (pick: (c: Checkpoint) => number | null | undefined) => {
    const v = values(pick)
    return v.length ? Math.max(...v) : null
  }
  const min = (pick: (c: Checkpoint) => number | null | undefined) => {
    const v = values(pick)
    return v.length ? Math.min(...v) : null
  }
  const byLabel = new Map<string, number>()
  for (const c of known) {
    const label = c.weather?.conditions
    if (label) byLabel.set(label, (byLabel.get(label) ?? 0) + c.segment_mi)
  }
  let worst: Checkpoint | null = null
  for (const cp of checkpoints) {
    if (LEVEL_RANK[cp.risk] > 0 && (!worst || LEVEL_RANK[cp.risk] > LEVEL_RANK[worst.risk])) worst = cp
  }
  return {
    maxWind: max((c) => c.weather?.wind_mph),
    maxGust: max((c) => c.weather?.gust_mph),
    maxRain: max((c) => c.weather?.rain_in_hr),
    maxSnow: max((c) => c.weather?.snow_in_hr),
    minTemp: min((c) => c.weather?.temperature_f),
    maxTemp: max((c) => c.weather?.temperature_f),
    minVisibility: min((c) => c.weather?.visibility_mi),
    maxPrecipChance: max((c) => c.weather?.precip_probability),
    conditions: [...byLabel].map(([label, m]) => ({ label, miles: m })).sort((a, b) => b.miles - a.miles),
    worst,
  }
}

/** Average driving speed in mph. */
export function averageSpeed(route: Route): number {
  return route.duration_s > 0 ? miles(route.distance_m) / (route.duration_s / 3600) : 0
}

/**
 * One line per route explaining its place in the ranking: the recommended route
 * repeats the backend's reason; every other route says what made it worse than
 * the recommended one, following the same order as the ranking.
 */
export function routeNote(routeId: string, routes: Route[], analysis: Analysis): string {
  const rec = analysis.recommendation
  const byId = new Map(analysis.routes.map((r) => [r.id, r]))
  const mine = byId.get(routeId)
  const best = byId.get(rec.route_id)
  if (!mine || !best) return ''
  if (routeId === rec.route_id) return rec.all_blocked ? `Least bad option: ${rec.reason}` : `Recommended: ${rec.reason}`

  const s: RouteSummary = mine.summary
  const b: RouteSummary = best.summary
  const where = (level: RiskOrUnknown) => {
    const cp = mine.checkpoints.find((c) => c.risk === level)
    return cp ? ` from mile ${Math.round(cp.mile)}` : ''
  }
  if (s.no_travel_mi > b.no_travel_mi) return `Blocked: ${formatMiles(s.no_travel_mi)} of No-Travel conditions${where('no_travel')}`
  if (s.severe_mi > b.severe_mi) return `${formatMiles(s.severe_mi)} of severe risk${where('severe')}`
  if (s.high_mi > b.high_mi) return `${formatMiles(s.high_mi)} of high risk${where('high')}`
  if ((s.avg_risk ?? 0) > (b.avg_risk ?? 0) + 0.005) {
    return `Higher average risk: ${(s.avg_risk ?? 0).toFixed(2)} vs ${(b.avg_risk ?? 0).toFixed(2)}`
  }
  const me = routes.find((r) => r.id === routeId)
  const winner = routes.find((r) => r.id === rec.route_id)
  const slower = me && winner ? me.duration_s - winner.duration_s : 0
  return slower >= 60 ? `Same weather risk, ${formatDuration(slower)} slower` : 'Same weather risk and travel time'
}

/** Sentence for the forecast bar: what the overlay shows at a (fractional) hour. */
export function corridorRiskAt(scores: (number | null)[][], hour: number): string {
  const h = Math.min(Math.max(Math.round(hour), 0), (scores[0]?.length ?? 1) - 1)
  let max = -1
  for (const row of scores) {
    const v = row[h]
    if (v != null && v > max) max = v
  }
  if (max < 0) return 'No forecast for this hour'
  if (max < 1) return 'No weather risk along the corridor at this hour'
  const level = (['low', 'moderate', 'high', 'severe', 'no_travel'] as const)[Math.min(4, Math.floor(max))]
  return `Highest risk on the corridor: ${RISK_LABEL[level]}`
}
