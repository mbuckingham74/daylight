# Daylight Map — Backlog Tracking

Updated 2026-07-13 after a multi-batch enhancement session.

## Completed Items

| # | Item | Priority | Batch | Summary |
|---|------|----------|-------|---------|
| 1 | State-aware update scheduler | P0 | 5 | Split `update()` into `updateClock()` (1s) and `updateHeavy()` (~20s in live mode). Manual interactions render immediately. |
| 4 | Skip work while document hidden | P0 | 5 | `visibilitychange` handler: skip `tick()` when hidden, catch up on return. |
| 6 | Debounce hover feedback | P0 | 5 | Coordinates update instantly; sunrise/sunset and charts debounced 200ms. |
| 8 | Dynamic seasonal presets | P0 | 2 | Replaced hardcoded 2026 dates with `getSeasonEvents(year)`. Presets jump to exact UTC event instant. Tooltips show event time. |
| 9 | Pin and protect dependencies | P1 | 10 | Added SRI + `crossorigin="anonymous"` to SunCalc and tz-lookup. Leaflet already had SRI. |
| 15 | Formatting, linting, checks | P1 | 1,3 | ESLint 9 flat config, `npm run lint`, `npm test`, `npm run check`. |
| 16 | Astronomy and state regression tests | P0 | 1,3 | 111 tests: declination bounds, multi-year reference values, polar day/night, antimeridian, leap day, URL validation, mocked SunCalc day length. |
| 17 | Document astronomy algorithms | P1 | 1,3 | JSDoc in `solar.js` with accuracy, validity range (1900–2100), and sources (Meeus). |
| 18 | Arbitrary date and time selection | P0 | 8 | `datetime-local` input in local timezone, shows UTC equivalent, warns outside 1900–2100. |
| 20 | Responsive bottom sheet | P0 | 8 | Collapsed/half/full states on mobile via panel handle tap. Not persisted. |
| 21 | Share/Copy Link | P0 | 8 | Canonical share URL with time+view+zoom. `navigator.share` with clipboard fallback. Never includes geolocation unless explicitly shared. |
| 27 | Tab keyboard pattern | P0 | 6 | Arrow Left/Right, Home/End, roving tabindex, focus movement, aria-selected/aria-controls. |
| 29 | Time slider label and value text | P0 | 6 | Visible `<label>`, `aria-describedby`, meaningful `aria-valuetext`. |
| 30 | Accessible chart equivalents | P0 | 6 | `role="img"` + `aria-label` on canvases, `sr-only` text descriptions with current values, no `aria-live` stream. |
| 31 | Respect reduced motion | P0 | 6 | `prefers-reduced-motion` media query disables animated pans and CSS transitions. Runtime media query listener. |
| 34 | Tested nginx configuration | P1 | 10 | `nginx.conf`: gzip, versioned asset caching, `no-cache` for index.html, security headers, CSP Report-Only. |
| 35 | Container healthcheck | P2 | 10 | `wget --spider` healthcheck in docker-compose.yml. |
| 36 | Validate and normalize URL state | P0 | 1 | `parsePermalinkParams()` in `solar.js`: validates time/lat/lon/zoom, ignores invalid fields individually, shows non-blocking notice. |
| 37 | Geolocation consent-first | P0 | 7 | Removed automatic geolocation on load. Shows timezone without permission. Requests coordinates only on explicit click. |
| 38 | Publish accuracy envelope | P0 | 4 | Accuracy table in README and brief note in UI. Supported range: 1900–2100. |
| 39 | Twilight legend and help text | P1 | 9 | Collapsible `<details>` legend with color swatches and descriptions, including −0.833° convention. |
| 40 | Loading/failure state | P1 | 9 | Dependency check at startup: non-blocking error banner with reload button if Leaflet/SunCalc/solar.js fail to load. |
| 41 | CI checks | P1 | 10 | GitHub Actions workflow: ESLint + unit tests on push/PR. |

## Remaining Items

### P1 — Valuable next

| # | Item | Notes |
|---|------|-------|
| 13 | Consolidate city data | Merge the two city arrays (`cities` and `browserLocationCities`) into one dataset with `displayName`, `shortName`, `timezone`, `showMarker`, and optional aliases. Preserve different presentation labels. |
| 19 | Time-lapse | Pressing Play leaves Live mode and starts from the displayed instant. Use elapsed real time to advance the simulation. Cap overlay rendering to a sensible frame rate. Provide a few understandable speeds and Pause/Live controls. `requestAnimationFrame` should drive the simulated clock, not force full tile and chart redraws at every frame. |
| 23 | Focused chart interaction | Crosshair/tooltips and click-to-scrub for year and day-length charts. The analemma needs nearest-point hit testing in 2D. Every pointer action needs a keyboard/touch equivalent and an accessible textual value. |
| 26 | Two-location comparison | Pin A/B and compare sunrise, sunset, day length, local time, and current light state. Make each point shareable and keep the map/panel usable on a phone. |

### P2 — Optional/later

| # | Item | Notes |
|---|------|-------|
| 12 | Split `app.js` into ES modules | Real boundaries: astronomy, layer renderer, location data, charts, URL state, UI. Do this for testability, not line count. Keep dependency loading and startup failure explicit. |
| 24 | "Jump to city" chooser | Autocomplete with aliases over the bundled list. Clear "featured cities" wording. No external geocoder. |
| 42 | Measure before micro-optimization | Record baseline for main-thread time, tile redraw, memory, interaction latency. Add a performance budget. |

### Struck-through (intentionally not scheduled)

Items 2, 3, 5, 7, 10, 11, 14, 22 (as proposed), 25, 28, 32, 33 — see the original reviewed backlog for rationale.

## Codebase State

- **`html/solar.js`** — UMD module with pure solar/astronomy math, testable in Node
- **`html/app.js`** — Map UI logic, depends on `solar.js` via `window.SolarMath`
- **`tests/`** — 111 unit tests using Node's built-in test runner
- **`eslint.config.js`** — ESLint 9 flat config
- **`nginx.conf`** — nginx config with gzip, caching, security headers, CSP Report-Only
- **`.github/workflows/ci.yml`** — CI: lint + test on push/PR
- **No build step** — all browser JS is served directly; `package.json` is dev-only

## Key Commands

```bash
npm install        # install ESLint
npm test           # run 111 unit tests
npm run lint       # ESLint
npm run check      # lint + test
./deploy.sh        # deploy to VPS
```
