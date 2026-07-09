# Daylight Map

A live, interactive clone of the old **daylightmap.org** — a zoomable world map that tracks sunlight, twilight, and darkness as the day progresses.

[![Live Site](https://img.shields.io/badge/live-daylight.forkstech.com-blue?style=flat-square)](https://daylight.forkstech.com)

## Features

- **Live day/night visualization** with accurate subsolar point tracking
- **Graduated twilight bands** instead of a hard terminator:
  - Civil twilight
  - Nautical twilight
  - Astronomical twilight
  - Night core
- **Time travel** — drag through 24 hours or jump to solstices/equinoxes
- **Permalink state** — share exact views with `?time=&lat=&lon=&zoom=`
- **Interactive location data** — hover or click anywhere for local sunrise, sunset, and day length
- **Follow subsolar point** mode that automatically pans the map (disables on manual interaction)
- **Muted terrain-style base map** so the terminator stays the star

## Tech Stack

| Layer | Tool |
|-------|------|
| Mapping | [Leaflet](https://leafletjs.com/) 1.9.4 |
| Solar calculations | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 |
| Base map | Esri World Dark Gray Base + Boundaries & Places |
| Hosting | Static nginx container behind Nginx Proxy Manager |
| Deployment | Docker Compose on a VPS |

## Astronomy

The subsolar point and twilight boundaries are computed from first principles using:

- Low-precision solar position algorithm
- Greenwich Mean Sidereal Time (GMST)
- Geodesic spherical caps centered on the antisolar point

The math is verified against standard solstice/equinox values:

| Event | Subsolar Latitude |
|-------|-------------------|
| March equinox | ~0° |
| June solstice | ~+23.44° |
| September equinox | ~0° |
| December solstice | ~−23.44° |

## Project Structure

```
.
├── html/
│   ├── index.html          # Main page
│   ├── app.js              # Map, astronomy, UI logic
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
1. Syncs files to `/home/michael/docker-configs/daylight/` on the VPS
2. Pulls the latest `nginx:alpine` image
3. Recreates/starts the `daylight-static` container

## Permalink Format

```
https://daylight.forkstech.com/?time=2026-06-21T10:50:00.000Z&lat=47.6000&lon=-122.3000&zoom=4
```

| Param | Description |
|-------|-------------|
| `time` | ISO 8601 UTC timestamp |
| `lat` | Map center latitude |
| `lon` | Map center longitude |
| `zoom` | Zoom level |

## License

MIT
