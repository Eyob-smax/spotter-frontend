import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Heatmap, Route } from '../api/types'
import { formatDayTime, formatTime } from '../lib/format'
import { RISK_COLOR } from '../lib/risk'
import { corridorRiskAt } from '../lib/summary'
import type { MapController } from '../map/MapController'

const HOURS = 48
const HOURS_PER_SECOND = 0.5 // playback: one forecast hour every two seconds

interface Props {
  map: MapController | null
  heatmap: Heatmap | null
  departure: string
  route: Route | undefined
  routes: Route[]
  generatedAt: string | undefined
}

/**
 * 0–48 h forecast slider. The hour lives here (not in App) and is pushed straight
 * to the map, so dragging never re-renders the rest of the UI.
 */
export function ForecastBar({ map, heatmap, departure, route, routes, generatedAt }: Props) {
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [heatOn, setHeatOn] = useState(true)
  const hourRef = useRef(0)

  const departureMs = Date.parse(departure)
  const startMs = heatmap ? Date.parse(heatmap.start_time) : Math.floor(departureMs / 3_600_000) * 3_600_000
  // Slider hour at which the last truck reaches its destination.
  const offsetH = (departureMs - startMs) / 3_600_000
  const arrivalHour = Math.min(HOURS, offsetH + Math.max(0, ...routes.map((r) => r.duration_s / 3600)))

  const update = useCallback(
    (h: number) => {
      hourRef.current = h
      setHour(h)
      map?.setForecastHour(h)
    },
    [map],
  )

  // Start at departure. (The parent remounts this component for every new trip.)
  useEffect(() => {
    map?.setForecastHour(0)
  }, [map, heatmap])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const prev = hourRef.current
      const next = prev + ((now - last) / 1000) * HOURS_PER_SECOND
      last = now
      if (prev < arrivalHour && next >= arrivalHour) {
        // Pause when the last truck arrives; pressing play again continues the forecast.
        update(arrivalHour)
        setPlaying(false)
        return
      }
      update(next >= HOURS ? 0 : next)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, update, arrivalHour])

  const shown = startMs + hour * 3_600_000
  const corridor = heatmap ? corridorRiskAt(heatmap.scores, hour) : null
  const allArrived = routes.length > 0 && hour >= arrivalHour - 1e-6
  // Hours since the departure hour (the slider starts at the top of that hour).
  const rel = Math.round(hour)
  const pct = (hour / HOURS) * 100
  const windowLeft = Math.max(0, ((departureMs - startMs) / 3_600_000 / HOURS) * 100)
  const windowWidth = route ? Math.min(100 - windowLeft, (route.duration_s / 3600 / HOURS) * 100) : 0
  const days: { left: number; label: string }[] = []
  for (let h = 0; h <= HOURS; h++) {
    const d = new Date(startMs + h * 3_600_000)
    if (h === 0 || (d.getHours() === 0 && d.getMinutes() === 0)) {
      days.push({ left: (h / HOURS) * 100, label: d.toLocaleDateString(undefined, { weekday: 'short' }) })
    }
  }

  return (
    <section className="forecast" aria-label="Forecast time">
      <button
        type="button"
        className="play"
        aria-label={playing ? 'Pause forecast' : 'Play forecast'}
        onClick={() => setPlaying(!playing)}
      >
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
      <div className="clock">
        <div>
          <span className="mono clock-time">{formatDayTime(shown).toUpperCase()}</span>
          <span className="mono muted small">{rel >= 0 ? `+${rel}h` : `${rel}h`}</span>
        </div>
        <span className="corridor-pill" role="status">
          <i style={{ background: corridor?.level ? RISK_COLOR[corridor.level] : 'var(--text-3)' }} aria-hidden="true" />
          {corridor ? corridor.text : 'Loading forecast…'}
        </span>
        <span className="hint">
          {allArrived ? 'All trucks have arrived · ▶ continues the forecast' : generatedAt ? `Forecast updated ${formatTime(generatedAt)}` : ''}
        </span>
      </div>
      <div className="track-wrap">
        <div className="track" />
        {route && <div className="trip-window" style={{ left: `${windowLeft}%`, width: `${windowWidth}%` }} title="Recommended route’s driving window" />}
        <div className="track-fill" style={{ width: `${pct}%` }} />
        {days.map((d) => (
          <span key={d.left} className="day" style={{ left: `${d.left}%` }}>{d.label}</span>
        ))}
        <span className="thumb" style={{ left: `${pct}%` }} />
        <input
          type="range"
          min={0}
          max={HOURS}
          step={0.25}
          value={hour}
          aria-label="Forecast hour"
          aria-valuetext={`${formatDayTime(shown)}, ${rel} hours after departure`}
          onChange={(e) => {
            setPlaying(false)
            update(Number(e.target.value))
          }}
        />
      </div>
      <button
        type="button"
        className={`square-btn${heatOn ? ' on' : ''}`}
        aria-pressed={heatOn}
        aria-label={heatOn ? 'Hide weather overlay' : 'Show weather overlay'}
        title="Weather overlay"
        disabled={!heatmap}
        onClick={() => {
          setHeatOn(!heatOn)
          map?.setHeatVisible(!heatOn)
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 21a9 9 0 0 0 0-18z" fill="currentColor" />
        </svg>
      </button>
    </section>
  )
}
