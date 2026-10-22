import { ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type SnapPoint = 'peek' | 'half' | 'full'

const PEEK_PX = 92
const HALF = 0.5
const FULL = 0.9
const ORDER: SnapPoint[] = ['peek', 'half', 'full']

function heightFor(snap: SnapPoint, viewport: number): number {
  if (snap === 'peek') return PEEK_PX
  return Math.round(viewport * (snap === 'half' ? HALF : FULL))
}

interface Props {
  snap: SnapPoint
  onSnap: (snap: SnapPoint) => void
  /** Called with the sheet's on-screen height whenever it settles or is dragged. */
  onHeight: (px: number) => void
  /** One-line summary shown in the grab area (useful when collapsed). */
  summary: string
  children: React.ReactNode
}

/**
 * Mobile bottom sheet with three snap points. Drag the grab bar (it follows
 * the finger, then snaps to the nearest point, honouring a quick flick), tap
 * it to cycle, or use the arrow keys when it's focused.
 */
export function Sheet({ snap, onSnap, onHeight, summary, children }: Props) {
  const [viewport, setViewport] = useState(() => window.innerHeight)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startH: number; lastY: number; lastT: number; velocity: number; moved: boolean } | null>(null)

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const settled = heightFor(snap, viewport)
  const height = dragHeight ?? settled

  useEffect(() => onHeight(height), [height, onHeight])

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, startH: height, lastY: e.clientY, lastT: performance.now(), velocity: 0, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const now = performance.now()
    d.velocity = (d.lastY - e.clientY) / Math.max(now - d.lastT, 1) // px/ms, positive = upwards
    d.lastY = e.clientY
    d.lastT = now
    if (Math.abs(e.clientY - d.startY) > 4) d.moved = true
    if (d.moved) setDragHeight(Math.min(Math.max(d.startH + (d.startY - e.clientY), PEEK_PX), viewport * FULL))
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) {
      onSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]) // tap cycles
      return
    }
    const current = dragHeight ?? settled
    let next: SnapPoint
    if (Math.abs(d.velocity) > 0.5) {
      // A quick flick moves one step in its direction.
      const i = ORDER.indexOf(nearest(current, viewport))
      next = ORDER[Math.min(Math.max(i + (d.velocity > 0 ? 1 : -1), 0), ORDER.length - 1)]
    } else {
      next = nearest(current, viewport)
    }
    setDragHeight(null)
    onSnap(next)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = ORDER.indexOf(snap)
    if (e.key === 'ArrowUp') onSnap(ORDER[Math.min(i + 1, ORDER.length - 1)])
    else if (e.key === 'ArrowDown') onSnap(ORDER[Math.max(i - 1, 0)])
    else return
    e.preventDefault()
  }

  return (
    <div className={`side sheet sheet-${snap}${dragHeight != null ? ' dragging' : ''}`} style={{ height }}>
      <button
        type="button"
        className="sheet-handle"
        aria-label={`Resize panel (${snap === 'peek' ? 'collapsed' : snap === 'half' ? 'half' : 'expanded'})`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span className="sheet-grip" aria-hidden="true" />
        <span className="sheet-summary">
          <span className="ellipsis">{summary}</span>
          <ChevronUp size={16} className={snap === 'full' ? 'flip' : undefined} aria-hidden="true" />
        </span>
      </button>
      <div className="sheet-body">{children}</div>
    </div>
  )
}

function nearest(px: number, viewport: number): SnapPoint {
  let best: SnapPoint = 'half'
  for (const s of ORDER) if (Math.abs(heightFor(s, viewport) - px) < Math.abs(heightFor(best, viewport) - px)) best = s
  return best
}
