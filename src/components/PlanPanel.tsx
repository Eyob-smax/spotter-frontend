import { ArrowRight, ArrowUpDown, CalendarClock, Info, Weight } from 'lucide-react'
import { useState } from 'react'
import type { Interval, Place } from '../api/types'
import { timeZoneLabel, toLocalInput } from '../lib/format'
import type { TripState } from '../state/trip'
import { PlaceField } from './PlaceField'
import { Segmented } from './Segmented'

export const LOAD_MIN = 1_000
export const LOAD_MAX = 120_000
export const MAX_DEPARTURE_DAYS = 7
const LOAD_PRESETS = [20_000, 30_000, 40_000, 80_000]

interface Props {
  trip: TripState
  pickKind: 'origin' | 'destination' | null
  locating: 'origin' | 'destination' | null
  originInputRef: React.Ref<HTMLInputElement>
  onPoint: (kind: 'origin' | 'destination', place: Place | null) => void
  onTogglePick: (kind: 'origin' | 'destination') => void
  onUseLocation: (kind: 'origin' | 'destination') => void
  onSwap: () => void
  onDeparture: (mode: 'now' | 'custom', date: Date) => void
  onLoad: (lb: number) => void
  onInterval: (interval: Interval) => void
  onSubmit: () => void
}

export function PlanPanel(props: Props) {
  const { trip } = props
  const err = trip.formError
  // Bounds for the date picker, fixed when the panel opens; chip times are computed on click.
  const [bounds] = useState(() => {
    const now = Date.now()
    return { min: toLocalInput(new Date(now)), max: toLocalInput(new Date(now + MAX_DEPARTURE_DAYS * 86_400_000)) }
  })
  const ready = !!trip.origin && !!trip.destination

  return (
    <form
      className="panel plan"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit()
      }}
    >
      <header className="panel-head">
        <h1>Plan a safe trip</h1>
        <p className="muted">Compare 3 truck routes against the forecast at your arrival time.</p>
      </header>

      <div className="places">
        <div className="places-fields">
          <PlaceField
            kind="origin"
            value={trip.origin}
            near={trip.destination}
            inputRef={props.originInputRef}
            onChange={(p) => props.onPoint('origin', p)}
            picking={props.pickKind === 'origin'}
            onTogglePick={() => props.onTogglePick('origin')}
            onUseLocation={() => props.onUseLocation('origin')}
            locating={props.locating === 'origin'}
            error={err?.field === 'origin' ? err.message : undefined}
          />
          <PlaceField
            kind="destination"
            value={trip.destination}
            near={trip.origin}
            onChange={(p) => props.onPoint('destination', p)}
            picking={props.pickKind === 'destination'}
            onTogglePick={() => props.onTogglePick('destination')}
            onUseLocation={() => props.onUseLocation('destination')}
            locating={props.locating === 'destination'}
            error={err?.field === 'destination' ? err.message : undefined}
          />
        </div>
        <button type="button" className="swap" aria-label="Swap origin and destination" onClick={props.onSwap}>
          <ArrowUpDown size={16} />
        </button>
      </div>

      <fieldset className="group">
        <legend className="eyebrow">
          Departure
          <span className="tip" title="Forecasts beyond 7 days aren’t reliable.">
            <Info size={13} aria-label="Up to 7 days ahead. Forecasts beyond 7 days aren’t reliable." />
          </span>
        </legend>
        <label className={`field${err?.field === 'departure' ? ' invalid' : ''}`}>
          <CalendarClock size={16} className="muted" aria-hidden="true" />
          <span className="sr-only">Departure date and time</span>
          {trip.departureMode === 'now' ? (
            <span className="now-chip">Now</span>
          ) : (
            <input
              type="datetime-local"
              className="mono"
              value={toLocalInput(trip.departure)}
              min={bounds.min}
              max={bounds.max}
              onChange={(e) => e.target.value && props.onDeparture('custom', new Date(e.target.value))}
            />
          )}
        </label>
        <div className="chips">
          <Chip on={trip.departureMode === 'now'} onClick={() => props.onDeparture('now', new Date())}>Now</Chip>
          <Chip on={false} onClick={() => props.onDeparture('custom', inHours(3))}>+3h</Chip>
          <Chip on={false} onClick={() => props.onDeparture('custom', tomorrowAt(6))}>Tomorrow 6:00</Chip>
          <Chip on={trip.departureMode === 'custom'} onClick={() => props.onDeparture('custom', trip.departureMode === 'custom' ? trip.departure : inHours(3))}>
            Custom
          </Chip>
        </div>
        {err?.field === 'departure' && <p className="field-error" role="alert">{err.message}</p>}
        <p className="hint">Times shown in your local time, {timeZoneLabel()}</p>
      </fieldset>

      <fieldset className="group">
        <legend className="eyebrow">Load</legend>
        <label className={`field${err?.field === 'load' ? ' invalid' : ''}`}>
          <Weight size={16} className="muted" aria-hidden="true" />
          <span className="sr-only">Load weight in pounds</span>
          <input
            type="text"
            inputMode="numeric"
            className="mono load-input"
            value={trip.loadLb ? trip.loadLb.toLocaleString('en-US') : ''}
            onChange={(e) => props.onLoad(Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
          />
          <span className="muted">lb</span>
        </label>
        <div className="chips">
          {LOAD_PRESETS.map((lb) => (
            <Chip key={lb} mono on={trip.loadLb === lb} onClick={() => props.onLoad(lb)}>
              {lb / 1000}k
            </Chip>
          ))}
        </div>
        {err?.field === 'load' && <p className="field-error" role="alert">{err.message}</p>}
        <LoadHints lb={trip.loadLb} />
      </fieldset>

      <div className="row-between">
        <span className="eyebrow">Checkpoint every</span>
        <Segmented
          label="Checkpoint interval"
          value={trip.interval}
          options={[10, 25, 50] as Interval[]}
          format={(v) => `${v} mi`}
          onChange={props.onInterval}
        />
      </div>

      <div className="submit">
        {err?.field === 'form' && <p className="field-error" role="alert">{err.message}</p>}
        <button type="submit" className="btn-primary" aria-disabled={!ready}>
          Find safest route <ArrowRight size={16} aria-hidden="true" />
        </button>
        <p className="hint">Tip: click or right-click the map to set points.</p>
      </div>
    </form>
  )
}

function inHours(hours: number): Date {
  const d = new Date(Date.now() + hours * 3_600_000)
  d.setSeconds(0, 0)
  return d
}

function tomorrowAt(hour: number): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hour, 0)
}

function LoadHints({ lb }: { lb: number }) {
  const rules = [
    { over: 40_000, text: <>winds <b className="mono">35–44 mph</b> become Severe</> },
    { over: 30_000, text: <>winds <b className="mono">45–54 mph</b> become No Travel</> },
  ].filter((r) => lb > r.over)
  if (rules.length === 0) return null
  return (
    <div className="load-hints">
      {rules.map((r) => (
        <p key={r.over}>
          Above <b className="mono">{r.over.toLocaleString('en-US')} lb</b>: {r.text}
        </p>
      ))}
    </div>
  )
}

function Chip({ on, mono, onClick, children }: { on: boolean; mono?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`chip${on ? ' on' : ''}${mono ? ' mono' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}
