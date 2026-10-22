import { describe, expect, it } from 'vitest'
import { formatDuration, formatExtra, formatLb, formatMiles, toLocalInput } from './format'

describe('format', () => {
  it.each([[0, '0 mi'], [0.04, '0 mi'], [4.26, '4.3 mi'], [25, '25 mi'], [1234.4, '1,234 mi']])('formatMiles(%d)', (v, out) => {
    expect(formatMiles(v)).toBe(out)
  })

  it.each([[2400, '40 min'], [29520, '8h 12m'], [3600, '1h 00m'], [5100, '1h 25m']])('formatDuration(%d)', (v, out) => {
    expect(formatDuration(v)).toBe(out)
  })

  it('formatExtra and formatLb', () => {
    expect(formatExtra(1920)).toBe('+32 min')
    expect(formatLb(42000)).toBe('42,000 lb')
  })

  it('toLocalInput uses local wall-clock time', () => {
    expect(toLocalInput(new Date(2026, 9, 23, 6, 5))).toBe('2026-10-23T06:05')
  })
})
