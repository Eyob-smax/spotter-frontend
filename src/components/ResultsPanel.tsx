import { ArrowLeft, Check, ChevronDown, CircleSlash, Info, MessageSquareText, Route as RouteIcon, Star, Wind } from 'lucide-react'
import { useState } from 'react'
import type { Analysis, Criterion, Interval, Route } from '../api/types'
import { formatDayTime, formatDuration, formatExtra, formatMiles, formatTime, miles } from '../lib/format'
import { RISK_LABEL } from '../lib/risk'
import { riskSegments } from '../lib/route'
import { averageSpeed, routeConditions, routeNote } from '../lib/summary'
import type { TripState } from '../state/trip'
import { RouteWeather } from './RouteWeather'
import { Segmented } from './Segmented'
import { TripHeader } from './TripHeader'

interface Props {
  trip: TripState
  onEdit: () => void
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onInterval: (interval: Interval) => void
  onDepartLater: () => void
  onFocusCheckpoint: (routeId: string, index: number) => void
}

const CRITERIA: { id: Criterion; label: string; format: (v: number | null) => string }[] = [
  { id: 'no_travel_mi', label: 'No Travel mi', format: (v) => formatMiles(v ?? 0).replace(' mi', '') },
  { id: 'severe_mi', label: 'Severe mi', format: (v) => formatMiles(v ?? 0).replace(' mi', '') },
  { id: 'high_mi', label: 'High mi', format: (v) => formatMiles(v ?? 0).replace(' mi', '') },
  { id: 'avg_risk', label: 'Avg risk', format: (v) => (v == null ? '—' : v.toFixed(2)) },
  { id: 'duration_s', label: 'Travel time', format: (v) => formatDuration(v ?? 0) },
]

