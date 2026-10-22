import type { RiskOrUnknown } from '../api/types'

/** Colour is reserved for weather risk; everything else in the UI is black, white and grey. */
export const RISK_COLOR: Record<RiskOrUnknown, string> = {
  low: '#3FB37F',
  moderate: '#E8C547',
  high: '#F08A24',
  severe: '#E5484D',
  no_travel: '#B455F5',
  unknown: '#9A9A9A',
}

export const RISK_LABEL: Record<RiskOrUnknown, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
  no_travel: 'No Travel',
  unknown: 'Unknown',
}

export const RISK_ORDER: RiskOrUnknown[] = ['low', 'moderate', 'high', 'severe', 'no_travel', 'unknown']

/** MapLibre colour ramp for a continuous risk score 0–4 (integer part = level). */
export const SCORE_RAMP: (string | number)[] = [
  0, RISK_COLOR.low,
  1, RISK_COLOR.moderate,
  2, RISK_COLOR.high,
  3, RISK_COLOR.severe,
  4, RISK_COLOR.no_travel,
]
