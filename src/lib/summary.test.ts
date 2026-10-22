import { describe, expect, it } from 'vitest'
import type { Analysis, Checkpoint, Route, RouteSummary } from '../api/types'
import { averageSpeed, corridorRiskAt, routeConditions, routeNote } from './summary'

const cp = (mile: number, risk: Checkpoint['risk'], wind = 10, extra: Partial<NonNullable<Checkpoint['weather']>> = {}): Checkpoint => ({
  index: 0, mile, segment_mi: 25, lat: 0, lon: 0, eta: '', progress: 0, risk, score: null, factors: [],
  weather:
    risk === 'unknown'
      ? null
      : {
          wind_mph: wind, gust_mph: wind + 8, rain_in_hr: 0, snow_in_hr: 0, forecast_time: '',
          temperature_f: 40 + wind, precip_probability: wind, visibility_mi: 10, weather_code: 2, conditions: 'Partly cloudy', ...extra,
        },
})

const summary = (over: Partial<RouteSummary> = {}): RouteSummary => ({
  miles_by_risk: { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0, unknown: 0 },
  no_travel_mi: 0, severe_mi: 0, high_mi: 0, avg_risk: 0, max_risk: 'low', blocked: false,
  first_blocked_mile: null, checkpoint_count: 3, unknown_count: 0, ...over,
})

const route = (id: string, duration_s: number, distance_m = 160_934): Route => ({
  id, name: `via ${id}`, source: 'tomtom', distance_m, duration_s, traffic_delay_s: 0,
  departure_time: '', arrival_time: '', bbox: [0, 0, 1, 1],
  geometry: { type: 'LineString', coordinates: [] }, cumulative: { distance_m: [], time_s: [] },
})

const analysis = (recommended: string, routes: { id: string; checkpoints: Checkpoint[]; summary: RouteSummary }[]): Analysis => ({
  plan_id: 'pl_x', interval_mi: 25, generated_at: '', weather_cell_deg: 0.1, notices: [], routes,
  recommendation: {
    route_id: recommended, ranking: routes.map((r) => r.id), deciding_factor: 'severe_mi', compared_to: null,
    reason: 'Fewest severe-risk miles: 0 mi vs 25 mi on Route A (fastest); adds 32 min', all_blocked: false, comparison: [],
  },
})

describe('routeConditions', () => {
  it('takes the maxima along the route and finds the worst checkpoint', () => {
    const c = routeConditions([cp(0, 'low', 8), cp(25, 'high', 38, { rain_in_hr: 0.3 }), cp(50, 'moderate', 30, { snow_in_hr: 0.6 })])
    expect(c).toMatchObject({ maxWind: 38, maxGust: 46, maxRain: 0.3, maxSnow: 0.6 })
    expect(c.worst?.mile).toBe(25)
  })

  it('summarises temperature, visibility, chance and conditions', () => {
    const c = routeConditions([
      cp(0, 'low', 8, { visibility_mi: 9 }),
      cp(25, 'moderate', 30, { conditions: 'Light rain', visibility_mi: 2.5 }),
      cp(50, 'low', 10),
    ])
    expect(c).toMatchObject({ minTemp: 48, maxTemp: 70, minVisibility: 2.5, maxPrecipChance: 30 })
    expect(c.conditions).toEqual([
      { label: 'Partly cloudy', miles: 50 },
      { label: 'Light rain', miles: 25 },
    ])
  })

  it('has no worst checkpoint when the route is all Low', () => {
    expect(routeConditions([cp(0, 'low'), cp(25, 'low')]).worst).toBeNull()
  })

  it('ignores checkpoints without a forecast', () => {
    const c = routeConditions([cp(0, 'unknown'), cp(25, 'low', 12)])
    expect(c.maxWind).toBe(12)
    expect(routeConditions([cp(0, 'unknown')]).maxWind).toBeNull()
  })
})

it('averageSpeed is miles per hour', () => {
  expect(averageSpeed(route('A', 7200, 160_934.4))).toBeCloseTo(50)
})

describe('routeNote', () => {
  const routes = [route('A', 10_000), route('B', 11_920), route('C', 12_000)]

  it('repeats the reason on the recommended route', () => {
    const a = analysis('B', [
      { id: 'A', checkpoints: [cp(0, 'severe')], summary: summary({ severe_mi: 25 }) },
      { id: 'B', checkpoints: [cp(0, 'low')], summary: summary() },
    ])
    expect(routeNote('B', routes, a)).toMatch(/^Recommended: Fewest severe-risk miles/)
  })

  it('explains each losing route by the first criterion it loses on', () => {
    const a = analysis('B', [
      { id: 'A', checkpoints: [cp(0, 'low'), cp(120, 'severe')], summary: summary({ severe_mi: 25 }) },
      { id: 'B', checkpoints: [cp(0, 'low')], summary: summary() },
      { id: 'C', checkpoints: [cp(0, 'low'), cp(75, 'no_travel')], summary: summary({ no_travel_mi: 25, blocked: true }) },
    ])
    expect(routeNote('A', routes, a)).toBe('25 mi of severe risk from mile 120')
    expect(routeNote('C', routes, a)).toBe('Blocked: 25 mi of No-Travel conditions from mile 75')
  })

  it('falls back to travel time when the weather risk is equal', () => {
    const a = analysis('A', [
      { id: 'A', checkpoints: [cp(0, 'low')], summary: summary() },
      { id: 'B', checkpoints: [cp(0, 'low')], summary: summary() },
    ])
    expect(routeNote('B', routes, a)).toBe('Same weather risk, 32 min slower')
  })

  it('treats nearly equal average risk as equal weather', () => {
    const a = analysis('A', [
      { id: 'A', checkpoints: [cp(0, 'low')], summary: summary({ avg_risk: 0.23 }) },
      { id: 'B', checkpoints: [cp(0, 'low')], summary: summary({ avg_risk: 0.35 }) },
    ])
    expect(routeNote('B', routes, a)).toBe('Same weather risk, 32 min slower')
  })

  it('mentions higher average risk', () => {
    const a = analysis('A', [
      { id: 'A', checkpoints: [cp(0, 'low')], summary: summary({ avg_risk: 0.1 }) },
      { id: 'B', checkpoints: [cp(0, 'moderate')], summary: summary({ avg_risk: 0.6 }) },
    ])
    expect(routeNote('B', routes, a)).toBe('Higher average risk: 0.60 vs 0.10')
  })
})

describe('corridorRiskAt', () => {
  it('reports the highest level on the corridor at that hour', () => {
    const scores = [[0.2, 2.4], [0.5, 0.1]]
    expect(corridorRiskAt(scores, 0)).toEqual({ level: 'low', text: 'Calm: no weather risk along the corridor' })
    expect(corridorRiskAt(scores, 1)).toEqual({ level: 'high', text: 'High weather on the corridor' })
    expect(corridorRiskAt([[null]], 0)).toEqual({ level: 'unknown', text: 'No forecast for this hour' })
  })
})
