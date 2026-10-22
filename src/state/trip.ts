import type { ApiError } from '../api/client'
import type { Analysis, Heatmap, Interval, Place, Plan } from '../api/types'

export type Step = 'routes' | 'weather' | 'scoring' | 'choosing'

export interface SearchState {
  step: Step
  /** Route currently being "tested" by the truck animation, and the ones already done. */
  testing: string | null
  tested: string[]
  durations: Partial<Record<Step, number>>
  failed: { step: 'routes' | 'weather'; error: ApiError } | null
  noRoute: boolean
}

export interface TripState {
  phase: 'plan' | 'search' | 'results'
  origin: Place | null
  destination: Place | null
  departureMode: 'now' | 'custom'
  departure: Date
  loadLb: number
  interval: Interval
  plan: Plan | null
  analysis: Analysis | null
  heatmap: Heatmap | null
  heatmapError: string | null
  search: SearchState | null
  selected: string | null
  hovered: string | null
  formError: { field: 'origin' | 'destination' | 'departure' | 'load' | 'form'; message: string } | null
  reanalyzing: boolean
}

export const initialTrip: TripState = {
  phase: 'plan',
  origin: null,
  destination: null,
  departureMode: 'now',
  departure: new Date(),
  loadLb: 42_000,
  interval: 25,
  plan: null,
  analysis: null,
  heatmap: null,
  heatmapError: null,
  search: null,
  selected: null,
  hovered: null,
  formError: null,
  reanalyzing: false,
}

export type TripAction =
  | { type: 'set-point'; kind: 'origin' | 'destination'; place: Place | null }
  | { type: 'swap' }
  | { type: 'set-departure'; mode: 'now' | 'custom'; date: Date }
  | { type: 'set-load'; lb: number }
  | { type: 'set-interval'; interval: Interval }
  | { type: 'form-error'; error: TripState['formError'] }
  | { type: 'search-start' }
  | { type: 'routes-found'; plan: Plan; ms: number }
  | { type: 'testing'; routeId: string | null }
  | { type: 'tested'; routeId: string }
  | { type: 'weather-done'; ms: number }
  | { type: 'scored'; analysis: Analysis; ms: number }
  | { type: 'search-failed'; step: 'routes' | 'weather'; error: ApiError }
  | { type: 'no-route' }
  | { type: 'retry-weather' }
  | { type: 'show-results' }
  | { type: 'reanalyze-start'; interval: Interval }
  | { type: 'reanalyzed'; analysis: Analysis }
  | { type: 'reanalyze-failed' }
  | { type: 'heatmap'; heatmap: Heatmap | null; error?: string }
  | { type: 'select'; routeId: string }
  | { type: 'hover'; routeId: string | null }
  | { type: 'edit' }

const emptySearch: SearchState = { step: 'routes', testing: null, tested: [], durations: {}, failed: null, noRoute: false }

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case 'set-point':
      return { ...state, [action.kind]: action.place, formError: null }
    case 'swap':
      return { ...state, origin: state.destination, destination: state.origin, formError: null }
    case 'set-departure':
      return { ...state, departureMode: action.mode, departure: action.date, formError: null }
    case 'set-load':
      return { ...state, loadLb: action.lb, formError: null }
    case 'set-interval':
      return { ...state, interval: action.interval }
    case 'form-error':
      return { ...state, formError: action.error }
    case 'search-start':
      return {
        ...state, phase: 'search', search: emptySearch, plan: null, analysis: null, heatmap: null,
        heatmapError: null, selected: null, hovered: null, formError: null,
      }
    case 'routes-found':
      return { ...state, plan: action.plan, search: { ...(state.search ?? emptySearch), step: 'weather', durations: { routes: action.ms } } }
    case 'testing':
      return state.search ? { ...state, search: { ...state.search, testing: action.routeId } } : state
    case 'tested':
      return state.search ? { ...state, search: { ...state.search, testing: null, tested: [...state.search.tested, action.routeId] } } : state
    case 'weather-done':
      return state.search
        ? { ...state, search: { ...state.search, step: 'scoring', failed: null, durations: { ...state.search.durations, weather: action.ms } } }
        : state
    case 'scored':
      return state.search
        ? {
            ...state, analysis: action.analysis, selected: action.analysis.recommendation.route_id,
            search: { ...state.search, step: 'choosing', durations: { ...state.search.durations, scoring: action.ms } },
          }
        : state
    case 'search-failed':
      return state.search ? { ...state, search: { ...state.search, failed: { step: action.step, error: action.error } } } : state
    case 'retry-weather':
      return state.search ? { ...state, search: { ...state.search, step: 'weather', failed: null } } : state
    case 'no-route':
      return state.search ? { ...state, search: { ...state.search, noRoute: true } } : state
    case 'show-results':
      return { ...state, phase: 'results' }
    case 'reanalyze-start':
      return { ...state, interval: action.interval, reanalyzing: true }
    case 'reanalyzed':
      return { ...state, analysis: action.analysis, reanalyzing: false }
    case 'reanalyze-failed':
      return { ...state, reanalyzing: false }
    case 'heatmap':
      return { ...state, heatmap: action.heatmap, heatmapError: action.error ?? null }
    case 'select':
      return { ...state, selected: action.routeId }
    case 'hover':
      return state.hovered === action.routeId ? state : { ...state, hovered: action.routeId }
    case 'edit':
      return { ...state, phase: 'plan', search: null, plan: null, analysis: null, heatmap: null, selected: null, hovered: null }
  }
}
