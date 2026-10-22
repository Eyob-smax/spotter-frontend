/**
 * Imperative wrapper around MapLibre. React tells it *what* to show; it owns
 * every per-frame animation (route draw-in, the testing truck, slider updates)
 * so nothing re-renders React at 60 fps.
 */
import type { Feature, FeatureCollection } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
// MapLibre v6 runs tile parsing in a module worker shipped as a separate file.
// Import its URL explicitly so Vite serves it in dev and emits it in the build.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Checkpoint, Heatmap, Place, Route } from '../api/types'
import { formatDayTime, formatMiles } from '../lib/format'
import { RISK_COLOR, RISK_LABEL, SCORE_RAMP } from '../lib/risk'
import { angleDelta, positionAtDistance, positionAtTime, revealGradient, riskGradient, unionBounds } from '../lib/route'
import { createPin, createRadar, createTruck, type TruckElement } from './markers'

maplibregl.setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const UNTESTED = '#8C8C8C'
const INK = '#0A0A0A'
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export type PointKind = 'origin' | 'destination'

export interface MapEvents {
  onPick: (kind: PointKind, lngLat: { lat: number; lon: number }) => void
  onRouteHover: (routeId: string | null) => void
  onRouteClick: (routeId: string) => void
}

type Phase = 'idle' | 'drawn' | 'testing' | 'scored' | 'result'

export class MapController {
  readonly map: maplibregl.Map
  readonly ready: Promise<void>
  private readonly events: MapEvents
  private loaded = false
  private beforeLabels: string | undefined
  private generation = 0 // bumps on every reset; running animations stop when it changes

  private originMarker: maplibregl.Marker | null = null
  private destinationMarker: maplibregl.Marker | null = null
  private meMarker: maplibregl.Marker | null = null
  private radar: maplibregl.Marker | null = null
  private testTruck: { marker: maplibregl.Marker; el: TruckElement } | null = null
  private trucks = new Map<string, { marker: maplibregl.Marker; el: TruckElement }>()
  private popup: maplibregl.Popup | null = null

  private routes: Route[] = []
  private checkpoints = new Map<string, Checkpoint[]>()
  private phase: Phase = 'idle'
  private selected: string | null = null
  private pickMode: PointKind | null = null

  private heat: Heatmap | null = null
  private heatFrame = 0
  private pendingHour = 0

