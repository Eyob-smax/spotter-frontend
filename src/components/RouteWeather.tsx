import { useMemo, useRef, useState } from 'react'
import type { Checkpoint, Route } from '../api/types'
import { formatDayTime, formatMiles, miles } from '../lib/format'
import { RISK_COLOR, RISK_LABEL } from '../lib/risk'
import { routeConditions } from '../lib/summary'
import { Segmented } from './Segmented'

// ---------------------------------------------------------------- chart definitions

type MetricId = 'risk' | 'wind' | 'precip' | 'temp' | 'visibility' | 'chance'

interface Series {
  label: string
  pick: (c: Checkpoint) => number | null | undefined
  kind: 'line' | 'dash' | 'bar' | 'bar-light'
}

interface Metric {
  label: string
  unit: string
  series: Series[]
  /** Reference lines: risk thresholds or practical limits. */
  thresholds: { value: number; label: string }[]
  domain: (values: number[]) => [number, number]
  format: (v: number) => string
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step

const METRICS: Record<MetricId, Metric> = {
  risk: {
    label: 'Risk',
    unit: 'score 0–4',
    series: [{ label: 'Risk score', pick: (c) => c.score, kind: 'line' }],
    thresholds: [
      { value: 1, label: 'Moderate' },
      { value: 2, label: 'High' },
      { value: 3, label: 'Severe' },
      { value: 4, label: 'No Travel' },
    ],
    domain: () => [0, 4],
    format: (v) => v.toFixed(2),
  },
  wind: {
    label: 'Wind',
    unit: 'mph',
    series: [
      { label: 'Wind', pick: (c) => c.weather?.wind_mph, kind: 'line' },
      { label: 'Gusts', pick: (c) => c.weather?.gust_mph, kind: 'dash' },
    ],
    thresholds: [
      { value: 25, label: 'Moderate' },
      { value: 35, label: 'High' },
      { value: 45, label: 'Severe' },
      { value: 55, label: 'No Travel' },
    ],
    domain: (v) => [0, ceilTo(Math.max(30, ...v) * 1.15, 5)],
    format: (v) => `${Math.round(v)} mph`,
  },
  precip: {
    label: 'Rain & snow',
    unit: 'in/hr',
    series: [
      { label: 'Rain', pick: (c) => c.weather?.rain_in_hr, kind: 'bar' },
      { label: 'Snow', pick: (c) => c.weather?.snow_in_hr, kind: 'bar-light' },
    ],
    thresholds: [
      { value: 0.1, label: 'Rain Moderate' },
      { value: 0.25, label: 'Rain High' },
      { value: 0.5, label: 'Rain Severe · Snow Moderate' },
      { value: 1, label: 'Snow High' },
      { value: 2, label: 'Snow Severe' },
    ],
    domain: (v) => [0, Math.max(0.15, ...v) * 1.2],
    format: (v) => `${v.toFixed(2)} in/hr`,
  },
  temp: {
    label: 'Temp',
    unit: '°F',
    series: [{ label: 'Temperature', pick: (c) => c.weather?.temperature_f, kind: 'line' }],
    thresholds: [{ value: 32, label: 'Freezing (ice risk)' }],
    domain: (v) => (v.length ? [Math.floor(Math.min(...v, 32) / 10) * 10 - 5, ceilTo(Math.max(...v) + 5, 10)] : [20, 80]),
    format: (v) => `${Math.round(v)}°F`,
  },
  visibility: {
    label: 'Visibility',
    unit: 'mi',
    series: [{ label: 'Visibility', pick: (c) => c.weather?.visibility_mi, kind: 'line' }],
    thresholds: [
      { value: 1, label: 'Poor (< 1 mi)' },
      { value: 0.25, label: 'Fog (< ¼ mi)' },
    ],
    domain: (v) => [0, ceilTo(Math.max(10, ...v), 5)],
    format: (v) => `${v.toFixed(1)} mi`,
  },
  chance: {
    label: 'Precip %',
    unit: '%',
    series: [{ label: 'Chance of precipitation', pick: (c) => c.weather?.precip_probability, kind: 'bar' }],
    thresholds: [{ value: 50, label: '50%' }],
    domain: () => [0, 100],
    format: (v) => `${Math.round(v)}%`,
  },
}
const METRIC_ORDER: MetricId[] = ['risk', 'wind', 'precip', 'temp', 'visibility', 'chance']

// ---------------------------------------------------------------- component

interface Props {
  route: Route
  checkpoints: Checkpoint[]
  onFocus: (index: number) => void
}

const W = 360
const H = 140
const PAD = { left: 34, right: 8, top: 10, bottom: 22 }

/** Everything about the weather the truck meets on one route, at its ETA at each checkpoint. */
export function RouteWeather({ route, checkpoints, onFocus }: Props) {
  const [metricId, setMetricId] = useState<MetricId>('wind')
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const total = Math.max(miles(route.distance_m), 1)
  const wx = useMemo(() => routeConditions(checkpoints), [checkpoints])
  const metric = METRICS[metricId]

  const values = metric.series.flatMap((s) => checkpoints.map(s.pick).filter((v): v is number => v != null))
  const [yMin, yMax] = metric.domain(values)
  const x = (mile: number) => PAD.left + (mile / total) * (W - PAD.left - PAD.right)
  const y = (v: number) => H - PAD.bottom - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom)
  const barW = Math.max(2, Math.min(10, ((W - PAD.left - PAD.right) / Math.max(checkpoints.length, 1)) * 0.35))

