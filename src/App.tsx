import { CircleHelp, Truck } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { ApiError, api } from './api/client'
import type { Interval, Place, Plan } from './api/types'
import { ForecastBar } from './components/ForecastBar'
import { HowItWorks } from './components/HowItWorks'
import { Legend } from './components/Legend'
import { LOAD_MAX, LOAD_MIN, MAX_DEPARTURE_DAYS, PlanPanel } from './components/PlanPanel'
import { ResultsPanel } from './components/ResultsPanel'
import { SearchPanel } from './components/SearchPanel'
import { formatDuration, formatMiles, miles } from './lib/format'
import { MapController, type PointKind } from './map/MapController'
import { initialTrip, tripReducer, type TripState } from './state/trip'

const MIN_STAGE_MS = 600 // keep fast stages on screen long enough to read
const TEST_MS = 2600 // truck drive per route while the weather request is in flight
const TEST_MS_FAST = 1300 // ... once the weather has already arrived
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const coordsLabel = (lat: number, lon: number) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`

export default function App() {
  const [trip, dispatch] = useReducer(tripReducer, initialTrip)
  const [map, setMap] = useState<MapController | null>(null)
  const [pick, setPick] = useState<PointKind | null>(null)
  const [locating, setLocating] = useState<PointKind | null>(null)
  const [howOpen, setHowOpen] = useState(false)
  const mapEl = useRef<HTMLDivElement>(null)
  const originInput = useRef<HTMLInputElement>(null)
  const tripRef = useRef(trip)
  const abortRef = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    tripRef.current = trip
  })

  // ---------------------------------------------------------------- map lifecycle

  const handlePick = useRef<(kind: PointKind, at: { lat: number; lon: number }) => void>(() => {})
  useEffect(() => {
    if (!mapEl.current) return
    const controller = new MapController(mapEl.current, {
      onPick: (kind, at) => handlePick.current(kind, at),
      onRouteHover: (id) => dispatch({ type: 'hover', routeId: id }),
      onRouteClick: (id) => dispatch({ type: 'select', routeId: id }),
    })
    setMap(controller)
    if (import.meta.env.DEV) Object.assign(window, { __spotterMap: controller }) // for local end-to-end checks only
    return () => controller.destroy()
  }, [])

  // While planning, a plain click fills whichever point is still empty.
  const autoPick: PointKind | null = trip.phase === 'plan' ? (!trip.origin ? 'origin' : !trip.destination ? 'destination' : null) : null
  const activePick = pick ?? autoPick
  useEffect(() => map?.setPickMode(activePick), [map, activePick])
  useEffect(() => map?.setPoints(trip.origin, trip.destination), [map, trip.origin, trip.destination])
  useEffect(() => {
    if (trip.phase === 'results' && trip.selected) map?.showResult(trip.selected, trip.hovered)
  }, [map, trip.phase, trip.selected, trip.hovered, trip.analysis])

  // ---------------------------------------------------------------- search flow

  const runAnalysis = useCallback(
    async (plan: Plan, interval: Interval, signal: AbortSignal, animate: boolean) => {
      if (!map) return
      const started = performance.now()
      let arrived = false
      let arrivedAt = 0
      const request = api.analysis(plan.plan_id, interval, signal).finally(() => {
        arrived = true
        arrivedAt = performance.now()
      })
      request.catch(() => {}) // handled below; avoid an unhandled rejection while trucks drive

      if (animate) {
        for (const route of plan.routes) {
          if (signal.aborted) return
          dispatch({ type: 'testing', routeId: route.id })
          await map.testRoute(route.id, interval, arrived ? TEST_MS_FAST : TEST_MS)
          dispatch({ type: 'tested', routeId: route.id })
        }
      }
      let analysis
      try {
        analysis = await request
      } catch (err) {
        if (signal.aborted) return
        dispatch({ type: 'search-failed', step: 'weather', error: asApiError(err) })
        return
      }
      dispatch({ type: 'weather-done', ms: arrivedAt - started })

      const scoreStart = performance.now()
      await map.showScored(analysis.routes)
      if (signal.aborted) return
      dispatch({ type: 'scored', analysis, ms: performance.now() - scoreStart })
      map.showResult(analysis.recommendation.route_id, null)
      map.fitRoutes()
      await sleep(900)
      if (signal.aborted) return
      dispatch({ type: 'show-results' })

      // Heatmap after the analysis (not in parallel) so both stay within the weather API's per-minute quota.
      api
        .heatmap(plan.plan_id, signal)
        .then((heatmap) => {
          map.setHeatmap(heatmap)
          dispatch({ type: 'heatmap', heatmap })
        })
        .catch((err) => {
          if (!signal.aborted) dispatch({ type: 'heatmap', heatmap: null, error: `Weather overlay unavailable: ${asApiError(err).message}` })
        })
    },
    [map],
  )

  const startSearch = useCallback(
    async (state: TripState) => {
      if (!map || !state.origin || !state.destination) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const { signal } = controller
      setPick(null)
      dispatch({ type: 'search-start' })
      map.showSearching(state.origin, state.destination)

      const started = performance.now()
      let plan: Plan
      try {
        const departure = state.departureMode === 'now' ? new Date() : state.departure
        ;[plan] = await Promise.all([
          api.routes(
            { origin: state.origin, destination: state.destination, departure_time: departure.toISOString(), load_weight_lb: state.loadLb },
            signal,
          ),
          sleep(MIN_STAGE_MS),
        ])
      } catch (err) {
        if (signal.aborted) return
        const error = asApiError(err)
        map.reset()
        if (error.code === 'point_not_routable' || error.code === 'validation_error') {
          dispatch({ type: 'edit' })
          const field = error.field === 'destination' ? 'destination' : error.field === 'origin' ? 'origin' : 'form'
          dispatch({ type: 'form-error', error: { field, message: error.message } })
        } else if (error.code === 'no_route_found') {
          dispatch({ type: 'no-route' })
        } else {
          dispatch({ type: 'search-failed', step: 'routes', error })
        }
        return
      }
      dispatch({ type: 'routes-found', plan, ms: performance.now() - started })
      await map.drawRoutes(plan.routes)
      if (signal.aborted) return
      await runAnalysis(plan, state.interval, signal, true)
    },
    [map, runAnalysis],
  )

  const submit = () => {
    const error = validate(trip)
    if (error) {
      dispatch({ type: 'form-error', error })
      return
    }
    void startSearch(trip)
  }

  const cancel = () => {
    abortRef.current?.abort()
    map?.reset()
    dispatch({ type: 'edit' })
  }

  const retry = (step: 'routes' | 'weather') => {
    const current = tripRef.current
    if (step === 'routes' || !current.plan || !map) {
      void startSearch(current)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'retry-weather' })
    void runAnalysis(current.plan, current.interval, controller.signal, false)
  }

  const changeInterval = async (interval: Interval) => {
    const current = tripRef.current
    if (!current.plan || !map) return
    dispatch({ type: 'reanalyze-start', interval })
    try {
      const analysis = await api.analysis(current.plan.plan_id, interval)
      await map.showScored(analysis.routes)
      dispatch({ type: 'reanalyzed', analysis })
      map.showResult(tripRef.current.selected ?? analysis.recommendation.route_id, null)
    } catch {
      dispatch({ type: 'reanalyze-failed' })
    }
  }

  // ---------------------------------------------------------------- picking points

  const setPoint = useCallback(
    (kind: PointKind, place: Place | null) => {
      dispatch({ type: 'set-point', kind, place })
      if (place) map?.fitPoints([place, kind === 'origin' ? tripRef.current.destination : tripRef.current.origin].filter(Boolean) as Place[])
    },
    [map],
  )

  const onMapPick = (kind: PointKind, { lat, lon }: { lat: number; lon: number }) => {
    const provisional = { lat, lon, label: coordsLabel(lat, lon) }
    dispatch({ type: 'set-point', kind, place: provisional })
    setPick(null)
    api
      .reverse(lat, lon)
      .then((place) => {
        const current = tripRef.current[kind]
        if (current && current.lat === lat && current.lon === lon) dispatch({ type: 'set-point', kind, place: { lat, lon, label: place.label } })
      })
      .catch(() => {}) // keep the coordinates as the label
    // Dragging a pin after a search re-runs it with the new point.
    const current = tripRef.current
    if (current.phase !== 'plan') {
      const next = { ...current, [kind]: provisional }
      if (next.origin && next.destination) void startSearch(next)
    }
  }

  useLayoutEffect(() => {
    handlePick.current = onMapPick
  })

  const useMyLocation = (kind: PointKind) => {
    if (!navigator.geolocation) {
      dispatch({ type: 'form-error', error: { field: kind, message: 'Location isn’t available in this browser.' } })
      return
    }
    setLocating(kind)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(null)
        const { latitude: lat, longitude: lon } = pos.coords
        map?.showUserLocation(lat, lon)
        setPoint(kind, { lat, lon, label: 'My location' })
        api
          .reverse(lat, lon)
          .then((p) => {
            const current = tripRef.current[kind]
            if (current && current.lat === lat && current.lon === lon) dispatch({ type: 'set-point', kind, place: { lat, lon, label: p.label } })
          })
          .catch(() => {}) // keep "My location" as the label
      },
      (err) => {
        setLocating(null)
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location access is off. Type an address or click the map instead.'
            : 'Couldn’t get your location. Type an address or click the map instead.'
        dispatch({ type: 'form-error', error: { field: kind, message } })
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  // "/" focuses search; Escape leaves pick mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing && tripRef.current.phase === 'plan') {
        e.preventDefault()
        originInput.current?.focus()
      }
      if (e.key === 'Escape') setPick(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Tab title reflects state.
  useEffect(() => {
    const rec = trip.analysis?.recommendation
    document.title =
      trip.phase === 'search' ? 'Testing routes… · Spotter Route' : rec && trip.phase === 'results' ? `Route ${rec.route_id} is safest · Spotter Route` : 'Spotter Route'
  }, [trip.phase, trip.analysis])

  // Route summary labels on the map ("A · 7h 33m · 435 mi", the safest one highlighted).
  useEffect(() => {
    if (!map || trip.phase !== 'results' || !trip.plan || !trip.analysis) return
    const best = trip.analysis.recommendation
    map.setRouteLabels(
      trip.plan.routes.map((r) => ({
        id: r.id,
        text: `${r.id} · ${formatDuration(r.duration_s)} · ${formatMiles(miles(r.distance_m))}${r.id === best.route_id && !best.all_blocked ? '\nSAFEST' : ''}`,
        highlight: r.id === best.route_id,
      })),
    )
  }, [map, trip.phase, trip.plan, trip.analysis])

  const selectedRoute = trip.plan?.routes.find((r) => r.id === trip.selected)

  return (
    <main className="app">
      <div ref={mapEl} className="map" aria-label="Map. Click to set points, right-click for options." role="application" />

      <header className="topbar">
        <a className="brand" href="/" aria-label="Spotter Route home">
          <span className="brand-mark"><Truck size={16} /></span>
          Spotter Route
        </a>
        <button type="button" className="square-btn" aria-label="How it works" onClick={() => setHowOpen(true)}>
          <CircleHelp size={16} />
        </button>
      </header>

      {activePick && trip.phase === 'plan' && (
        <div className="map-hint" role="status">
          Click the map to set {activePick === 'origin' ? 'the origin' : 'the destination'}
        </div>
      )}

      <div className="side">
        {trip.phase === 'plan' && (
          <PlanPanel
            trip={trip}
            pickKind={activePick}
            locating={locating}
            originInputRef={originInput}
            onPoint={setPoint}
            onTogglePick={(kind) => setPick(pick === kind ? null : kind)}
            onUseLocation={useMyLocation}
            onSwap={() => dispatch({ type: 'swap' })}
            onDeparture={(mode, date) => dispatch({ type: 'set-departure', mode, date })}
            onLoad={(lb) => dispatch({ type: 'set-load', lb })}
            onInterval={(interval) => dispatch({ type: 'set-interval', interval })}
            onSubmit={submit}
          />
        )}
        {trip.phase === 'search' && trip.search && (
          <SearchPanel trip={trip} onCancel={cancel} onRetry={retry} onEdit={cancel} />
        )}
        {trip.phase === 'results' && trip.plan && trip.analysis && (
          <ResultsPanel
            trip={trip}
            onEdit={cancel}
            onSelect={(id) => dispatch({ type: 'select', routeId: id })}
            onHover={(id) => dispatch({ type: 'hover', routeId: id })}
            onInterval={(i) => void changeInterval(i)}
            onFocusCheckpoint={(routeId, index) => map?.focusCheckpoint(routeId, index)}
            onDepartLater={() => {
              const later = new Date(Date.parse(trip.plan!.departure_time) + 6 * 3_600_000)
              const next = { ...trip, departureMode: 'custom' as const, departure: later }
              dispatch({ type: 'set-departure', mode: 'custom', date: later })
              void startSearch(next)
            }}
          />
        )}
      </div>

      {trip.phase === 'results' && trip.plan && (
        <>
          <ForecastBar
            key={trip.plan.plan_id}
            map={map}
            heatmap={trip.heatmap}
            departure={trip.plan.departure_time}
            route={selectedRoute}
            generatedAt={trip.analysis?.generated_at}
          />
          <Legend loadLb={trip.plan.load_weight_lb} />
        </>
      )}

      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} />
    </main>
  )
}

function asApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, 'internal_error', 'Something went wrong. Please try again.')
}

function validate(trip: TripState): TripState['formError'] {
  if (!trip.origin) return { field: 'origin', message: 'Choose an origin from the list, use your location, or click the map.' }
  if (!trip.destination) return { field: 'destination', message: 'Choose a destination from the list or click the map.' }
  if (trip.loadLb < LOAD_MIN || trip.loadLb > LOAD_MAX) {
    return { field: 'load', message: `Load must be between ${LOAD_MIN.toLocaleString('en-US')} and ${LOAD_MAX.toLocaleString('en-US')} lb.` }
  }
  if (trip.departureMode === 'custom') {
    const t = trip.departure.getTime()
    if (t < Date.now() - 15 * 60_000) return { field: 'departure', message: 'Departure time is in the past.' }
    if (t > Date.now() + MAX_DEPARTURE_DAYS * 86_400_000) return { field: 'departure', message: 'Departure must be within 7 days.' }
  }
  return null
}
