# Spotter Route (frontend)

A React app for the weather-aware truck routing assessment. You choose an origin and destination, a departure time and a load weight. The app compares 3 truck routes against the forecast at the time the truck reaches each checkpoint, and recommends the safest one.

- **Look:** light and monochrome. Colour is used only for weather risk.
- **Map:** MapLibre GL with OpenFreeMap tiles (no API key needed).
- **Data:** everything else comes from the Django API in the backend repository.

## Run locally
```bash
pnpm install
cp .env.example .env        # VITE_API_URL=http://localhost:8000 (the backend)
pnpm dev                    # http://localhost:5173
```

| Script | Does |
|---|---|
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | Type-check and production build to `dist/` |
| `pnpm test` | Unit tests (Vitest): route geometry, gradients, checkpoint maths, formatting |
| `pnpm lint` / `pnpm typecheck` | oxlint / TypeScript |

## What you can do
- **Set points** by any of:
  - typing (autocomplete)
  - **Use my location**
  - clicking the map (it fills whichever point is still empty)
  - **right-clicking** for "Directions from here / to here"
  - dragging the pins (after a search, dragging re-runs it)
- **Trip settings:** departure (Now, +3h, tomorrow 6:00 or a custom time, up to 7 days ahead), load weight with live load-rule hints, and checkpoint spacing (10 / 25 / 50 mi).
- **The "testing routes" sequence.** Each stage follows a real request:
  1. While routes load, radar rings pulse at the origin and a dashed line points to the destination.
  2. The 3 routes draw in.
  3. A truck drives each route in turn, with checkpoints appearing behind it, while the weather is checked at every ETA.
  4. Checkpoints and route lines take on their risk colours.
  5. The safest route thickens and glows, and the panel explains why.
- **Results:**
  - route cards: time, distance, arrival, a risk strip by distance, and Severe/High miles with average risk
  - SAFEST / BLOCKED / Detour badges
  - a "Why this route?" comparison table
  - a popover for each checkpoint: ETA, wind and gusts, rain, snow, and which rule set the level
- **Forecast slider (0–48 h from departure):**
  - a corridor weather overlay that blends smoothly between hours
  - one truck per route, positioned where it would be at that hour
  - play/pause

## How it's built
```
src/
  api/        client.ts (fetch wrapper, error envelope → ApiError), types.ts (mirrors the backend contract)
  state/      trip.ts – one reducer for the whole flow (plan → search → results)
  map/        MapController.ts – imperative MapLibre wrapper: layers, animations, popovers
              markers.ts – pins, radar, truck elements
  components/ PlanPanel, PlaceField, SearchPanel, ResultsPanel, ForecastBar, Legend, HowItWorks
  lib/        route.ts (position along a route by time, risk gradients), format.ts, risk.ts (colours)
```

**Performance choices:**
- **The map is driven imperatively.** React decides *what* to show. `MapController` owns every per-frame animation (route draw-in, the testing truck, the slider), so nothing re-renders React at 60 fps.
- **The slider only recolours the overlay.** Each heat cell's score is stored on the map (feature-state), and moving the slider updates that state at most once per animation frame. There's no data reload and no network call; fractional hours blend neighbouring hours.
- **The overlay is drawn as blurred circles, not a heatmap layer.** A heatmap layer shows how dense points are, which would make clusters of samples look risky. Each circle's colour comes from that cell's risk score, and calm cells are transparent.
- **Routes use line gradients,** coloured by checkpoint risk along their length, with the same "half-way to the neighbour" rule the backend uses to count miles.
- **Truck positions come from the route's cumulative TomTom travel times,** not a constant speed.
- **Code splitting:** MapLibre is in its own chunk; the app code is about 90 KB gzipped.
- **Reduced motion is respected.** Animations collapse to their final state.

## Design decisions

### Why `useReducer` and not Redux or Zustand
- **One reducer is enough.** The app is one screen with one flow (plan → search → results). A single reducer (`src/state/trip.ts`) describes every change as a named action, such as `routes-found`, `scored` and `search-failed`.
- **That gives Redux's main benefit** (predictable, testable state changes) without another dependency, store setup or extra code.
- **The fast-changing part lives outside React.** Map animation, trucks and the forecast slider run in `MapController`, so React never re-renders at 60 fps and no global store is needed for performance.
- Redux pays off when many distant parts of a large app share and change the same data; this app doesn't have that.

### Why reverse geocoding for map clicks and "Use my location"
A map click or the browser's GPS position only gives coordinates. Reverse geocoding turns them into an address ("1437 N Bannock St, Denver, CO") for the input field and the route header. The request goes through the backend (`/api/geocode/reverse`), so the TomTom key never ships to the browser. Until the address arrives, the field shows the coordinates, which also stay as the label where there's no address, such as open water.

### What affects the risk colours, and what doesn't
Risk levels come from the backend and follow the brief's table: the **worst of wind, rain and snow**, raised by the load rules. Rain and snow change the colour; for example, 0.17 in/hr of rain is Moderate. **Temperature, visibility, chance of precipitation and the conditions text** are shown in the tiles, charts, readout, table and popover. They don't change the level, because the brief defines thresholds only for wind, rain and snow, and the other fields describe the same weather.

### Why the map is driven imperatively
MapLibre layers are updated directly by `MapController` instead of through React props. That covers the route draw-in, the testing truck, checkpoint colouring, and the slider's per-hour overlay blending. The slider only changes stored per-cell values on the map, with no data reload and no network call. That's what keeps the heatmap and the trucks smooth.

### Why the weather overlay is circles, not a heatmap layer
A MapLibre `heatmap` layer shows how *many* points are close together, which would make areas with more samples look risky. Each corridor cell is drawn as a blurred circle coloured by its own risk score, and calm cells are transparent, so the colour always means risk.

### Why Vercel calls the API directly (no rewrite)
- **Rate limiting needs real client IPs.** With a Vercel rewrite in between, the API would see only Vercel's IPs.
- **Vercel's proxy timeout is too short** for the slowest cross-country route lookups (about 20 s).
- So the browser calls `https://api.spotter.wearecerta.app` directly, and the backend's CORS list allows the Vercel origin.

## Deploy (Vercel)
1. Import this repository in Vercel. It detects the Vite preset: build `pnpm build`, output `dist`.
2. Set `VITE_API_URL` to the API's address, e.g. `https://api.spotter.wearecerta.app`.
3. Add the Vercel URL to the backend's `CORS_ALLOWED_ORIGINS`.

The browser calls the API directly, with no Vercel rewrite, so the API's rate limiting sees real client IPs.

GitHub Actions (`.github/workflows/ci.yml`) type-checks, lints, tests and builds every push. Vercel's Git integration deploys.