  const focused = checkpoints.find((c) => c.index === hover) ?? wx.worst ?? checkpoints[0]

  /** Checkpoint nearest to a pointer position over the chart. */
  const nearestAt = (clientX: number): Checkpoint | null => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || checkpoints.length === 0) return null
    const mile = ((((clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * total
    let best = checkpoints[0]
    for (const c of checkpoints) if (Math.abs(c.mile - mile) < Math.abs(best.mile - mile)) best = c
    return best
  }

  return (
    <section className="route-weather" aria-label={`Weather along Route ${route.id}`}>
      <div className="row-between">
        <span className="eyebrow">Weather along Route {route.id}</span>
        <span className="hint">at the truck’s ETA · {checkpoints.length} checkpoints</span>
      </div>

      <dl className="wx-grid">
        <Tile k="Max wind" v={wx.maxWind == null ? '—' : `${Math.round(wx.maxWind)} mph`} sub={wx.maxGust == null ? undefined : `gusts ${Math.round(wx.maxGust)}`} />
        <Tile k="Max rain" v={wx.maxRain == null ? '—' : `${wx.maxRain.toFixed(2)}`} sub="in/hr" />
        <Tile k="Max snow" v={wx.maxSnow == null ? '—' : `${wx.maxSnow.toFixed(2)}`} sub="in/hr" />
        <Tile k="Rain/snow chance" v={wx.maxPrecipChance == null ? '—' : `${Math.round(wx.maxPrecipChance)}%`} sub="highest" />
        <Tile k="Temperature" v={wx.minTemp == null ? '—' : `${Math.round(wx.minTemp)}–${Math.round(wx.maxTemp ?? wx.minTemp)}°F`} sub={wx.minTemp != null && wx.minTemp <= 32 ? 'freezing on route' : undefined} />
        <Tile k="Min visibility" v={wx.minVisibility == null ? '—' : `${wx.minVisibility.toFixed(1)} mi`} />
      </dl>

      {wx.conditions.length > 0 && (
        <div className="conditions-mix" aria-label="Conditions along the route by distance">
          <div className="mix-bar">
            {wx.conditions.map((c, i) => (
              <span key={c.label} style={{ flexGrow: c.miles, opacity: 1 - i * 0.18 }} title={`${c.label}: ${formatMiles(c.miles)}`} />
            ))}
          </div>
          <p className="hint">
            {wx.conditions.slice(0, 4).map((c, i) => (
              <span key={c.label}>
                {i > 0 && ' · '}
                {c.label} <span className="mono">{Math.round((c.miles / total) * 100)}%</span>
              </span>
            ))}
          </p>
        </div>
      )}

      <Segmented label="Weather chart" value={metricId} options={METRIC_ORDER} format={(m) => METRICS[m].label} onChange={setMetricId} />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="wx-chart"
        role="img"
        aria-label={`${metric.label} along Route ${route.id}`}
        onPointerMove={(e) => setHover(nearestAt(e.clientX)?.index ?? null)}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const cp = nearestAt(e.clientX) // from the click itself, not the last hover
          if (cp) onFocus(cp.index)
        }}
      >
        {metric.thresholds
          .filter((t) => t.value > yMin && t.value <= yMax)
          .map((t) => (
            <g key={t.label}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t.value)} y2={y(t.value)} className="threshold" />
              <text x={W - PAD.right} y={y(t.value) - 3} textAnchor="end" className="threshold-label">{t.label}</text>
            </g>
          ))}
        {[yMin, (yMin + yMax) / 2, yMax].map((v) => (
          <text key={v} x={PAD.left - 5} y={y(v) + 3} textAnchor="end" className="axis">
            {metricId === 'precip' ? v.toFixed(2) : Math.round(v)}
          </text>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="axis-line" />

        {metric.series.map((s, si) =>
          s.kind.startsWith('bar') ? (
            <g key={s.label}>
              {checkpoints.map((c) => {
                const v = s.pick(c)
                if (v == null || v <= 0) return null
                const offset = metric.series.length > 1 ? (si - 0.5) * barW : 0
                return <rect key={c.index} x={x(c.mile) - barW / 2 + offset} y={y(v)} width={barW} height={H - PAD.bottom - y(v)} className={s.kind} />
              })}
            </g>
          ) : (
            <path key={s.label} d={path(checkpoints, s.pick, x, y)} className={s.kind === 'dash' ? 'series-dash' : 'series-line'} />
          ),
        )}
        {metricId !== 'precip' && metricId !== 'chance' &&
          checkpoints.map((c) => {
            const v = metric.series[0].pick(c)
            return v == null ? null : <circle key={c.index} cx={x(c.mile)} cy={y(v)} r={c.index === focused?.index ? 4.5 : 3} fill={RISK_COLOR[c.risk]} className="wx-dot" />
          })}
        {focused && <line x1={x(focused.mile)} x2={x(focused.mile)} y1={PAD.top} y2={H - PAD.bottom} className="crosshair" />}
        <text x={PAD.left} y={H - 6} className="axis">0 mi</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="axis">{Math.round(total)} mi</text>
      </svg>
      <p className="hint chart-legend">
        {metric.series.map((s) => (
          <span key={s.label} className="legend-item">
            <span className={`key key-${s.kind}`} /> {s.label}
          </span>
        ))}
        <span className="legend-item">{metric.unit}</span>
        <span className="legend-item">· hover to inspect, click to show on map</span>
      </p>

      {focused && <Readout cp={focused} total={total} />}

      <div className="cp-table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th scope="col">Mile</th>
              <th scope="col">ETA</th>
              <th scope="col">Wind</th>
              <th scope="col">Rain</th>
              <th scope="col">Snow</th>
              <th scope="col">°F</th>
              <th scope="col">Risk</th>
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((c) => (
              <tr
                key={c.index}
                tabIndex={0}
                className={c.index === focused?.index ? 'active' : undefined}
                onMouseEnter={() => setHover(c.index)}
                onClick={() => onFocus(c.index)}
                onKeyDown={(e) => e.key === 'Enter' && onFocus(c.index)}
                title={c.weather?.conditions ?? 'Show on map'}
              >
                <td className="mono">{Math.round(c.mile)}</td>
                <td className="mono">{formatDayTime(c.eta)}</td>
                <td className="mono">
                  {c.weather ? Math.round(c.weather.wind_mph) : '—'}
                  {c.weather?.gust_mph != null && <span className="muted">/{Math.round(c.weather.gust_mph)}</span>}
                </td>
                <td className="mono">{c.weather ? c.weather.rain_in_hr.toFixed(2) : '—'}</td>
                <td className="mono">{c.weather ? c.weather.snow_in_hr.toFixed(2) : '—'}</td>
                <td className="mono">{c.weather?.temperature_f != null ? Math.round(c.weather.temperature_f) : '—'}</td>
                <td>
                  <span className="risk-pill" style={{ background: RISK_COLOR[c.risk] }}>{RISK_LABEL[c.risk]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Wind mph (sustained/gusts) · rain and snow in/hr · click a row to see it on the map</p>
    </section>
  )
}

function path(
  checkpoints: Checkpoint[],
  pick: (c: Checkpoint) => number | null | undefined,
  x: (mile: number) => number,
  y: (v: number) => number,
): string {
  let d = ''
  let pen = false
  for (const c of checkpoints) {
    const v = pick(c)
    if (v == null) {
      pen = false // gap where the forecast is missing
      continue
    }
    d += `${pen ? 'L' : 'M'}${x(c.mile).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  }
  return d
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="wx-tile">
      <dt>{k}</dt>
      <dd>
        <span className="mono">{v}</span>
        {sub && <span className="muted"> {sub}</span>}
      </dd>
    </div>
  )
}

/** Everything known about one checkpoint, shown under the chart. */
function Readout({ cp, total }: { cp: Checkpoint; total: number }) {
  const w = cp.weather
  return (
    <div className="readout">
      <div className="row-between">
        <strong>
          Mile {Math.round(cp.mile)} <span className="muted">of {Math.round(total)}</span> · {formatDayTime(cp.eta)}
        </strong>
        <span className="risk-pill" style={{ background: RISK_COLOR[cp.risk] }}>{RISK_LABEL[cp.risk]}</span>
      </div>
      {w ? (
        <>
          <p className="readout-conditions">{w.conditions ?? 'Conditions unavailable'}</p>
          <dl className="readout-grid">
            <dt>Wind</dt>
            <dd className="mono">{Math.round(w.wind_mph)} mph{w.gust_mph != null && ` · gusts ${Math.round(w.gust_mph)}`}</dd>
            <dt>Rain</dt>
            <dd className="mono">{w.rain_in_hr.toFixed(2)} in/hr</dd>
            <dt>Snow</dt>
            <dd className="mono">{w.snow_in_hr.toFixed(2)} in/hr</dd>
            <dt>Temp</dt>
            <dd className="mono">{w.temperature_f == null ? '—' : `${Math.round(w.temperature_f)}°F`}</dd>
            <dt>Visibility</dt>
            <dd className="mono">{w.visibility_mi == null ? '—' : `${w.visibility_mi.toFixed(1)} mi`}</dd>
            <dt>Precip</dt>
            <dd className="mono">{w.precip_probability == null ? '—' : `${Math.round(w.precip_probability)}% chance`}</dd>
            <dt>Score</dt>
            <dd className="mono">{cp.score == null ? '—' : `${cp.score.toFixed(2)} / 4`}</dd>
          </dl>
          {cp.factors.some((f) => f.decisive) && (
            <p className="hint">Set by: {cp.factors.filter((f) => f.decisive).map((f) => f.message).join('; ')}</p>
          )}
        </>
      ) : (
        <p className="hint">Forecast not available for this time.</p>
      )}
    </div>
  )
}
