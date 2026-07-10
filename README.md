# Daylight Map

A live, interactive clone of the old **daylightmap.org** — a zoomable world map that tracks sunlight, twilight, and darkness as the day progresses.

[![Live Site](https://img.shields.io/badge/live-daylight.forkstech.com-blue?style=flat-square)](https://daylight.forkstech.com)

## Features

### Visualization
- **Live day/night visualization** with accurate Sun tracking
- **Smooth twilight gradient** instead of a hard terminator:
  - Civil twilight (sun 0° to −6° altitude)
  - Nautical twilight (sun −6° to −12°)
  - Astronomical twilight (sun −12° to −18°)
  - Night core (sun below −18°)
- **Sun marker** showing where the Sun is directly overhead
- **Muted dark terrain-style base map** (Esri World Dark Gray Base + Boundaries & Places overlay) so the terminator stays the star

### Info panel
- **UTC time** — current time (or time-travel time) in UTC
- **Sun Overhead** — coordinates where the Sun is directly overhead, in `NN.NN°N, EEE.EE°E` form
- **Solar Noon at Prime Meridian** — Greenwich solar noon in UTC (illustrates equation of time)
- **Moon Phase** — current lunar phase name
- **Location readout** — sunrise, sunset, and day length, shown in one of three modes:
  - **Hover any point** on the map → sunrise/sunset stay in UTC with the coordinate's local civil time underneath
  - **Click a major city marker** → UTC sunrise/sunset with that city's IANA timezone underneath (e.g. `05:21 PDT` for Seattle, `04:54 BST` for London)
  - **Use My Location** button → centers the map on the browser location and copies that location into the map point card
- **Browser location context** — displays the browser's IANA timezone immediately, requests browser geolocation on load, shows a blue dot on the map, and fills the nearest major city plus local sunrise/sunset/day length when permission is granted.

### Controls
- **Follow Sun** — auto-pans the map to keep the Sun marker centered. Auto-disables on manual pan/zoom, on city click, and on "Use My Location". Defaults *off* so the first view stays a stable world map.
- **Show twilight** — toggle the twilight/night overlay on/off
- **Major cities** — toggle 15 major world city markers and labels. **Markers are clickable** — clicking a city recenters the map and shows that city's sunrise/sunset in the city's own timezone.

### Time travel
- **Live button** — return to real-time tracking
- **±12-hour slider** — scrubs ±12 hours around the current time-travel anchor (which is either "now" in live mode, or the selected seasonal preset date at the viewer's current local clock time). The slider and presets compose: clicking a preset sets the anchor, then dragging the slider scrubs around that anchor without jumping back to "now".
- **Preset selection state** — the active solstice/equinox preset is highlighted while that seasonal date is shown with no slider offset.
- **Solstice / equinox presets** — jump to the seasonal date at the viewer's current local clock time:
  - March equinox date, March 20, 2026
  - June solstice date, June 21, 2026
  - September equinox date, September 23, 2026
  - December solstice date, December 21, 2026

### Location
- **Browser geolocation** — calls `navigator.geolocation.getCurrentPosition` on load to populate the local sunrise/sunset card. The **Use My Location** button also centers the map on the viewer's location and copies it into the map point card. Handles permission-denied / unavailable / timeout with inline feedback.
- **Location marker** — shows the browser-reported location as a blue dot on the map. Clicking the dot copies that location into the map point card without requiring a map pan.
- **Nearest city** — computed client-side from geolocation against a bundled list of major cities, so no external geocoding service is required.
- **Map point card** — hover/click sunrise and sunset are separate from the browser-location card, so polar hover data cannot be confused with the viewer's local daylight.

### Permalink state
Refresh restores the last local map center and zoom while live mode keeps running. Open the title to clear that saved local view and return to the clean root URL. Exact shared views can still be opened with `?time=&lat=&lon=&zoom=`. See [Permalink Format](#permalink-format) below.

## Tech Stack

| Layer | Tool |
|-------|------|
| Mapping | [Leaflet](https://leafletjs.com/) 1.9.4 |
| Solar position (subsolar + twilight) | Self-contained first-principles algorithm (low-precision solar position + GMST + geodesic spherical caps) |
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

The math is verified against standard solstice/equinox values:

| Event | Subsolar Latitude | Verified |
|-------|-------------------|----------|
| March equinox 2026 | 0.00° | ✓ |
| June solstice 2026 | +23.44° | ✓ |
| September equinox 2026 | −0.03° | ✓ |
| December solstice 2026 | −23.44° | ✓ |

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
│   ├── index.html          # Main page
│   ├── app.js              # Map, astronomy, UI logic (self-contained, no build step)
│   ├── style.css           # Styling
│   └── favicon.svg         # Site icon
├── docker-compose.yml      # nginx static container
├── deploy.sh               # One-command deploy to the VPS
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

Then open http://localhost:8000.

## Deployment

The site runs as an `nginx:alpine` container on `forkstech.com` and is exposed through Nginx Proxy Manager.

To deploy from this repo:

```bash
./deploy.sh
```

The script:
1. Syncs `docker-compose.yml` and `html/` to `/home/michael/docker-configs/daylight/` on the VPS
2. Pulls the latest `nginx:alpine` image
3. Recreates/starts the `daylight-static` container

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

The **Follow Sun** control starts *off* so shared and first-load views are preserved instead of being immediately panned away to the Sun marker. Normal browsing keeps the address bar clean; map coordinates stay in the URL only when the page was opened as an explicit map view.

## Known Limitations

- **Sun marker** is placed at the exact computed longitude; with `worldCopyJump: true` it may occasionally appear at the antimeridian edge during wrapping. The displayed coordinate is always in `[−180, 180]`.
- **Geolocation requires HTTPS and user permission.** On `http://` (e.g. local dev without TLS) or if the user denies the prompt, the button reports the error inline.

## License

MIT
