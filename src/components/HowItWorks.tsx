import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Meta, RiskLevel } from '../api/types'
import { RISK_COLOR, RISK_LABEL } from '../lib/risk'

const LEVELS: RiskLevel[] = ['low', 'moderate', 'high', 'severe', 'no_travel']

/** Explains the rules. Thresholds come from /api/meta, the backend's single source of truth. */
export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
    if (open && !meta) api.meta().then(setMeta).catch(() => setError(true))
  }, [open, meta])

  return (
    <dialog ref={dialog} className="how" onClose={onClose} aria-labelledby="how-title">
      <header className="row-between">
        <h2 id="how-title">How it works</h2>
        <button type="button" className="square-btn" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <ol className="how-steps">
        <li><b>3 truck routes</b> come from TomTom in truck mode for your load weight. If it returns fewer than 3 distinct routes, the rest go through a detour waypoint.</li>
        <li><b>Checkpoints</b> are placed every 10, 25 or 50 miles. Each one’s ETA comes from the route’s own travel times.</li>
        <li><b>Weather at the ETA:</b> the hourly forecast (Open-Meteo) for the hour the truck reaches each checkpoint.</li>
        <li><b>Risk</b> is the worst of wind, rain and snow, raised by the load rules below.</li>
        <li><b>Recommendation:</b> fewest No-Travel miles, then fewest Severe, then fewest High, then lowest average risk, then shortest travel time.</li>
      </ol>

      {error && <p className="hint">Couldn’t load the rule table.</p>}
      {meta && (
        <>
          <table className="rules">
            <thead>
              <tr>
                <th scope="col">Condition</th>
                {LEVELS.map((l) => (
                  <th key={l} scope="col"><span className="swatch" style={{ background: RISK_COLOR[l] }} /> {RISK_LABEL[l]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([['wind_mph', 'Wind'], ['rain_in_hr', 'Rain'], ['snow_in_hr', 'Snow']] as const).map(([key, label]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  {LEVELS.map((l) => <td key={l} className="mono">{meta.thresholds[key].bands[l]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Load rules</h3>
          <ul className="how-list">
            {meta.load_rules.map((r) => (
              <li key={`${r.wind_min_mph}-${r.load_over_lb}`}>
                Wind <span className="mono">{r.wind_max_mph ? `${r.wind_min_mph}–${r.wind_max_mph - 1}` : `≥ ${r.wind_min_mph}`} mph</span>
                {r.load_over_lb > 0 ? <> with a load over <span className="mono">{r.load_over_lb.toLocaleString('en-US')} lb</span></> : ' with any load'}
                {' → '}<b>{RISK_LABEL[r.result]}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">
        Wind means sustained 10 m wind (gusts are shown, not scored). Rain is rain + showers per hour; snow is inches of snow per hour.
        Each band includes its lower bound.
      </p>
    </dialog>
  )
}
