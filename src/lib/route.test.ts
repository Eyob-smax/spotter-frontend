import { describe, expect, it } from 'vitest'
import type { Checkpoint, Route } from '../api/types'
import { RISK_COLOR } from './risk'
import { angleDelta, bearing, bracket, expectedCheckpoints, positionAtTime, revealGradient, riskGradient, riskSegments, unionBounds } from './route'

const route = (coords: [number, number][], times: number[], bbox: Route['bbox'] = [0, 0, 1, 1]): Route => ({
  id: 'A',
  name: 'via I-80',
  source: 'tomtom',
  distance_m: 1000,
  duration_s: times[times.length - 1],
  traffic_delay_s: 0,
  departure_time: '2026-10-23T14:00:00Z',
  arrival_time: '2026-10-23T15:00:00Z',
  bbox,
  geometry: { type: 'LineString', coordinates: coords },
  cumulative: { distance_m: times.map((t) => t * 10), time_s: times },
})

const cp = (progress: number, risk: Checkpoint['risk'], segment_mi = 10): Checkpoint => ({
  index: 0, mile: 0, segment_mi, lat: 0, lon: 0, eta: '', progress, weather: null, risk, score: null, factors: [],
})

describe('bracket', () => {
  const v = [0, 10, 20, 30]
  it.each([[-5, 0], [0, 0], [5, 0], [10, 1], [29, 2], [30, 2], [99, 2]])('x=%d → %d', (x, i) => {
    expect(bracket(v, x)).toBe(i)
  })
})

describe('positionAtTime', () => {
  const r = route([[0, 0], [0, 1], [1, 1]], [0, 100, 300])

  it('interpolates using the route’s own timing', () => {
    expect(positionAtTime(r, 50).point).toEqual([0, 0.5])
    expect(positionAtTime(r, 200).point).toEqual([0.5, 1])
  })

  it('clamps before departure and after arrival', () => {
    expect(positionAtTime(r, -10).point).toEqual([0, 0])
    expect(positionAtTime(r, 1e6).point).toEqual([1, 1])
  })

  it('reports heading of the current segment', () => {
    expect(positionAtTime(r, 50).bearing).toBeCloseTo(0)
    expect(positionAtTime(r, 200).bearing).toBeCloseTo(90)
  })
})

describe('angles', () => {
  it('bearing points east/south/west', () => {
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90)
    expect(bearing([0, 0], [0, -1])).toBeCloseTo(180)
    expect(bearing([0, 0], [-1, 0])).toBeCloseTo(-90)
  })

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(170, -170)).toBe(20)
    expect(angleDelta(-170, 170)).toBe(-20)
    expect(angleDelta(10, 10)).toBe(0)
  })
})

describe('riskGradient', () => {
  it('switches colour halfway between checkpoints', () => {
    const expr = riskGradient([cp(0, 'low'), cp(0.5, 'severe'), cp(1, 'low')])
    expect(expr).toEqual(['step', ['line-progress'], RISK_COLOR.low, 0.25, RISK_COLOR.severe, 0.75, RISK_COLOR.low])
  })

  it('keeps stops strictly increasing', () => {
    const expr = riskGradient([cp(0, 'low'), cp(0, 'high'), cp(1, 'low')])
    const stops = expr.slice(3).filter((_, i) => i % 2 === 0) as number[]
    expect(stops).toEqual([...stops].sort((a, b) => a - b))
    expect(new Set(stops).size).toBe(stops.length)
  })

  it('is valid for a single checkpoint', () => {
    expect(riskGradient([cp(0, 'high')]).length).toBe(5)
  })
})

it('revealGradient hides the line beyond progress', () => {
  expect(revealGradient('#000', 0.4)).toEqual(['step', ['line-progress'], '#000', 0.4, 'rgba(0,0,0,0)'])
  expect((revealGradient('#000', 0)[3] as number) > 0).toBe(true)
})

it('riskSegments merges neighbours of the same risk', () => {
  const segs = riskSegments([cp(0, 'low', 5), cp(0.3, 'low', 10), cp(0.6, 'high', 10), cp(1, 'low', 5)])
  expect(segs).toEqual([
    { weight: 15, color: RISK_COLOR.low },
    { weight: 10, color: RISK_COLOR.high },
    { weight: 5, color: RISK_COLOR.low },
  ])
})

it('unionBounds covers every route', () => {
  const a = route([[0, 0], [1, 1]], [0, 1], [-1, 2, 3, 4])
  const b = route([[0, 0], [1, 1]], [0, 1], [-5, 0, 1, 9])
  expect(unionBounds([a, b])).toEqual([-5, 0, 3, 9])
})

describe('expectedCheckpoints matches the backend sampling rule', () => {
  it.each([
    [120, 25, 6], // 0,25,50,75,100 + destination
    [100, 25, 5], // 0,25,50,75,100(destination)
    [50.2, 25, 3], // 0,25,50.2 (snapped)
    [7, 10, 2],
    [0.3, 50, 2],
  ])('%d mi every %d mi → %d', (len, interval, n) => {
    expect(expectedCheckpoints(len, interval)).toBe(n)
  })
})
