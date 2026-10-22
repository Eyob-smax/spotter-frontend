import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { formatLb } from '../lib/format'
import { RISK_COLOR, RISK_LABEL, RISK_ORDER } from '../lib/risk'

export function Legend({ loadLb }: { loadLb: number }) {
  const [open, setOpen] = useState(true)
  return (
    <aside className="legend" aria-label="Risk legend">
      <button type="button" className="legend-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="eyebrow">Risk</span>
        <ChevronDown size={14} className={open ? undefined : 'flip'} aria-hidden="true" />
      </button>
      {open && (
        <>
          <ul>
            {RISK_ORDER.map((level) => (
              <li key={level}>
                <span className={`swatch${level === 'unknown' ? ' hatch' : ''}`} style={{ background: RISK_COLOR[level] }} />
                {RISK_LABEL[level]}
              </li>
            ))}
          </ul>
          <p className="hint">Overlay = risk for a {formatLb(loadLb)} load at that hour</p>
        </>
      )}
    </aside>
  )
}
