import { Check, Clock, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Route } from '../api/types'
import { formatDayTime, formatLb, miles } from '../lib/format'
import { expectedCheckpoints } from '../lib/route'
import type { Step, TripState } from '../state/trip'
import { TripHeader } from './TripHeader'

const STEPS: { id: Step; label: string; done: string }[] = [
  { id: 'routes', label: 'Finding truck routes', done: 'Found routes' },
  { id: 'weather', label: 'Testing route weather', done: 'Tested route weather' },
  { id: 'scoring', label: 'Scoring risk', done: 'Scored risk' },
  { id: 'choosing', label: 'Choosing the safest route', done: 'Chose the safest route' },
]
const SLOW_AFTER_MS = 8_000

interface Props {
  trip: TripState
  onCancel: () => void
  onRetry: (step: 'routes' | 'weather') => void
  onEdit: () => void
}

const checkpointCount = (route: Route, interval: number) => expectedCheckpoints(miles(route.distance_m), interval)

function foundLabel(routes: Route[]): string {
  const detours = routes.filter((r) => r.source === 'tomtom_via').length
  const direct = routes.length - detours
  if (!detours) return `Found ${routes.length} route${routes.length === 1 ? '' : 's'}`
  return `Found ${direct} route${direct === 1 ? '' : 's'} + ${detours} detour${detours === 1 ? '' : 's'}`
}

export function SearchPanel({ trip, onCancel, onRetry, onEdit }: Props) {
  const search = trip.search!
  const plan = trip.plan
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (search.step !== 'routes' || search.failed) return
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [search.step, search.failed])

  const stepIndex = STEPS.findIndex((s) => s.id === search.step)
  const testingRoute = plan?.routes.find((r) => r.id === search.testing)
  const winner = trip.analysis?.recommendation
  const working = !search.failed && !search.noRoute && search.step !== 'choosing'

  let title: string
  let sub: string
  if (search.noRoute) {
    title = 'No truck route between these points'
    sub = 'There’s no truck-legal road connecting the origin and destination.'
  } else if (search.failed?.step === 'routes') {
    title = 'Couldn’t find routes'
    sub = search.failed.error.message
  } else if (search.failed?.step === 'weather') {
    title = 'Weather check failed'
    sub = `${search.failed.error.message} Your routes are kept, so a retry only re-checks the weather.`
  } else if (search.step === 'routes') {
    title = 'Finding truck routes…'
    sub = `Checking truck-legal roads for ${formatLb(trip.loadLb)} · departing ${trip.departureMode === 'now' ? 'now' : formatDayTime(trip.departure)}`
  } else if (search.step === 'weather') {
    title = testingRoute ? `Testing Route ${testingRoute.id}` : 'Checking the forecast…'
    sub = testingRoute
      ? `Checking weather at ${checkpointCount(testingRoute, trip.interval)} checkpoints ${testingRoute.name.replace(/^via/, 'along')}`
      : 'Fetching the hourly forecast at each truck’s ETA'
  } else if (search.step === 'scoring') {
    title = 'Scoring risk…'
    sub = 'Colouring checkpoints by the forecast at each truck’s ETA'
  } else {
    title = winner ? `Route ${winner.route_id} is the safest choice` : 'Done'
    sub = winner?.reason ?? ''
  }

  return (
    <section className="panel search" aria-busy={working}>
      {working && <div className="progress-sweep" aria-hidden="true"><span /></div>}
      <TripHeader trip={trip} action={working ? <button type="button" className="pill-btn" onClick={onCancel}>Cancel</button> : undefined} />

      <div aria-live="polite" className="search-title">
        <h2 className={working ? 'shimmer' : undefined}>{title}</h2>
        <p className="muted">{sub}</p>
      </div>

      <ol className="steps" aria-label="Search progress">
        {(search.noRoute ? STEPS.slice(0, 1) : STEPS).map((step, i) => {
          const failed = search.failed?.step === step.id || (search.noRoute && i === 0)
          const done = !failed && (i < stepIndex || (search.step === 'choosing' && i === stepIndex))
          const active = !failed && !done && i === stepIndex && working
          const state = failed ? 'failed' : done ? 'done' : active ? 'active' : 'pending'
          const seconds = search.durations[step.id]
          return (
            <li key={step.id} className={`step step-${state}`}>
              <span className="step-mark" aria-hidden="true">
                {state === 'done' && <Check size={12} strokeWidth={3} />}
                {state === 'failed' && <X size={11} strokeWidth={3} />}
              </span>
              <div className="step-body">
                <div className="row-between">
                  <span className="step-label">
                    {step.id === 'routes' && plan && state === 'done' ? foundLabel(plan.routes) : done ? step.done : step.label}
                  </span>
                  {seconds !== undefined && <span className="mono muted small">{(seconds / 1000).toFixed(1)} s</span>}
                </div>
                {step.id === 'weather' && plan && (state === 'active' || state === 'done') && (
                  <div className="route-rows">
                    {plan.routes.map((r) => {
                      const tested = search.tested.includes(r.id)
                      const testing = search.testing === r.id
                      return (
                        <div key={r.id} className={`route-row${testing ? ' testing' : tested ? ' tested' : ''}`}>
                          <span className="letter">{r.id}</span>
                          <span className="grow">{r.name}</span>
                          <span className="mono small">
                            {tested ? `${checkpointCount(r, trip.interval)} ✓` : testing ? 'testing' : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {failed && search.failed && (
                  <button type="button" className="btn-small" onClick={() => onRetry(search.failed!.step)}>
                    <RotateCcw size={13} aria-hidden="true" />
                    {search.failed.step === 'routes' ? 'Retry route search' : 'Retry weather check'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {slow && search.step === 'routes' && working && (
        <p className="reassure muted">
          <Clock size={14} aria-hidden="true" /> Long trips take a little longer to route…
        </p>
      )}

      {(search.noRoute || search.failed?.step === 'routes') && (
        <div className="row-gap">
          <button type="button" className="btn-primary compact" onClick={onEdit}>Edit trip</button>
        </div>
      )}
    </section>
  )
}
