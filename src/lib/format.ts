export const METERS_PER_MILE = 1609.344

export function miles(meters: number): number {
  return meters / METERS_PER_MILE
}

export function formatMiles(mi: number): string {
  const rounded = Math.round(mi * 10) / 10
  if (rounded === 0) return '0 mi'
  return rounded < 10 ? `${rounded.toFixed(1)} mi` : `${Math.round(rounded).toLocaleString('en-US')} mi`
}

/** 29520 → "8h 12m"; 2400 → "40 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** Signed difference for badges: 1920 → "+32 min", 5100 → "+1h 25m". */
export function formatExtra(seconds: number): string {
  return `+${formatDuration(seconds)}`
}

export function formatLb(lb: number): string {
  return `${Math.round(lb).toLocaleString('en-US')} lb`
}

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** "Fri 17:07" in the viewer's local time. */
export function formatDayTime(value: string | number | Date): string {
  return dayTime.format(new Date(value))
}

export function formatTime(value: string | number | Date): string {
  return time.format(new Date(value))
}

export function formatDateTime(value: string | number | Date): string {
  return dateTime.format(new Date(value))
}

export function timeZoneLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value
  return short && short !== zone ? `${zone} (${short})` : zone
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
