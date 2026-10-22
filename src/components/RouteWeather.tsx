import type { Checkpoint, Route } from '../api/types'
import { formatDayTime, miles } from '../lib/format'
import { RISK_COLOR, RISK_LABEL } from '../lib/risk'

const W = 360
const H = 128
const PAD = { left: 30, right: 8, top: 10, bottom: 20 }
const WIND_BANDS = [
  { mph: 25, label: 'Moderate' },
  { mph: 35, label: 'High' },
  { mph: 45, label: 'Severe' },
  { mph: 55, label: 'No Travel' },
]

interface Props {
  route: Route
  checkpoints: Checkpoint[]
  onFocus: (index: number) => void
}

/** Wind profile and per-checkpoint conditions for the selected route, at the truck's ETA. */
export function RouteWeather({ route, checkpoints, onFocus }: Props) {
  const total = miles(route.distance_m)
  const known = checkpoints.filter((c) => c.weather)
  const peak = Math.max(10, ...known.map((c) => c.weather!.gust_mph ?? c.weather!.wind_mph))
  const yMax = Math.ceil(Math.max(30, peak * 1.15) / 5) * 5
  const x = (mile: number) => PAD.left + (mile / Math.max(total, 1)) * (W - PAD.left - PAD.right)
  const y = (mph: number) => H - PAD.bottom - (mph / yMax) * (H - PAD.top - PAD.bottom)
  const line = (pick: (c: Checkpoint) => number | null | undefined) =>
    known
      .map((c) => [c.mile, pick(c)] as const)
      .filter(([, v]) => v != null)
      .map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v as number).toFixed(1)}`)
      .join(' ')
  const wet = known.some((c) => c.weather!.rain_in_hr > 0 || c.weather!.snow_in_hr > 0)

  return (
    <section className="route-weather" aria-label={`Weather along Route ${route.id}`}>
      <div className="row-between">
        <span className="eyebrow">Weather along Route {route.id}</span>
        <span className="hint">at the truck’s ETA</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="wind-chart" role="img" aria-label={`Wind speed along Route ${route.id}; peak gust ${Math.round(peak)} mph`}>
        {WIND_BANDS.filter((b) => b.mph <= yMax).map((b) => (
          <g key={b.mph}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(b.mph)} y2={y(b.mph)} className="threshold" />
            <text x={W - PAD.right} y={y(b.mph) - 3} textAnchor="end" className="threshold-label">{b.mph} mph · {b.label}</text>
          </g>
        ))}
        {[0, yMax / 2, yMax].map((v) => (
          <text key={v} x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="axis">{Math.round(v)}</text>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="axis-line" />
        <path d={line((c) => c.weather!.gust_mph)} className="gust-line" />
        <path d={line((c) => c.weather!.wind_mph)} className="wind-line" />
        {known.map((c) => (
          <circle key={c.index} cx={x(c.mile)} cy={y(c.weather!.wind_mph)} r={3.2} fill={RISK_COLOR[c.risk]} className="wind-dot">
            <title>{`Mile ${Math.round(c.mile)} · ${formatDayTime(c.eta)} · wind ${Math.round(c.weather!.wind_mph)} mph · ${RISK_LABEL[c.risk]}`}</title>
          </circle>
        ))}
        <text x={PAD.left} y={H - 4} className="axis">0 mi</text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="axis">{Math.round(total)} mi</text>
      </svg>
      <p className="hint chart-legend">
        <span className="key key-wind" /> Wind <span className="key key-gust" /> Gusts · dots coloured by risk
        {!wet && ' · no rain or snow forecast on this route'}
      </p>

      <div className="cp-table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th scope="col">Mile</th>
              <th scope="col">ETA</th>
              <th scope="col">Wind</th>
              <th scope="col">Rain</th>
              <th scope="col">Snow</th>
              <th scope="col">Risk</th>
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((c) => (
              <tr key={c.index} tabIndex={0} onClick={() => onFocus(c.index)} onKeyDown={(e) => e.key === 'Enter' && onFocus(c.index)} title="Show on map">
                <td className="mono">{Math.round(c.mile)}</td>
                <td className="mono">{formatDayTime(c.eta)}</td>
                <td className="mono">
                  {c.weather ? `${Math.round(c.weather.wind_mph)}` : '—'}
                  {c.weather?.gust_mph != null && <span className="muted"> /{Math.round(c.weather.gust_mph)}</span>}
                </td>
                <td className="mono">{c.weather ? c.weather.rain_in_hr.toFixed(2) : '—'}</td>
                <td className="mono">{c.weather ? c.weather.snow_in_hr.toFixed(2) : '—'}</td>
                <td>
                  <span className="risk-pill" style={{ background: RISK_COLOR[c.risk] }}>{RISK_LABEL[c.risk]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Wind in mph (sustained / gusts) · rain and snow in in/hr · click a row to see it on the map</p>
    </section>
  )
}
