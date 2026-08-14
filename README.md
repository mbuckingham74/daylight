# Daylight Map

A live, interactive clone of the old **daylightmap.org** — a zoomable world map that tracks sunlight, twilight, and darkness as the day progresses.

[![Live Site](https://img.shields.io/badge/live-daylight.forkstech.com-blue?style=flat-square)](https://daylight.forkstech.com)

## Features

### Visualization
- **Live day/night visualization** with accurate Sun tracking
- **3D Globe** — a photorealistic, interactive Three.js globe on its own page (`globe.html`) that renders the same `SolarMath` day/night state in real time. See [3D Globe](#3d-globe) below.
- **State-aware update scheduler** — the clock display updates every second, but the expensive twilight tile redraw and chart rendering run every ~20 seconds in live mode. Manual interactions (slider, presets, resize, tab switch) render immediately. Work is skipped entirely while the browser tab is hidden and catches up on return.
- **Debounced hover feedback** — map coordinates update instantly on hover, while sunrise/sunset times and chart rebuilds are debounced ~200 ms to avoid redundant SunCalc calls during continuous mouse movement.
- **Smooth twilight gradient** instead of a hard terminator:
  - Civil twilight (sun 0° to −6° altitude)
  - Nautical twilight (sun −6° to −12°)
  - Astronomical twilight (sun −12° to −18°)
  - Night core (sun below −18°)
- **Sun marker** showing where the Sun is directly overhead
- **Twilight legend** — a collapsible legend explaining each color band (daylight, civil, nautical, astronomical, night) and the −0.833° refraction convention used for sunrise/sunset
- **Loading/failure states** — if a required dependency (Leaflet, SunCalc, solar.js, or view.js) fails to load, a non-blocking error banner appears with a reload button instead of a blank page
- **Muted dark terrain-style base map** (Esri World Dark Gray Base + Boundaries & Places overlay) so the terminator stays the star

### Info panel
- **UTC time** — current time (or time-travel time) in UTC
- **Sun Overhead** — coordinates where the Sun is directly overhead, in `NN.NN°N, EEE.EE°E` form
- **Solar Noon at Prime Meridian** — Greenwich solar noon in UTC (illustrates equation of time)
- **Moon Phase** — current lunar phase name
- **Location readout** — sunrise, sunset, and day length, shown in one of three modes:
  - **Hover any point** on the map → sunrise/sunset stay in UTC with the coordinate's local civil time underneath
  - **Click a major city marker** → UTC sunrise/sunset with that city's IANA timezone underneath (e.g. `05:21 PDT` for Seattle, `04:54 BST` for London)
  - **Use My Location** button → centers the map on the browser location at the world overview zoom and copies that location into the map point card
- **Browser location context** — displays the browser's IANA timezone immediately (no permission required). Coordinates are requested only after an explicit click on "Use My Location", which centers the map, shows a blue dot, and fills the nearest major city plus local sunrise/sunset/day length. Coordinates are not persisted or shared unless the user explicitly shares the URL.
- **Solar Details tab** — dense live stats for the current map time:
  - Earth-Sun distance in AU, kilometers, miles, and light travel time
  - Orbital speed, apparent solar diameter, solar energy relative to average, and solar constant estimate
  - Axial tilt, solar declination, right ascension, GMST, equation of time, antisolar point, and next equinox/solstice countdown
  - Selected-point Sun altitude, azimuth, zenith angle, shadow length multiplier, solar-noon altitude, day-length change, and twilight durations
  - Global daylight/twilight/night percentage breakdown
  - Mini charts for annual declination/distance, the current-time analemma, and selected-location day length

### Controls
- **Center Sun** — a one-shot camera action that puts the Sun marker in the center of the map area not covered by the desktop panel or mobile bottom sheet
- **Reset View** — returns to the deterministic world overview and removes shared camera parameters from the address bar
- **Follow Sun** — auto-pans the map to keep the Sun marker centered in the unobstructed map area. Auto-disables on manual pan/zoom, on city click, and on "Use My Location". Defaults *off* so user and shared views are not panned away to the Sun marker.
- **Show twilight** — toggle the twilight/night overlay on/off
- **Major cities** — toggle 15 major world city markers and labels. **Markers are clickable** — clicking a city recenters the map and shows that city's sunrise/sunset in the city's own timezone.

### Time travel
- **Live button** — return to real-time tracking
- **±12-hour slider** — scrubs ±12 hours around the current time-travel anchor (which is either "now" in live mode, or the selected seasonal preset event instant). The slider and presets compose: clicking a preset sets the anchor to the exact event instant, then dragging the slider scrubs around that anchor without jumping back to "now".
- **Preset selection state** — the active solstice/equinox preset is highlighted while that seasonal event instant is shown with no slider offset.
- **Solstice / equinox presets** — jump to the exact calculated instant of the seasonal event (not just the calendar date at an arbitrary time). Events are computed dynamically for the active time-travel year (or the current year when live), so they remain correct across year boundaries and leap years. Hover a preset button to see the exact UTC date and time of the event:
  - March equinox (e.g., 2026-03-20 14:38 UTC)
  - June solstice (e.g., 2026-06-21 08:24 UTC)
  - September equinox (e.g., 2026-09-23 00:17 UTC)
  - December solstice (e.g., 2026-12-21 20:54 UTC)
- **Specific date & time picker** — a `datetime-local` input allows jumping to any date and time in the viewer's local timezone. The UTC equivalent is shown below the input, with a warning if the date is outside the 1900–2100 accuracy range. Works alongside the slider: pick a date to set the anchor, then use the slider for ±12 hour fine-tuning.

### Sharing
- **Share button** — generates a canonical share URL that always includes the current time, map center, and zoom (unlike the address bar, which omits view params on a clean-root session). Uses `navigator.share` when available (mobile), with clipboard copy fallback. Browser geolocation coordinates are never included unless the user explicitly shared a URL that contained them.

### Location
- **Browser geolocation** — calls `navigator.geolocation.getCurrentPosition` only after an explicit click on the "Use My Location" button. Does not request location automatically on load. The button centers the map on the viewer's location at the world overview zoom and populates the local sunrise/sunset card. Explicit shared map views are preserved instead of being overridden by geolocation. Handles permission-denied / unavailable / timeout with inline feedback.
- **Location marker** — shows the browser-reported location as a blue dot on the map. Clicking the dot copies that location into the map point card without requiring a map pan.
- **Nearest city** — computed client-side from geolocation against a bundled list of major cities, so no external geocoding service is required.
- **Map point card** — hover/click sunrise and sunset are separate from the browser-location card, so polar hover data cannot be confused with the viewer's local daylight.

### Permalink state
The clean root route always starts from the same world overview; ordinary panning and browser geolocation coordinates are session-only and are not stored. Exact shared views can still be opened with `?time=&lat=&lon=&zoom=`. See [Permalink Format](#permalink-format) below.

## 3D Globe

A separate, directly-accessible page (`globe.html`) renders a photorealistic, interactive 3D Earth using **Three.js 0.160.0** (vendored locally under `html/vendor/`). It reuses **`SolarMath` (solar.js)** — there is no second astronomy implementation. The 2D Leaflet map is untouched and keeps working exactly as before.

### Page and controls
- Reachable via the prominent gold **"3D Globe"** button on the main page's info panel; a reciprocal **"2D Map"** button returns to the map.
- Compact translucent panel: "Daylight Globe" title, live/paused status, current UTC date and time, and **Sun Overhead** coordinates (subsolar point).
- Controls: reset camera, cloud-layer visibility toggle, atmosphere visibility toggle.
- Interaction: pointer drag / touch drag to orbit, wheel / pinch zoom, arrow keys + `+`/`-` when the canvas has keyboard focus, sensible min/max camera distance, subtle presentation auto-rotation that stops on first user interaction and is disabled under `prefers-reduced-motion`.
- The globe starts in live mode and recomputes the solar direction **once per second** (never per frame). An optional `?time=ISO` query parameter (same format as the 2D page) pins the displayed instant — used for deterministic verification and permalinks.
- Performance: pixel ratio capped at 2, correct resize handling, rendering paused while `document.hidden`, no per-frame allocations, and all shader state is updated via uniforms.
- Failure behavior: if WebGL 2, Three.js, a required script, or a required local texture fails, a visible non-blocking error card explains the problem and offers both **"Try again"** (reload) and **"Open 2D Map"** links. A watchdog in `globe.html` catches module-import failures that would otherwise abort silently; slow texture downloads never trigger a failure panel (no arbitrary load timeout), and a successful initialization clears every loading and error state.

### Files
| File | Purpose |
|------|---------|
| `html/globe.html` | Globe page (markup, import map for Three.js, watchdog script) |
| `html/globe-watchdog.js` | Module-failure detection for the watchdog (unit-tested; texture failures excluded) |
| `html/globe.css` | Dark space-oriented styling consistent with the 2D page |
| `html/globe.js` | ES module: scene, shaders, controls, lifecycle, failure states |
| `html/globe-math.js` | Pure geographic ↔ 3D-vector helper (UMD, browser + Node, unit-tested) |
| `html/vendor/three.module.min.js` | Three.js r160 module build (vendored locally, pinned) |
| `html/vendor/addons/controls/OrbitControls.js` | Three.js r160 OrbitControls addon (vendored, pinned) |
| `html/assets/globe/*` | Local NASA Earth textures (see [Attribution](#attribution)) |
| `tests/globe.test.js` | Unit tests for globe-math.js |

### Coordinate convention (single source of truth)
The globe uses a unit sphere with three.js `SphereGeometry` orientation. Mapping geography to object space (east-positive longitude, matching Leaflet and `solar.js`):

```
x = cos(lat) · cos(lng)
y = sin(lat)
z = −cos(lat) · sin(lng)
```

- `+Y` = north pole, `+X` = (0°, 0°) prime meridian, `+Z` = (0°, −90°), `−Z` = (0°, +90°), `−X` = antimeridian.
- Right-handed (X × Y = Z). Texture UVs are three.js defaults: `u = (lng + 180)/360` (seam at the antimeridian), `v = 1 − (lat + 90)/180` (north at top). Standard equirectangular NASA textures map with **no flip** in either axis.
- The Earth mesh is **never rotated**. The camera orbits the fixed globe; the Sun's object-space direction is recomputed from `SolarMath.getSubsolarPoint()` each second and uploaded as a uniform. Presentation auto-rotation moves only the camera, so the continent-to-sunlight relationship is exact at every frame.

### How the shader derives daylight, twilight, and night
Per fragment, `sin(altitude) = dot(surfaceNormal, uSunDir)` — the identical quantity to `SolarMath.getSolarSinAltitude()` on the 2D map. The four thresholds from `SolarMath.TWILIGHT_THRESHOLDS` are passed as a uniform vector:

- **Daylight** — `sin(−0.833°)` (the app's refraction convention). Sunlit day texture, ocean specular (Blinn–Phong, gated by the NASA water mask), and direct sunlight intensity (same smoothing ramp as the band) apply above this threshold, so the visible day/night boundary sits exactly on the documented apparent horizon. Smoothing is symmetric around the threshold, so the geographic boundary is exact. There is no direct light at or below the boundary — the bluish surface tint below it is atmospheric (scattered) light, kept separate so the night side never brightens.
- **Civil / nautical / astronomical twilight** — `sin(−6°)`, `sin(−12°)`, `sin(−18°)`. The surface color shifts from sunlit texture toward a deep twilight blue between the daylight and astronomical thresholds (`twilightDepth`), so the terminator reads atmospheric and continuous without moving any boundary.
- **Night** — below −18°. City lights fade in naturally as altitude falls (a smoothstep centered on the astronomical threshold, fully visible ~3.5° deeper) and are **only** on the dark side; night-side clouds stay near-black.

Lighting, tone mapping (ACES fitted curve) and the sRGB transfer function are implemented inline in the shaders; sRGB-tagged textures are uploaded as sRGB textures so sampling yields linear values. There is no ambient light washing out the night side.

### Verification
`tests/globe.test.js` locks the convention against cardinal cases (equator, poles, ±90°, antimeridian), unit length, invalid input, and — most importantly — cross-checks `GlobeMath` against `SolarMath.getSolarSinAltitude()` over a lat/lng grid at the four 2026 seasonal events (March equinox, June solstice, September equinox, December solstice), including the −0.833° refraction terminator placement.

## Tech Stack

| Layer | Tool |
|-------|------|
| Mapping | [Leaflet](https://leafletjs.com/) 1.9.4 |
| 3D rendering | [Three.js](https://threejs.org/) r160 (vendored locally, pinned; MIT) |
| Solar position (subsolar + twilight) | Self-contained first-principles algorithm (low-precision solar position + GMST + geodesic spherical caps), extracted into `html/solar.js` for unit testing |
| Auxiliary solar/lunar data | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 — used only for Greenwich solar noon, moon phase, and hover sunrise/sunset/day-length |
| Timezone lookup | [tz-lookup](https://github.com/darkskyapp/tz-lookup-oss) 6.1.25 — maps arbitrary lat/lng points to IANA timezones for local civil time |
| Base map | Esri World Dark Gray Base + Boundaries & Places |
| Hosting | Static nginx container behind Nginx Proxy Manager |
| Deployment | Docker Compose on a VPS |

> **Note on time display:** The map point card keeps UTC as the primary sunrise/sunset time and adds the selected point's local civil time underneath when a timezone can be resolved. Major city markers use their hardcoded IANA timezones, arbitrary points use `tz-lookup`, and the browser-location card uses the browser's local timezone. Day length is timezone-independent and always correct.

## Astronomy

The subsolar point and twilight boundaries are computed from first principles — **not** from SunCalc — using:

- Low-precision solar position algorithm (mean longitude, mean anomaly, ecliptic longitude, obliquity)
- Greenwich Mean Sidereal Time (GMST)
- Equatorial → subsolar transform: `latitude = declination`, `longitude = RA − GMST` (east-positive)
- Geodesic spherical caps centered on the **antisolar point** (the antipode of the subsolar point), with angular radius `90° + solar_altitude`
- Earth-Sun distance from mean anomaly, plus derived light time, orbital speed, apparent solar diameter, solar irradiance ratio, and equation of time
- Dynamic equinox/solstice countdowns found by numerically refining declination zero-crossings and extrema

### Accuracy envelope

The algorithms are low-precision but sufficient for visualization. The supported date range and approximate accuracies are:

| Quantity | Supported range | Approximate accuracy | Source |
|----------|----------------|---------------------|--------|
| Subsolar latitude (declination) | 1900–2100 | ±0.01° | Meeus ch. 25 |
| Subsolar longitude (GMST) | 1900–2100 | ±0.01° | IERS 1996 GMST |
| Earth-Sun distance | 1900–2100 | ±1×10⁻⁵ AU | Meeus ch. 25 |
| Equation of time | 1900–2100 | ±0.1 minutes | Meeus ch. 28 |
| Equinox/solstice times | 1900–2100 | ±2 minutes | Numerical refinement |
| Sunrise/sunset (SunCalc) | 1900–2100 | ±1 minute (mid-latitudes) | SunCalc / refraction model |
| Twilight thresholds | Any | Exact (defined by altitude angle) | Standard definitions |

Outside the 1900–2100 range, the obliquity and eccentricity formulas accumulate larger errors. Dates far outside this range should not be relied upon for precise solar positions.

The math is verified against standard solstice/equinox values:

| Event | Subsolar Latitude | Verified |
|-------|-------------------|----------|
| March equinox 2026 | 0.00° | ✓ |
| June solstice 2026 | +23.44° | ✓ |
| September equinox 2026 | −0.03° | ✓ |
| December solstice 2026 | −23.44° | ✓ |

Unit tests (run with `npm test`) verify declination bounds across multiple years, sunrise/sunset tolerance, polar day/night, antimeridian wrapping, leap day handling, and URL parameter validation.

### Longitude convention

Longitudes are **east-positive** throughout, matching both Leaflet and SunCalc:
- Seattle is `lng: -122.3`
- Tokyo is `lng: 139.65`
- Subsolar longitude is computed as `RA − GMST` and wrapped to `[−180, 180)` via a sign-safe modulo (`((x + 540) % 360) − 180`) so values near the antimeridian never come out as e.g. `−186°` instead of `+174°`.
- Hover longitude is wrapped via the fully sign-safe `(((x + 180) % 360 + 360) % 360) − 180` because Leaflet's `latlng.lng` can be unbounded when `worldCopyJump: true`.

## Project Structure

```
.
├── html/
│   ├── index.html          # Main 2D map page
│   ├── globe.html          # 3D globe page (ES module entry, import map)
│   ├── solar.js            # Pure solar/astronomy math (UMD module, testable in Node)
│   ├── globe-math.js       # Pure geographic ↔ 3D vector conversion (UMD module)
│   ├── app.js              # 2D map, UI logic (depends on solar.js)
│   ├── view.js             # 2D viewport helper (depends on nothing)
│   ├── globe.js            # 3D globe app (ES module, depends on solar.js + globe-math.js)
│   ├── style.css           # 2D page styling
│   ├── globe.css           # 3D globe page styling
│   ├── favicon.svg         # Site icon
│   ├── vendor/
│   │   ├── three.module.min.js          # Three.js r160 (pinned, MIT)
│   │   └── addons/controls/OrbitControls.js  # Three.js r160 addon (pinned, MIT)
│   └── assets/globe/       # Local Earth textures (NASA; see Attribution)
│       ├── day.jpg         # Blue Marble albedo (4096×2048)
│       ├── night.png       # Black Marble city lights (4096×2048)
│       ├── bump.jpg        # Shaded relief + bathymetry bump map (2048×1024)
│       ├── specular.jpg    # Land/ocean specular mask (2048×1024)
│       └── clouds.png      # Cloud cover layer (2048×1024, RGBA)
├── tests/
│   ├── solar.test.js       # Unit tests for solar math (node:test runner)
│   ├── globe.test.js       # Unit tests for globe-math.js (node:test runner)
│   ├── presets.test.js     # Seasonal preset and year-boundary tests
│   ├── view.test.js        # Viewport helper tests
│   └── edge-cases.test.js  # Permalink/edge-case tests
├── docker-compose.yml      # nginx static container with healthcheck
├── nginx.conf              # nginx config: gzip, caching, security headers, CSP Report-Only
├── deploy.sh               # One-command deploy to the VPS
├── package.json            # Dev tooling (ESLint, tests)
├── eslint.config.js        # ESLint 9 flat config (module override for globe.js)
├── .github/workflows/ci.yml # GitHub Actions: lint + test on push/PR
├── README.md               # This file
└── .gitignore
```

## Local Development

You can serve the `html/` directory with any static file server:

```bash
# Python
python3 -m http.server 8000 --directory html

# Node
npx serve html
```

Then open http://localhost:8000 for the 2D map and http://localhost:8000/globe.html for the 3D globe. Both pages work from the same static server with no build step. For deterministic globe states during development, append `?time=2026-06-21T08:24:00Z` (any ISO 8601 UTC instant).

### Testing and Linting

The project has no build step, but includes development-only tooling:

```bash
npm install        # install ESLint
npm test           # run unit tests (Node built-in test runner)
npm run lint       # run ESLint on JS files
npm run check      # run both lint and tests
```

## Deployment

The site runs as an `nginx:alpine` container on `forkstech.com` and is exposed through Nginx Proxy Manager.

To deploy from this repo:

```bash
./deploy.sh
```

The script:
1. Requires a clean, committed worktree and stages `docker-compose.yml`, `nginx.conf`, and `html/` under `/home/michael/deployments/` on ForksTech
2. Validates the staged Compose model, installs it at `/home/michael/deployments/daylight/`, and records the exact source commit in `.deployment.json`
3. Recreates only `daylight-static` with image pulling disabled

The nginx configuration (`nginx.conf`) provides:
- Gzip compression for CSS, JS, JSON, and SVG
- Long-term caching for versioned assets (files with `?v=` query params), including the local globe textures (`png/jpg/jpeg/webp`)
- `no-cache` revalidation for `index.html` and `globe.html`
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- CSP in Report-Only mode (move to enforcement after reviewing violations)
- Container healthcheck via `wget --spider`

### CI

GitHub Actions runs ESLint and unit tests on every push and pull request. See `.github/workflows/ci.yml`.

## Permalink Format

```
https://daylight.forkstech.com/?time=2026-12-22T02:56:24.000Z&lat=47.6000&lon=-122.3000&zoom=4
```

| Param | Description |
|-------|-------------|
| `time` | ISO 8601 UTC timestamp. Omit for live mode. |
| `lat`  | Map center latitude. `0` is honored (not treated as missing). |
| `lon`  | Map center longitude (east-positive). `0` is honored (not treated as missing). |
| `zoom` | Leaflet zoom level (2–12). |

The globe page accepts the same `?time=` parameter (e.g. `globe.html?time=2026-06-21T08:24:00Z`) to pin the displayed instant; omit it for live mode.

The **Follow Sun** control starts *off* so shared and first-load views are preserved instead of being immediately panned away to the Sun marker. Normal browsing keeps the address bar clean; map coordinates stay in the URL only when the page was opened as an explicit map view. **Reset View** returns to the canonical root camera and removes those view parameters.

## Known Limitations

- **Sun marker** uses the nearest wrapped world copy to stay visually continuous across the antimeridian. The displayed coordinate remains normalized to `[−180, 180]`.
- **Geolocation requires HTTPS and user permission.** On `http://` (e.g. local dev without TLS) or if the user denies the prompt, the button reports the error inline.

## Attribution

All globe textures are NASA imagery (public domain). Day/night texture provenance and the exact source files are recorded in `html/assets/globe/ATTRIBUTION.md`.

| Asset | Source | License / status |
|-------|--------|------------------|
| `day.jpg` — Blue Marble albedo | NASA Blue Marble imagery, redistributed via the [three-globe](https://github.com/vasturiano/three-globe) example assets (MIT repository) | Public domain (NASA) |
| `night.png` — city lights | NASA Black Marble 2016 (VIIRS) composite, stitched from NASA GIBS WMTS tiles (`VIIRS_Black_Marble`, 2016-01-01) | Public domain (NASA) |
| `bump.jpg` — shaded relief + bathymetry | NASA Blue Marble imagery, stitched from NASA GIBS WMTS tiles (`BlueMarble_ShadedRelief_Bathymetry`) | Public domain (NASA) |
| `specular.jpg` — land/ocean mask | NASA Blue Marble water mask, redistributed via the [three.js](https://github.com/mrdoob/three.js) examples (MIT repository) | Public domain (NASA) |
| `clouds.png` — cloud cover | NASA Terra MODIS cloud composite, redistributed via the three.js examples (MIT repository) | Public domain (NASA) |
| `three.module.min.js`, `OrbitControls.js` | [three.js](https://github.com/mrdoob/three.js) r160 | MIT |

The star background is procedural (generated in `globe.js`), so it needs no attribution.

NASA imagery courtesy of the [NASA Earth Observatory](https://earthobservatory.nasa.gov) and the [Global Imagery Browse Services (GIBS)](https://earthdata.nasa.gov/eosdis/gibs).

## License

MIT
