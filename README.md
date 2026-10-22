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

## Deploy (Vercel)
1. Import this repository in Vercel. It detects the Vite preset: build `pnpm build`, output `dist`.
2. Set `VITE_API_URL` to the API's address, e.g. `https://api.spotter.wearecerta.app`.
3. Add the Vercel URL to the backend's `CORS_ALLOWED_ORIGINS`.

The browser calls the API directly, with no Vercel rewrite, so the API's rate limiting sees real client IPs.

GitHub Actions (`.github/workflows/ci.yml`) type-checks, lints, tests and builds every push. Vercel's Git integration deploys.
