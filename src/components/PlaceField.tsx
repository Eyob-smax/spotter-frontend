import { Crosshair, LoaderCircle, MapPin } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { api } from '../api/client'
import type { Place, SearchResult } from '../api/types'

interface Props {
  kind: 'origin' | 'destination'
  value: Place | null
  near: Place | null
  onChange: (place: Place | null) => void
  picking: boolean
  onTogglePick: () => void
  onUseLocation?: () => void
  locating?: boolean
  error?: string
  inputRef?: React.Ref<HTMLInputElement>
}

const DEBOUNCE_MS = 250

export function PlaceField({ kind, value, near, onChange, picking, onTogglePick, onUseLocation, locating, error, inputRef }: Props) {
  const [text, setText] = useState(value?.label ?? '')
  const [typed, setTyped] = useState(false) // true only while the user is typing (not after a pick)
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [syncedValue, setSyncedValue] = useState(value)
  const listId = useId()
  const errorId = useId()

  // Follow external changes (map pick, swap, geolocation) – adjusted during render, not in an effect.
  if (value !== syncedValue) {
    setSyncedValue(value)
    setText(value?.label ?? '')
    setTyped(false)
  }

  const query = typed ? text.trim() : ''
  useEffect(() => {
    if (query.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      api
        .search(query, near, controller.signal)
        .then((res) => {
          setFailed(false)
          setResults(res.results)
          setActive(0)
          setOpen(true)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setResults([])
          setFailed(true)
          setOpen(true)
        })
        .finally(() => !controller.signal.aborted && setLoading(false))
    }, DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, near])

  const choose = (result: SearchResult) => {
    setTyped(false)
    setOpen(false)
    setResults([])
    onChange({ lat: result.lat, lon: result.lon, label: result.label })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    }
  }

  const label = kind === 'origin' ? 'Origin' : 'Destination'
  const showList = open && query.length >= 2

  return (
    <div className="place">
      <div className={`field place-field${error ? ' invalid' : ''}${picking ? ' picking' : ''}`}>
        <span className={`place-icon place-icon-${kind}`} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          aria-label={label}
          placeholder={kind === 'origin' ? 'Origin: city, address or place' : 'Destination'}
          value={text}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setTyped(true)
            setText(e.target.value)
            if (e.target.value.trim().length < 2) {
              setResults([])
              setLoading(false)
            }
            if (!e.target.value) onChange(null)
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {loading && <LoaderCircle className="spin muted" size={15} aria-hidden="true" />}
        {onUseLocation && (
          <button type="button" className="icon-btn" aria-label="Use my location" title="Use my location" onClick={onUseLocation} disabled={locating}>
            {locating ? <LoaderCircle className="spin" size={16} /> : <Crosshair size={16} />}
          </button>
        )}
        <button
          type="button"
          className={`icon-btn${picking ? ' on' : ''}`}
          aria-label={`Pick ${kind} on the map`}
          aria-pressed={picking}
          title="Pick on map"
          onClick={onTogglePick}
        >
          <MapPin size={16} />
        </button>
      </div>
      {showList && (
        <ul className="suggestions" id={listId} role="listbox" aria-label={`${label} suggestions`}>
          {results.length === 0 && !loading && (
            <li className="suggestion-empty">{failed ? 'Search is unavailable right now. Try clicking the map instead.' : 'No matches'}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id || `${r.lat},${r.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <span className="suggestion-label">{r.label}</span>
              {r.secondary && <span className="suggestion-secondary">{r.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