  constructor(container: HTMLElement, events: MapEvents) {
    this.events = events
    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [-98.5, 39.5],
      zoom: 3.4,
      minZoom: 2,
      maxZoom: 15,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.keyboard.disableRotation()
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Routing © TomTom · Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0)',
      }),
      'bottom-right',
    )
    this.ready = new Promise((resolve) => {
      this.map.once('load', () => {
        // Small screens: start with the attribution collapsed to its (i) button.
        if (window.innerWidth < 720) container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
        this.setupLayers()
        this.loaded = true
        resolve()
      })
    })
    this.map.on('click', (e) => this.handleClick(e))
    // Keep the trip in view when the viewport changes (rotation, window resize).
    let resizeTimer = 0
    this.map.on('resize', () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => this.phase === 'result' && this.fitRoutes(), 250)
    })
    this.map.on('contextmenu', (e) => this.openContextMenu(e))
  }

  destroy(): void {
    this.generation++
    cancelAnimationFrame(this.heatFrame)
    this.map.remove()
  }

  // ---------------------------------------------------------------- setup

  private setupLayers(): void {
    const map = this.map
    this.beforeLabels = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

    map.addSource('heat', { type: 'geojson', data: empty, promoteId: 'i' })
    map.addLayer(
      {
        id: 'heat',
        type: 'circle',
        source: 'heat',
        paint: {
          'circle-radius': 10,
          'circle-blur': 1,
          'circle-color': ['interpolate', ['linear'], ['max', ['coalesce', ['feature-state', 'score'], 0], 0], ...SCORE_RAMP],
          'circle-opacity': [
            'case',
            ['<', ['coalesce', ['feature-state', 'score'], -1], 0], 0,
            // Calm weather stays transparent so only real weather shows on the map.
            ['interpolate', ['linear'], ['feature-state', 'score'], 0, 0, 0.5, 0.06, 1, 0.3, 2, 0.42, 4, 0.55],
          ],
          'circle-opacity-transition': { duration: 0 },
          'circle-color-transition': { duration: 0 },
        },
      },
      this.beforeLabels,
    )

    map.addSource('crow', { type: 'geojson', data: empty })
    map.addLayer(
      {
        id: 'crow',
        type: 'line',
        source: 'crow',
        paint: { 'line-color': INK, 'line-opacity': 0.35, 'line-width': 1.5, 'line-dasharray': [2, 3] },
      },
      this.beforeLabels,
    )

    map.addSource('checkpoints', { type: 'geojson', data: empty })
    map.addLayer({
      id: 'checkpoints',
      type: 'circle',
      source: 'checkpoints',
      paint: {
        'circle-radius': ['case', ['get', 'ghost'], 3.5, 5],
        'circle-color': ['case', ['get', 'ghost'], '#FFFFFF', ['get', 'color']],
        'circle-stroke-color': ['case', ['get', 'ghost'], UNTESTED, '#FFFFFF'],
        'circle-stroke-width': 1.5,
      },
    })
    map.on('mouseenter', 'checkpoints', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'checkpoints', () => this.updateCursor())
  }

  // ---------------------------------------------------------------- points

  setPoints(origin: Place | null, destination: Place | null): void {
    this.originMarker = this.syncPin(this.originMarker, origin, 'origin')
    this.destinationMarker = this.syncPin(this.destinationMarker, destination, 'destination')
  }

  private syncPin(marker: maplibregl.Marker | null, place: Place | null, kind: PointKind): maplibregl.Marker | null {
    if (!place) {
      marker?.remove()
      return null
    }
    if (marker) {
      marker.setLngLat([place.lon, place.lat])
      return marker
    }
    const created = new maplibregl.Marker({ element: createPin(kind), draggable: true, anchor: 'center' })
      .setLngLat([place.lon, place.lat])
      .addTo(this.map)
    created.on('dragend', () => {
      const { lng, lat } = created.getLngLat()
      this.events.onPick(kind, { lat, lon: lng })
    })
    return created
  }

  showUserLocation(lat: number, lon: number): void {
    if (!this.meMarker) {
      const el = document.createElement('div')
      el.className = 'me-dot'
      el.setAttribute('aria-hidden', 'true')
      this.meMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map)
    } else {
      this.meMarker.setLngLat([lon, lat])
    }
  }

  setPickMode(kind: PointKind | null): void {
    this.pickMode = kind
    this.updateCursor()
  }

  private updateCursor(): void {
    this.map.getCanvas().style.cursor = this.pickMode ? 'crosshair' : ''
  }

  private handleClick(e: MapMouseEvent): void {
    this.closePopup()
    if (this.loaded) {
      const hit = this.map.queryRenderedFeatures(e.point, { layers: ['checkpoints', ...this.routeLayerIds()] })
      const checkpoint = hit.find((f) => f.layer.id === 'checkpoints' && !f.properties.ghost)
      if (checkpoint && !this.pickMode) {
        this.openCheckpoint(String(checkpoint.properties.route), Number(checkpoint.properties.index))
        return
      }
      const line = hit.find((f) => f.layer.id.startsWith('route-hit-'))
      if (line && !this.pickMode && this.phase === 'result') {
        this.events.onRouteClick(line.layer.id.replace('route-hit-', ''))
        return
      }
    }
    if (this.pickMode) {
      this.events.onPick(this.pickMode, { lat: e.lngLat.lat, lon: e.lngLat.lng })
    }
  }

  private openContextMenu(e: MapMouseEvent): void {
    e.preventDefault()
    this.closePopup()
    const menu = document.createElement('div')
    menu.className = 'map-menu'
    const item = (label: string, kind: PointKind) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => {
        this.closePopup()
        this.events.onPick(kind, { lat: e.lngLat.lat, lon: e.lngLat.lng })
      })
      menu.append(button)
    }
    item('Directions from here', 'origin')
    item('Directions to here', 'destination')
    this.popup = new maplibregl.Popup({ closeButton: false, anchor: 'top-left', offset: 4, className: 'popup-menu' })
      .setLngLat(e.lngLat)
      .setDOMContent(menu)
      .addTo(this.map)
    menu.querySelector('button')?.focus()
  }

  private closePopup(): void {
    this.popup?.remove()
    this.popup = null
  }

  // ---------------------------------------------------------------- camera

  /** Camera padding that keeps routes clear of the floating panels (side panel on desktop, bottom sheet on mobile). */
  private padding(): maplibregl.PaddingOptions {
    const { clientWidth: w, clientHeight: h } = this.map.getContainer()
    const mobile = w < 720
    const pad = mobile
      ? { top: 70, right: 30, bottom: Math.round(h * 0.55) + 20, left: 30 }
      : { top: 90, right: 90, bottom: 150, left: 450 }
    // Never ask for more padding than the canvas has (MapLibre can't fit the bounds otherwise).
    const sx = Math.min(1, (w - 80) / (pad.left + pad.right))
    const sy = Math.min(1, (h - 80) / (pad.top + pad.bottom))
    return { top: pad.top * sy, bottom: pad.bottom * sy, left: pad.left * sx, right: pad.right * sx }
  }

  fitPoints(points: Place[]): void {
    if (points.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    // A lone point gets a small box around it so it can use the same fitBounds path.
    const r = points.length === 1 ? 0.15 : 0
    points.forEach((p) => {
      bounds.extend([p.lon - r, p.lat - r])
      bounds.extend([p.lon + r, p.lat + r])
    })
    this.fit(bounds, 9)
  }

  fitRoutes(routeIds?: string[]): void {
    const routes = routeIds ? this.routes.filter((r) => routeIds.includes(r.id)) : this.routes
    if (routes.length === 0) return
    const [w, s, e, n] = unionBounds(routes)
    this.fit(new maplibregl.LngLatBounds([w, s], [e, n]))
  }

  /**
   * Fit using per-call padding only. (easeTo/flyTo with `padding` would store it on the map
   * and later fits would add their own on top, overflowing small screens.)
   */
  private fit(bounds: maplibregl.LngLatBounds, maxZoom = 12): void {
    this.map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })
    this.map.fitBounds(bounds, { padding: this.padding(), maxZoom, duration: this.duration(1000) })
  }

  private duration(ms: number): number {
    return reduceMotion() ? 0 : ms
  }

  // ---------------------------------------------------------------- search sequence

  /** Stage 0: radar rings on the origin and a dashed straight line to the destination. */
  showSearching(origin: Place, destination: Place): void {
    this.reset()
    this.radar = new maplibregl.Marker({ element: createRadar() }).setLngLat([origin.lon, origin.lat]).addTo(this.map)
    this.setData('crow', {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[origin.lon, origin.lat], [destination.lon, destination.lat]] },
    })
    this.fitPoints([origin, destination])
  }

  /** Stage 1: routes draw in from origin to destination, staggered. */
  async drawRoutes(routes: Route[]): Promise<void> {
    const gen = this.generation
    this.radar?.remove()
    this.radar = null
    this.setData('crow', null)
    this.removeRouteLayers()
    this.routes = routes
    this.phase = 'drawn'

    for (const route of routes) {
      const id = route.id
      this.map.addSource(`route-${id}`, {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', properties: {}, geometry: route.geometry },
      })
      const layout: maplibregl.LineLayerSpecification['layout'] = { 'line-cap': 'round', 'line-join': 'round' }
      this.map.addLayer({ id: `route-glow-${id}`, type: 'line', source: `route-${id}`, layout, paint: { 'line-color': INK, 'line-width': 16, 'line-blur': 10, 'line-opacity': 0 } }, 'checkpoints')
      this.map.addLayer({ id: `route-casing-${id}`, type: 'line', source: `route-${id}`, layout, paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-opacity': 0 } }, 'checkpoints')
      this.map.addLayer({ id: `route-line-${id}`, type: 'line', source: `route-${id}`, layout, paint: { 'line-width': 3, 'line-gradient': revealGradient(UNTESTED, 0) } }, 'checkpoints')
      // Invisible wide line: an easy hover/click target.
      this.map.addLayer({ id: `route-hit-${id}`, type: 'line', source: `route-${id}`, layout, paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } }, 'checkpoints')
      this.map.on('mouseenter', `route-hit-${id}`, () => this.phase === 'result' && this.events.onRouteHover(id))
      this.map.on('mouseleave', `route-hit-${id}`, () => this.phase === 'result' && this.events.onRouteHover(null))
    }
    this.fitRoutes()

    const total = this.duration(900)
    await Promise.all(
      routes.map((route, i) =>
        this.animate(gen, total, (t) => {
          this.map.setPaintProperty(`route-line-${route.id}`, 'line-gradient', revealGradient(UNTESTED, easeOut(t)))
        }, this.duration(150) * i),
      ),
    )
    if (gen !== this.generation) return
    routes.forEach((r) => this.map.setPaintProperty(`route-casing-${r.id}`, 'line-opacity', 0.9))
  }

  /**
   * Stage 2: one route lights up and a truck drives it while ghost checkpoints
   * appear behind it (every `intervalMi`), like a driver being tried in turn.
   */
  async testRoute(routeId: string, intervalMi: number, durationMs: number): Promise<void> {
    const gen = this.generation
    const route = this.routes.find((r) => r.id === routeId)
    if (!route) return
    this.phase = 'testing'
    for (const r of this.routes) {
      const active = r.id === routeId
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-gradient', revealGradient(active ? INK : UNTESTED, 1))
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-width', active ? 5 : 3)
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-opacity', active ? 1 : 0.35)
    }
    if (route.id === this.routes[0]?.id) this.setCheckpointFeatures([])

    const stepM = intervalMi * 1609.344
    const marks: number[] = []
    for (let d = 0; d < route.distance_m; d += stepM) marks.push(d)
    marks.push(route.distance_m)

    const truck = this.ensureTestTruck()
    truck.el.setTyping(true)
    const placed = new Set<number>()
    let heading = positionAtDistance(route, 0).bearing
    const ghostFeatures = () => this.currentGhosts(routeId, marks.filter((_, i) => placed.has(i)), route)

    await this.animate(gen, this.duration(durationMs), (t) => {
      const along = route.distance_m * easeInOut(t)
      const { point, bearing } = positionAtDistance(route, along)
      heading += angleDelta(heading, bearing) * 0.18
      truck.marker.setLngLat(point)
      truck.el.setHeading(heading)
      let changed = false
      marks.forEach((m, i) => {
        if (m <= along && !placed.has(i)) {
          placed.add(i)
          changed = true
        }
      })
      if (changed) this.setCheckpointFeatures(ghostFeatures())
    })
    if (gen !== this.generation) return
    marks.forEach((_, i) => placed.add(i))
    this.setCheckpointFeatures(ghostFeatures())
    truck.el.setTyping(false)
    this.map.setPaintProperty(`route-line-${routeId}`, 'line-width', 3)
  }

  private ghostRoutes = new Map<string, Feature[]>()

  private currentGhosts(routeId: string, distances: number[], route: Route): Feature[] {
    this.ghostRoutes.set(
      routeId,
      distances.map((d, i) => ({
        type: 'Feature',
        properties: { ghost: true, route: routeId, index: i },
        geometry: { type: 'Point', coordinates: positionAtDistance(route, d).point },
      })),
    )
    return [...this.ghostRoutes.values()].flat()
  }

  private ensureTestTruck() {
    if (!this.testTruck) {
      const el = createTruck('active')
      this.testTruck = { el, marker: new maplibregl.Marker({ element: el.root }).setLngLat([0, 0]).addTo(this.map) }
    }
    return this.testTruck
  }

  /** Stage 3: checkpoints and lines take their risk colours, cascading from origin to destination. */
  async showScored(analysis: { id: string; checkpoints: Checkpoint[] }[]): Promise<void> {
    const gen = this.generation
    this.testTruck?.marker.remove()
    this.testTruck = null
    this.ghostRoutes.clear()
    this.phase = 'scored'
    analysis.forEach((r) => this.checkpoints.set(r.id, r.checkpoints))

    for (const r of this.routes) {
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-gradient', riskGradient(this.checkpoints.get(r.id) ?? []))
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-width', 4)
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-opacity', 1)
    }
    const all = analysis.flatMap((r) => r.checkpoints.map((cp) => ({ route: r.id, cp })))
    const maxIndex = Math.max(1, ...all.map((x) => x.cp.index))
    await this.animate(gen, this.duration(700), (t) => {
      const upTo = t * maxIndex
      this.setCheckpointFeatures(all.filter((x) => x.cp.index <= upTo).map((x) => this.checkpointFeature(x.route, x.cp)))
    })
  }

  private checkpointFeature(routeId: string, cp: Checkpoint): Feature {
    return {
      type: 'Feature',
      properties: { ghost: false, route: routeId, index: cp.index, color: RISK_COLOR[cp.risk], risk: cp.risk },
      geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
    }
  }

  /** Stage 4 and after: emphasise the selected route; others recede. */
  showResult(selected: string, hovered: string | null): void {
    this.phase = 'result'
    this.selected = selected
    for (const r of this.routes) {
      const isSel = r.id === selected
      const isHover = r.id === hovered && !isSel
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-width', isSel ? 6 : isHover ? 4.5 : 3)
      this.map.setPaintProperty(`route-line-${r.id}`, 'line-opacity', isSel ? 1 : isHover ? 0.9 : 0.45)
      this.map.setPaintProperty(`route-casing-${r.id}`, 'line-width', isSel ? 10 : 6)
      this.map.setPaintProperty(`route-glow-${r.id}`, 'line-opacity', isSel ? 0.22 : 0)
    }
    // Draw the selected (then hovered) route on top.
    const order = [...this.routes.map((r) => r.id).filter((id) => id !== selected && id !== hovered), ...(hovered && hovered !== selected ? [hovered] : []), selected]
    for (const id of order) {
      for (const kind of ['glow', 'casing', 'line', 'hit']) this.map.moveLayer(`route-${kind}-${id}`, 'checkpoints')
    }
    const cps = this.checkpoints.get(selected) ?? []
    this.setCheckpointFeatures(cps.map((cp) => this.checkpointFeature(selected, cp)))
  }

  // ---------------------------------------------------------------- checkpoint popover

  private openCheckpoint(routeId: string, index: number): void {
    const cp = this.checkpoints.get(routeId)?.find((c) => c.index === index)
    if (!cp) return
    this.closePopup()
    this.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 10, className: 'popup-checkpoint' })
      .setLngLat([cp.lon, cp.lat])
      .setDOMContent(checkpointCard(routeId, cp))
      .addTo(this.map)
  }

  // ---------------------------------------------------------------- forecast (heatmap + trucks)

  setHeatmap(heat: Heatmap | null): void {
    this.heat = heat
    if (!this.loaded) return
    if (!heat) {
      this.setData('heat', null)
      return
    }
    this.setData('heat', {
      type: 'FeatureCollection',
      features: heat.cells.map((c, i) => ({ type: 'Feature', id: i, properties: { i }, geometry: { type: 'Point', coordinates: c } })),
    })
    // Circle radius ≈ one cell so neighbours blend into a continuous surface. Web Mercator
    // stretches latitude by 1/cos(lat), so size from the corridor's mean latitude.
    const meanLat = heat.cells.reduce((sum, c) => sum + c[1], 0) / Math.max(heat.cells.length, 1)
    const r0 = (heat.cell_size_deg * (512 / 360)) / Math.cos((meanLat * Math.PI) / 180)
    this.map.setPaintProperty('heat', 'circle-radius', ['interpolate', ['exponential', 2], ['zoom'], 0, r0, 20, r0 * 2 ** 20])
    this.applyHour(this.pendingHour)
  }

  setHeatVisible(visible: boolean): void {
    if (this.loaded) this.map.setLayoutProperty('heat', 'visibility', visible ? 'visible' : 'none')
  }

  /** Called on every slider input; coalesced to one map update per animation frame. */
  setForecastHour(hour: number): void {
    this.pendingHour = hour
    if (this.heatFrame) return
    this.heatFrame = requestAnimationFrame(() => {
      this.heatFrame = 0
      this.applyHour(this.pendingHour)
    })
  }

  private applyHour(hour: number): void {
    const heat = this.heat
    if (heat && this.loaded) {
      const h0 = Math.floor(hour)
      const h1 = Math.min(h0 + 1, heat.hours - 1)
      const f = hour - h0
      heat.scores.forEach((row, i) => {
        const a = row[h0]
        const b = row[h1]
        const score = a == null || b == null ? (a ?? b ?? -1) : a + (b - a) * f // blend hours for a continuous slider
        this.map.setFeatureState({ source: 'heat', id: i }, { score })
      })
    }
    this.placeTrucks(hour)
  }

  private placeTrucks(hour: number): void {
    if (this.phase !== 'result' || this.routes.length === 0) return
    const departure = Date.parse(this.routes[0].departure_time) / 1000
    const start = this.heat ? Date.parse(this.heat.start_time) / 1000 : Math.floor(departure / 3600) * 3600
    const elapsed = start + hour * 3600 - departure
    for (const route of this.routes) {
      let truck = this.trucks.get(route.id)
      if (!truck) {
        const el = createTruck('parked')
        truck = { el, marker: new maplibregl.Marker({ element: el.root }).setLngLat([0, 0]).addTo(this.map) }
        this.trucks.set(route.id, truck)
      }
      const { point, bearing } = positionAtTime(route, elapsed)
      truck.marker.setLngLat(point)
      truck.el.setHeading(bearing)
      truck.el.setState(route.id === this.selected ? 'active' : 'parked', elapsed >= route.duration_s)
    }
  }

  // ---------------------------------------------------------------- helpers

  /** Clear every search artefact (routes, checkpoints, trucks, heat), keeping the pins. */
  reset(): void {
    this.generation++
    this.closePopup()
    this.radar?.remove()
    this.radar = null
    this.testTruck?.marker.remove()
    this.testTruck = null
    this.trucks.forEach((t) => t.marker.remove())
    this.trucks.clear()
    this.ghostRoutes.clear()
    this.checkpoints.clear()
    this.phase = 'idle'
    if (!this.loaded) return
    this.setData('crow', null)
    this.setCheckpointFeatures([])
    this.removeRouteLayers()
    this.setHeatmap(null)
  }

  private routeLayerIds(): string[] {
    return this.routes.map((r) => `route-hit-${r.id}`).filter((id) => this.map.getLayer(id))
  }

  private removeRouteLayers(): void {
    for (const r of this.routes) {
      for (const kind of ['hit', 'line', 'casing', 'glow']) {
        if (this.map.getLayer(`route-${kind}-${r.id}`)) this.map.removeLayer(`route-${kind}-${r.id}`)
      }
      if (this.map.getSource(`route-${r.id}`)) this.map.removeSource(`route-${r.id}`)
    }
    this.routes = []
  }

  private setCheckpointFeatures(features: Feature[]): void {
    this.setData('checkpoints', { type: 'FeatureCollection', features })
  }

  private setData(source: string, data: Feature | FeatureCollection | null): void {
    const src = this.map.getSource(source) as GeoJSONSource | undefined
    src?.setData(data ?? { type: 'FeatureCollection', features: [] })
  }

  /** rAF animation from 0→1 over `ms`; resolves early (without finishing) if the map was reset. */
  private animate(gen: number, ms: number, frame: (t: number) => void, delay = 0): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0) {
        if (gen === this.generation) frame(1)
        resolve()
        return
      }
      let start = 0
      const tick = (now: number) => {
        if (gen !== this.generation) return resolve()
        if (!start) start = now + delay
        const t = Math.min(Math.max((now - start) / ms, 0), 1)
        frame(t)
        if (t < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }
}

