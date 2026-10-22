import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import type { Toast } from '../state/toasts'

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info }

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="assertive" aria-relevant="additions">
      {toasts.map((t) => {
        const Icon = ICON[t.tone]
        return (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'info' ? 'status' : 'alert'}>
            <Icon size={18} className="toast-icon" aria-hidden="true" />
            <div className="toast-text">
              <strong>{t.title}</strong>
              <span>{t.message}</span>
            </div>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
