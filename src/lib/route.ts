import type { ExpressionSpecification } from 'maplibre-gl'
import type { Checkpoint, Route } from '../api/types'
import { RISK_COLOR } from './risk'

export type LngLat = [number, number]

/** Index i such that values[i] <= x < values[i + 1] (clamped), for a non-decreasing array. */
export function bracket(values: number[], x: number): number {
  let lo = 0
  let hi = values.length - 1
  if (x <= values[0]) return 0
  if (x >= values[hi]) return Math.max(0, hi - 1)
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (values[mid] <= x) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Where a truck on `route` is `elapsed` seconds after departure, plus its heading.
 * Uses the route's own cumulative travel times (from TomTom), so slow and fast
 * stretches are respected. Heading is the screen-space bearing in degrees (0 = north).
 */
export function positionAtTime(route: Route, elapsed: number): { point: LngLat; bearing: number } {
  return positionAlong(route.geometry.coordinates, route.cumulative.time_s, elapsed)
}

export function positionAtDistance(route: Route, meters: number): { point: LngLat; bearing: number } {
  return positionAlong(route.geometry.coordinates, route.cumulative.distance_m, meters)
}

function positionAlong(coords: LngLat[], cumulative: number[], value: number): { point: LngLat; bearing: number } {
  const i = bracket(cumulative, value)
  const a = coords[i]
  const b = coords[Math.min(i + 1, coords.length - 1)]
  const span = cumulative[i + 1] - cumulative[i]
  const f = span > 0 ? Math.min(Math.max((value - cumulative[i]) / span, 0), 1) : 0
  return {
    point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    bearing: bearing(a, b),
  }
}

/** Bearing between two nearby points in degrees clockwise from north. */
export function bearing(a: LngLat, b: LngLat): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const dx = (b[0] - a[0]) * Math.cos(meanLat)
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return 0
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

/** Shortest signed angle from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

export function unionBounds(routes: Route[]): [number, number, number, number] {
  return routes.reduce<[number, number, number, number]>(
    (acc, r) => [Math.min(acc[0], r.bbox[0]), Math.min(acc[1], r.bbox[1]), Math.max(acc[2], r.bbox[2]), Math.max(acc[3], r.bbox[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

/**
 * MapLibre `line-gradient` expression colouring a route by checkpoint risk.
 * Each checkpoint owns the stretch halfway to its neighbours (same rule the
 * backend uses for "miles at risk"), so the line matches the risk strip.
 */
export function riskGradient(checkpoints: Checkpoint[]): ExpressionSpecification {
  if (checkpoints.length === 0) return ['step', ['line-progress'], RISK_COLOR.unknown, 0.5, RISK_COLOR.unknown]
  const expr: unknown[] = ['step', ['line-progress'], RISK_COLOR[checkpoints[0].risk]]
  let last = 0
  for (let i = 1; i < checkpoints.length; i++) {
    const boundary = (checkpoints[i - 1].progress + checkpoints[i].progress) / 2
    if (boundary <= last) continue // stops must strictly increase
    expr.push(boundary, RISK_COLOR[checkpoints[i].risk])
    last = boundary
  }
  if (expr.length === 3) expr.push(0.999999, RISK_COLOR[checkpoints[0].risk]) // a step needs at least one stop
  return expr as ExpressionSpecification
}

/** Gradient that reveals a line from its start up to `progress` (0–1), for the draw-in animation. */
export function revealGradient(color: string, progress: number): ExpressionSpecification {
  const p = Math.min(Math.max(progress, 0.000001), 0.999999)
  return ['step', ['line-progress'], color, p, 'rgba(0,0,0,0)']
}

/** Risk-strip segments for a route card: width proportional to the miles each checkpoint covers. */
export function riskSegments(checkpoints: Checkpoint[]): { weight: number; color: string }[] {
  const out: { weight: number; color: string }[] = []
  for (const cp of checkpoints) {
    const color = RISK_COLOR[cp.risk]
    const prev = out[out.length - 1]
    if (prev && prev.color === color) prev.weight += cp.segment_mi
    else out.push({ weight: cp.segment_mi, color })
  }
  return out
}

/**
 * Number of checkpoints the backend places on a route: mile 0, every `interval`
 * miles, and the destination (merged into the last mark when within 0.5 mi).
 * Lets the UI say "checking 22 checkpoints" before the analysis returns.
 */
export function expectedCheckpoints(lengthMi: number, interval: number): number {
  if (lengthMi <= 0) return 1
  const marks = Math.ceil(lengthMi / interval)
  const tail = lengthMi - (marks - 1) * interval
  return marks === 1 || tail >= 0.5 ? marks + 1 : marks
}