function checkpointCard(routeId: string, cp: Checkpoint): HTMLElement {
  const el = (tag: string, className?: string, text?: string) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const card = el('section', 'cp')
  card.setAttribute('aria-label', `Checkpoint at mile ${Math.round(cp.mile)} on Route ${routeId}`)

  const head = el('div', 'cp-head')
  head.append(el('strong', undefined, `Mile ${formatMiles(cp.mile).replace(' mi', '')} · Route ${routeId}`))
  const badge = el('span', `risk-badge risk-${cp.risk}`, RISK_LABEL[cp.risk].toUpperCase())
  head.append(badge)
  card.append(head)

  const rows = el('dl', 'cp-rows')
  const row = (k: string, v: string, extra?: string) => {
    rows.append(el('dt', undefined, k))
    const dd = el('dd', undefined, v)
    if (extra) dd.append(el('span', 'muted', ` ${extra}`))
    rows.append(dd)
  }
  const etaIn = Math.round((Date.parse(cp.eta) - Date.now()) / 60_000)
  row('ETA', formatDayTime(cp.eta), etaIn > 0 ? `(in ${etaIn >= 60 ? `${Math.floor(etaIn / 60)}h ${etaIn % 60}m` : `${etaIn} min`})` : undefined)
  if (cp.weather) {
    row('Wind', `${Math.round(cp.weather.wind_mph)} mph`, cp.weather.gust_mph != null ? `gusts ${Math.round(cp.weather.gust_mph)} mph` : undefined)
    row('Rain', `${cp.weather.rain_in_hr.toFixed(2)} in/hr`)
    row('Snow', `${cp.weather.snow_in_hr.toFixed(2)} in/hr`)
  }
  card.append(rows)

  if (cp.weather) {
    const why = el('div', 'cp-why')
    why.append(el('span', 'label', 'Why'))
    const list = el('ul')
    const factors = [...cp.factors].sort((a, b) => Number(b.decisive) - Number(a.decisive))
    for (const f of factors) {
      const li = el('li', f.decisive ? 'decisive' : undefined)
      const dot = el('span', 'dot')
      dot.style.background = RISK_COLOR[f.level]
      li.append(dot, el('span', undefined, f.message))
      list.append(li)
    }
    why.append(list)
    card.append(why)
    card.append(el('p', 'cp-foot', `Forecast for ${formatDayTime(cp.weather.forecast_time)} · the highest factor sets the level`))
  } else {
    card.append(el('p', 'cp-foot', 'Forecast not available for this time.'))
  }
  return card
}

