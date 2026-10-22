import { ArrowRight } from 'lucide-react'
import { formatDateTime, formatLb } from '../lib/format'
import type { TripState } from '../state/trip'

/** "Denver, CO → Salt Lake City, UT" plus departure and load, shown atop Search and Results. */
export function TripHeader({ trip, action, leading }: { trip: TripState; action?: React.ReactNode; leading?: React.ReactNode }) {
  const departure = trip.plan?.departure_time ?? (trip.departureMode === 'now' ? null : trip.departure)
  return (
    <div className="trip-header">
      {leading}
      <div className="trip-header-text">
        <div className="trip-route">
          <span className="ellipsis">{trip.origin?.label}</span>
          <ArrowRight size={12} className="muted" aria-hidden="true" />
          <span className="ellipsis">{trip.destination?.label}</span>
        </div>
        <div className="mono small muted">
          {departure ? formatDateTime(departure) : 'Departing now'} · {formatLb(trip.plan?.load_weight_lb ?? trip.loadLb)}
        </div>
      </div>
      {action}
    </div>
  )
}