export function ResultsPanel({ trip, onEdit, onSelect, onHover, onInterval, onDepartLater, onFocusCheckpoint }: Props) {
  const [why, setWhy] = useState(false)
  const plan = trip.plan!
  const analysis = trip.analysis!
  const rec = analysis.recommendation
  const byId = new Map(plan.routes.map((r) => [r.id, r]))
  const summaries = new Map(analysis.routes.map((r) => [r.id, r]))
  const fastest = Math.min(...plan.routes.map((r) => r.duration_s))
  const ordered = rec.ranking.map((id) => byId.get(id)!).filter(Boolean)
  const notices = [...plan.notices, ...analysis.notices]
  const totalCheckpoints = analysis.routes.reduce((n, r) => n + r.summary.checkpoint_count, 0)
  // Time spent waiting on the server (routes + weather), not animation time.
  const elapsed = (trip.search?.durations.routes ?? 0) + (trip.search?.durations.weather ?? 0)

  return (
    <section className="panel results" aria-label="Route results">
      <TripHeader
        trip={trip}
        leading={
          <button type="button" className="square-btn" aria-label="Edit trip" onClick={onEdit}>
            <ArrowLeft size={16} />
          </button>
        }
      />
      <hr />

      {rec.all_blocked ? (
        <div className="blocked-box" aria-live="polite">
          <CircleSlash size={20} className="nt" aria-hidden="true" />
          <div>
            <h2 tabIndex={-1}>Every route crosses No-Travel conditions at this departure time.</h2>
            <p className="muted">
              Route {rec.route_id} is the least bad ({formatMiles(summaries.get(rec.route_id)!.summary.no_travel_mi)} of No-Travel
              conditions), but it still isn’t safe to drive.
            </p>
            <button type="button" className="btn-primary compact" onClick={onDepartLater}>Try departing 6 hours later</button>
          </div>
        </div>
      ) : (
        <div className="recommendation" aria-live="polite">
          <span className="eyebrow">Recommendation</span>
          <h2 tabIndex={-1}>Route {rec.route_id} is the safest choice</h2>
          <p className="muted">{rec.reason}</p>
        </div>
      )}

      <button type="button" className="pill-btn why-btn" aria-expanded={why} onClick={() => setWhy(!why)}>
        Why this route? <ChevronDown size={14} className={why ? 'flip' : undefined} aria-hidden="true" />
      </button>
      {why && <WhyTable analysis={analysis} routes={plan.routes} />}

      {notices.map((n) => (
        <p key={n} className="notice">
          <Info size={15} aria-hidden="true" /> <span>{n}</span>
        </p>
      ))}

      <div className="cards">
        {ordered.map((route) => {
          const result = summaries.get(route.id)!
          const s = result.summary
          const selected = trip.selected === route.id
          const extra = route.duration_s - fastest
          const wx = routeConditions(result.checkpoints)
          const note = routeNote(route.id, plan.routes, analysis)
          return (
            <button
              key={route.id}
              type="button"
              className={`card${selected ? ' selected' : ''}${trip.hovered === route.id && !selected ? ' hovered' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(route.id)}
              onMouseEnter={() => onHover(route.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(route.id)}
              onBlur={() => onHover(null)}
            >
              <span className="card-head">
                <span className="letter">{route.id}</span>
                <span className="card-name">{route.name}</span>
                <span className="grow" />
                {route.id === rec.route_id && !rec.all_blocked && (
                  <span className="badge badge-safe"><Star size={11} fill="currentColor" aria-hidden="true" /> SAFEST</span>
                )}
                {s.blocked && <span className="badge badge-blocked"><CircleSlash size={11} aria-hidden="true" /> BLOCKED</span>}
                <span className="badge">{extra < 60 ? 'Fastest' : formatExtra(extra)}</span>
                {route.source === 'tomtom_via' && (
                  <span className="badge" title="Generated through a waypoint because the routing service returned fewer than 3 distinct routes.">
                    <RouteIcon size={11} aria-hidden="true" /> Detour
                  </span>
                )}
              </span>
              <span className="mono muted small">
                {formatDuration(route.duration_s)} · {formatMiles(miles(route.distance_m))} · avg {Math.round(averageSpeed(route))} mph
              </span>
              <span className="mono muted small">
                departs {formatDayTime(route.departure_time)} → arrives {formatDayTime(route.arrival_time)}
              </span>
              <span className="strip" aria-hidden="true">
                {riskSegments(result.checkpoints).map((seg, i) => (
                  <span key={i} style={{ flexGrow: seg.weight, background: seg.color }} />
                ))}
              </span>
              <span className="stats">
                {s.no_travel_mi > 0 && <Stat strong label="No Travel" value={formatMiles(s.no_travel_mi)} />}
                <Stat label="Severe" value={formatMiles(s.severe_mi)} />
                <Stat label="High" value={formatMiles(s.high_mi)} />
                <Stat label="Avg risk" value={s.avg_risk == null ? '—' : s.avg_risk.toFixed(2)} />
                {s.unknown_count > 0 && <Stat label="No forecast" value={`${s.unknown_count} pts`} />}
              </span>
              {wx.maxWind != null && (
                <span className="conditions">
                  <Wind size={13} aria-hidden="true" />
                  <span>
                    Max wind <b className="mono">{Math.round(wx.maxWind)} mph</b>
                    {wx.maxGust != null && <> (gusts <b className="mono">{Math.round(wx.maxGust)}</b>)</>} · rain{' '}
                    <b className="mono">{(wx.maxRain ?? 0).toFixed(2)}</b> · snow <b className="mono">{(wx.maxSnow ?? 0).toFixed(2)}</b> in/hr
                    {wx.worst && (
                      <>
                        {' '}· worst: <b>{RISK_LABEL[wx.worst.risk]}</b> at mile {Math.round(wx.worst.mile)} ({formatTime(wx.worst.eta)})
                      </>
                    )}
                  </span>
                </span>
              )}
              <span className={`route-note${route.id === rec.route_id ? ' best' : ''}`}>
                <MessageSquareText size={13} aria-hidden="true" />
                <span>{note}</span>
              </span>
            </button>
          )
        })}
      </div>

      {trip.selected && byId.get(trip.selected) && summaries.get(trip.selected) && (
        <RouteWeather
          route={byId.get(trip.selected)!}
          checkpoints={summaries.get(trip.selected)!.checkpoints}
          onFocus={(index) => onFocusCheckpoint(trip.selected!, index)}
        />
      )}

      <div className="row-between">
        <span className="eyebrow">Checkpoints every</span>
        <Segmented
          label="Checkpoint interval"
          value={trip.interval}
          options={[10, 25, 50] as Interval[]}
          format={(v) => `${v} mi`}
          onChange={onInterval}
          disabled={trip.reanalyzing}
        />
      </div>
      <p className="hint row-gap">
        <Check size={14} aria-hidden="true" />
        {trip.reanalyzing
          ? 'Re-checking weather…'
          : `Analyzed ${plan.routes.length} routes · ${totalCheckpoints} checkpoints${elapsed ? ` · ${(elapsed / 1000).toFixed(1)} s` : ''}`}
      </p>
      {trip.heatmapError && <p className="hint">{trip.heatmapError}</p>}
    </section>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={strong ? 'stat strong' : 'stat'}>
      {label} <span className="mono">{value}</span>
    </span>
  )
}

function WhyTable({ analysis, routes }: { analysis: Analysis; routes: Route[] }) {
  const rec = analysis.recommendation
  const rows = new Map(rec.comparison.map((c) => [c.route_id, c]))
  const ids = routes.map((r) => r.id)
  return (
    <div className="why">
      <table>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Criterion</span></th>
            {ids.map((id) => (
              <th key={id} scope="col" className={id === rec.route_id ? 'win' : undefined}>{id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CRITERIA.map((c) => (
            <tr key={c.id} className={c.id === rec.deciding_factor ? 'decided' : undefined}>
              <th scope="row">
                {c.label}
                {c.id === rec.deciding_factor && <span className="decided-tag">decided here</span>}
              </th>
              {ids.map((id) => (
                <td key={id} className={`mono${id === rec.route_id ? ' win' : ''}`}>{c.format(rows.get(id)?.[c.id] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Ranked by fewest No-Travel miles, then fewest Severe miles, then fewest High miles, then lowest average risk
        (Low 0 → No Travel 4, weighted by miles), then shortest travel time.
        {rec.compared_to && ` The reason compares Route ${rec.route_id} with Route ${rec.compared_to}.`}
      </p>
    </div>
  )
}
