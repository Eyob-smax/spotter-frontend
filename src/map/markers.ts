/** DOM elements for MapLibre HTML markers. Styling lives in index.css (.pin, .radar, .truck). */

export function createPin(kind: 'origin' | 'destination'): HTMLElement {
  const el = document.createElement('div')
  el.className = `pin pin-${kind}`
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', kind === 'origin' ? 'Origin (drag to move)' : 'Destination (drag to move)')
  return el
}

export function createRadar(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'radar'
  el.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('span')
    ring.style.animationDelay = `${i * 0.6}s`
    el.append(ring)
  }
  return el
}

export interface TruckElement {
  root: HTMLElement
  setHeading(degrees: number): void
  setTyping(on: boolean): void
  setState(state: 'active' | 'parked', arrived: boolean): void
}

// Top-down semi truck pointing north: cab at the top, trailer behind.
const TRUCK_SVG = `
<svg viewBox="0 0 20 40" width="14" height="28" aria-hidden="true">
  <rect x="3" y="12" width="14" height="27" rx="2" class="truck-trailer"/>
  <rect x="4" y="1" width="12" height="10" rx="3" class="truck-cab"/>
  <rect x="5.5" y="3" width="9" height="3" rx="1" class="truck-glass"/>
</svg>`

export function createTruck(initial: 'active' | 'parked'): TruckElement {
  const root = document.createElement('div')
  root.className = `truck truck-${initial}`
  root.setAttribute('aria-hidden', 'true')
  const body = document.createElement('div')
  body.className = 'truck-body'
  body.innerHTML = TRUCK_SVG // static markup, no user data
  const bubble = document.createElement('div')
  bubble.className = 'truck-bubble'
  bubble.innerHTML = '<i></i><i></i><i></i>'
  root.append(body, bubble)
  return {
    root,
    setHeading(degrees) {
      body.style.transform = `rotate(${degrees}deg)`
    },
    setTyping(on) {
      root.classList.toggle('typing', on)
    },
    setState(state, arrived) {
      root.classList.toggle('truck-active', state === 'active')
      root.classList.toggle('truck-parked', state === 'parked')
      root.classList.toggle('arrived', arrived)
    },
  }
}
