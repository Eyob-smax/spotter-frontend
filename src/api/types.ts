// Mirrors the backend contract (backend README → /api/docs). Coordinates in GeoJSON are [lon, lat].

export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe' | 'no_travel'
export type RiskOrUnknown = RiskLevel | 'unknown'

export interface Place {
  lat: number
  lon: number
  label: string
}

export interface SearchResult extends Place {
  id: string
  secondary: string
  type: 'city' | 'region' | 'poi' | 'street' | 'address'
}

export interface Route {
  id: string
  name: string
  source: 'tomtom' | 'tomtom_via'
  distance_m: number
  duration_s: number
  traffic_delay_s: number
  departure_time: string
  arrival_time: string
  bbox: [number, number, number, number]
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  cumulative: { distance_m: number[]; time_s: number[] }
}

export interface Plan {
  plan_id: string
  expires_at: string
  origin: Place
  destination: Place
  departure_time: string
  load_weight_lb: number
  routes: Route[]
  notices: string[]
}

export interface Factor {
  type: 'wind' | 'rain' | 'snow' | 'load'
  level: RiskLevel
  value: number
  message: string
  decisive: boolean
}

export interface Checkpoint {
  index: number
  mile: number
  segment_mi: number
  lat: number
  lon: number
  eta: string
  progress: number
  weather: {
    wind_mph: number
    gust_mph: number | null
    rain_in_hr: number
    snow_in_hr: number
    forecast_time: string
  } | null
  risk: RiskOrUnknown
  score: number | null
  factors: Factor[]
}

export interface RouteSummary {
  miles_by_risk: Record<RiskOrUnknown, number>
  no_travel_mi: number
  severe_mi: number
  high_mi: number
  avg_risk: number | null
  max_risk: RiskOrUnknown
  blocked: boolean
  first_blocked_mile: number | null
  checkpoint_count: number
  unknown_count: number
}

export type Criterion = 'no_travel_mi' | 'severe_mi' | 'high_mi' | 'avg_risk' | 'duration_s'

export interface Analysis {
  plan_id: string
  interval_mi: number
  generated_at: string
  weather_cell_deg: number
  routes: { id: string; checkpoints: Checkpoint[]; summary: RouteSummary }[]
  recommendation: {
    route_id: string
    ranking: string[]
    deciding_factor: Criterion | null
    compared_to: string | null
    reason: string
    all_blocked: boolean
    comparison: ({ route_id: string; rank: number; duration_s: number } & Record<Exclude<Criterion, 'duration_s'>, number | null>)[]
  }
  notices: string[]
}

export interface Heatmap {
  plan_id: string
  start_time: string
  hours: number
  step_s: number
  cell_size_deg: number
  cells: [number, number][]
  scores: (number | null)[][]
  complete: boolean
}

export interface Meta {
  risk_levels: { id: RiskLevel; label: string; score: number }[]
  thresholds: Record<'wind_mph' | 'rain_in_hr' | 'snow_in_hr', { bands: Record<RiskLevel, string> }>
  load_rules: { wind_min_mph: number; wind_max_mph: number | null; load_over_lb: number; result: RiskLevel }[]
  intervals_mi: number[]
  load_lb: { min: number; max: number }
  max_departure_days: number
}

export type Interval = 10 | 25 | 50
