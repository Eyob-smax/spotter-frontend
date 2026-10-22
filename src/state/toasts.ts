import { useCallback, useState } from 'react'

export type ToastTone = 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  message: string
}

const DURATION_MS: Record<ToastTone, number> = { error: 9000, warning: 8000, info: 5000 }
const MAX_TOASTS = 3
let nextId = 1

/** Small toast queue: newest on top, auto-dismissed, duplicates collapsed. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const notify = useCallback(
    (tone: ToastTone, title: string, message: string) => {
      const id = nextId++
      setToasts((list) => [{ id, tone, title, message }, ...list.filter((t) => t.message !== message)].slice(0, MAX_TOASTS))
      window.setTimeout(() => dismiss(id), DURATION_MS[tone])
    },
    [dismiss],
  )

  return { toasts, notify, dismiss }
}
