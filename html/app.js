(function () {
  'use strict';

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  // Parse permalink params on load
  const urlParams = new URLSearchParams(window.location.search);
  const initialTime = urlParams.has('time') ? new Date(urlParams.get('time')) : null;
  const initialLat = parseFloat(urlParams.get('lat'));
  const initialLng = parseFloat(urlParams.get('lon'));
  const initialZoom = parseInt(urlParams.get('zoom'), 10);
  const syncViewInUrl = urlParams.has('lat') || urlParams.has('lon') || urlParams.has('zoom');

  const mapCenter = (!isNaN(initialLat) && !isNaN(initialLng)) ? [initialLat, initialLng] : [20, 0];
  const mapZoom = initialZoom || 3;

  const map = L.map('map', {
    center: mapCenter,
    zoom: mapZoom,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: true,
    worldCopyJump: true
  });

  map.createPane('twilightPane');
  map.getPane('twilightPane').style.zIndex = 350;
  map.getPane('twilightPane').style.pointerEvents = 'none';

  // Muted dark terrain-ish base + subtle reference overlay for borders/labels
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 16,
    noWrap: false
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: '',
    maxZoom: 16,
    noWrap: false
  }).addTo(map);

  // Compute the Sun's equatorial coordinates (right ascension, declination) and GMST
  function getSunEquatorial(date) {
    const julian = date.getTime() / 86400000.0 + 2440587.5;
    const d = julian - 2451545.0;

    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const gmstDeg = gmst * 15;

    let L = 280.460 + 0.9856474 * d;
    L %= 360;
    let g = 357.528 + 0.9856003 * d;
    g %= 360;

    const lambda = L + 1.915 * Math.sin(g * D2R) + 0.02 * Math.sin(2 * g * D2R);

    const T = d / 36525;
    const epsilon = 23.43929111 - T * (46.836769 / 3600
      - T * (0.0001831 / 3600
        + T * (0.00200340 / 3600
          - T * (0.576e-6 / 3600
            - T * 4.34e-8 / 3600))));

    let alpha = Math.atan(Math.cos(epsilon * D2R) * Math.tan(lambda * D2R)) * R2D;
    const delta = Math.asin(Math.sin(epsilon * D2R) * Math.sin(lambda * D2R)) * R2D;
    const lQuadrant = Math.floor(lambda / 90) * 90;
    const raQuadrant = Math.floor(alpha / 90) * 90;
    alpha = alpha + (lQuadrant - raQuadrant);

    return { alpha, delta, gmstDeg };
  }

  // Subsolar point: latitude = declination, longitude where hour angle = 0
  function getSubsolarPoint(date) {
    const sun = getSunEquatorial(date);
    return { lat: sun.delta, lng: wrapLng(sun.alpha - sun.gmstDeg) };
  }

  // Wrap longitude to [-180, 180)
  function wrapLng(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  // The daylight/twilight layer is rendered as canvas map tiles instead of
  // polygons. This keeps the overlay aligned through antimeridian wrapping,
  // world copies, and Web Mercator projection without hand-closing rings.
  const REFRACTION = 0.833;
  const DAY_COLOR = [255, 205, 92];
  const CIVIL_TWILIGHT_COLOR = [52, 62, 96];
  const NAUTICAL_TWILIGHT_COLOR = [25, 39, 82];
  const ASTRONOMICAL_TWILIGHT_COLOR = [11, 19, 52];
  const TWILIGHT_EDGE_COLOR = [92, 120, 190];
  const NIGHT_COLOR = [1, 4, 16];
  const TWILIGHT_THRESHOLDS = {
    daylight: Math.sin(-REFRACTION * D2R),
    daylightGlow: Math.sin(18 * D2R),
    civil: Math.sin(-6 * D2R),
    nautical: Math.sin(-12 * D2R),
    astronomical: Math.sin(-18 * D2R)
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mixColor(from, to, amount) {
    return [
      Math.round(from[0] + (to[0] - from[0]) * amount),
      Math.round(from[1] + (to[1] - from[1]) * amount),
      Math.round(from[2] + (to[2] - from[2]) * amount)
    ];
  }

  function accentTwilightBoundary(pixel, sinAltitude) {
    const edgeWidth = Math.sin(1.15 * D2R);
    const boundaries = [
      TWILIGHT_THRESHOLDS.civil,
      TWILIGHT_THRESHOLDS.nautical,
      TWILIGHT_THRESHOLDS.astronomical
    ];
    const accent = boundaries.reduce((strongest, boundary) => {
      const distance = Math.abs(sinAltitude - boundary);
      return Math.max(strongest, 1 - smoothstep(0, edgeWidth, distance));
    }, 0);

    if (accent <= 0) return pixel;

    return {
      color: mixColor(pixel.color, TWILIGHT_EDGE_COLOR, 0.38 * accent),
      alpha: Math.min(190, Math.round(pixel.alpha + 30 * accent))
    };
  }

  function getSunRenderState(date) {
    const subsolar = getSubsolarPoint(date);
    const declination = subsolar.lat * D2R;
    return {
      lat: subsolar.lat,
      lng: subsolar.lng,
      sinDec: Math.sin(declination),
      cosDec: Math.cos(declination)
    };
  }

  function getTwilightPixel(sinAltitude) {
    if (sinAltitude >= TWILIGHT_THRESHOLDS.daylight) {
      const glow = smoothstep(TWILIGHT_THRESHOLDS.daylight, TWILIGHT_THRESHOLDS.daylightGlow, sinAltitude);
      const alpha = Math.round(6 * glow);
      return alpha > 0 ? { color: DAY_COLOR, alpha } : null;
    }

    if (sinAltitude >= TWILIGHT_THRESHOLDS.civil) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.daylight, TWILIGHT_THRESHOLDS.civil, sinAltitude);
      const pixel = { color: CIVIL_TWILIGHT_COLOR, alpha: Math.round(42 + 30 * amount) };
      return accentTwilightBoundary(pixel, sinAltitude);
    }

    let pixel;
    if (sinAltitude >= TWILIGHT_THRESHOLDS.nautical) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.civil, TWILIGHT_THRESHOLDS.nautical, sinAltitude);
      pixel = { color: NAUTICAL_TWILIGHT_COLOR, alpha: Math.round(88 + 32 * amount) };
      return accentTwilightBoundary(pixel, sinAltitude);
    }

    if (sinAltitude >= TWILIGHT_THRESHOLDS.astronomical) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.nautical, TWILIGHT_THRESHOLDS.astronomical, sinAltitude);
      pixel = { color: ASTRONOMICAL_TWILIGHT_COLOR, alpha: Math.round(132 + 34 * amount) };
      return accentTwilightBoundary(pixel, sinAltitude);
    }

    return { color: NIGHT_COLOR, alpha: 178 };
  }

  function getSolarSinAltitude(date, lat, lng) {
    const sun = getSunRenderState(date);
    const latR = lat * D2R;
    const hourAngle = wrapLng(lng - sun.lng) * D2R;
    return Math.sin(latR) * sun.sinDec + Math.cos(latR) * sun.cosDec * Math.cos(hourAngle);
  }

  const TwilightGridLayer = L.GridLayer.extend({
    initialize: function (options) {
      L.setOptions(this, options);
      this._sun = getSunRenderState(options.date || new Date());
    },

    createTile: function (coords) {
      const tile = L.DomUtil.create('canvas', 'leaflet-tile twilight-tile');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      tile.style.width = size.x + 'px';
      tile.style.height = size.y + 'px';
      this._drawTile(tile, coords);
      return tile;
    },

    setDate: function (date) {
      this._sun = getSunRenderState(date);
      this._redrawVisibleTiles();
      return this;
    },

    _redrawVisibleTiles: function () {
      if (!this._tiles) return;
      Object.keys(this._tiles).forEach(key => {
        const record = this._tiles[key];
        this._drawTile(record.el, record.coords);
      });
    },

    _drawTile: function (tile, coords) {
      const size = this.getTileSize();
      const width = size.x;
      const height = size.y;
      const ctx = tile.getContext('2d');
      const image = ctx.createImageData(width, height);
      const data = image.data;
      const worldSize = width * Math.pow(2, coords.z);
      const startX = coords.x * width;
      const startY = coords.y * height;
      const sun = this._sun;
      const cosHourAngles = new Float32Array(width);

      for (let x = 0; x < width; x++) {
        const lng = ((startX + x) / worldSize) * 360 - 180;
        cosHourAngles[x] = Math.cos(wrapLng(lng - sun.lng) * D2R);
      }

      for (let y = 0; y < height; y++) {
        const mercatorY = Math.PI - 2 * Math.PI * (startY + y) / worldSize;
        const lat = Math.atan(Math.sinh(mercatorY));
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);

        for (let x = 0; x < width; x++) {
          const sinAltitude = sinLat * sun.sinDec + cosLat * sun.cosDec * cosHourAngles[x];
          const pixel = getTwilightPixel(sinAltitude);
          if (!pixel) continue;

          const offset = (y * width + x) * 4;
          data[offset] = pixel.color[0];
          data[offset + 1] = pixel.color[1];
          data[offset + 2] = pixel.color[2];
          data[offset + 3] = pixel.alpha;
        }
      }

      ctx.putImageData(image, 0, 0);
    }
  });

  const twilightLayer = new TwilightGridLayer({
    pane: 'twilightPane',
    tileSize: 256,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1,
    date: initialTime || new Date()
  }).addTo(map);

  function updateTwilight(date) {
    twilightLayer.setDate(date);
  }

  const subsolarMarker = L.circleMarker([0, 0], {
    radius: 11,
    fillColor: '#ffd700',
    color: '#ffaa00',
    weight: 3,
    opacity: 1,
    fillOpacity: 0.9
  }).addTo(map);

  const subsolarLabel = L.tooltip({
    permanent: true,
    direction: 'right',
    offset: [10, 0],
    className: 'city-label'
  })
    .setContent('Sun')
    .setLatLng([0, 0]);

  const cities = [
    { name: 'London', lat: 51.5074, lng: -0.1278, tz: 'Europe/London' },
    { name: 'New York', lat: 40.7128, lng: -74.0060, tz: 'America/New_York' },
    { name: 'Tokyo', lat: 35.6762, lng: 139.6503, tz: 'Asia/Tokyo' },
    { name: 'Sydney', lat: -33.8688, lng: 151.2093, tz: 'Australia/Sydney' },
    { name: 'São Paulo', lat: -23.5505, lng: -46.6333, tz: 'America/Sao_Paulo' },
    { name: 'Cairo', lat: 30.0444, lng: 31.2357, tz: 'Africa/Cairo' },
    { name: 'Mumbai', lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata' },
    { name: 'Singapore', lat: 1.3521, lng: 103.8198, tz: 'Asia/Singapore' },
    { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, tz: 'America/Los_Angeles' },
    { name: 'Paris', lat: 48.8566, lng: 2.3522, tz: 'Europe/Paris' },
    { name: 'Moscow', lat: 55.7558, lng: 37.6173, tz: 'Europe/Moscow' },
    { name: 'Beijing', lat: 39.9042, lng: 116.4074, tz: 'Asia/Shanghai' },
    { name: 'Johannesburg', lat: -26.2041, lng: 28.0473, tz: 'Africa/Johannesburg' },
    { name: 'Dubai', lat: 25.2048, lng: 55.2708, tz: 'Asia/Dubai' },
    { name: 'Bangkok', lat: 13.7563, lng: 100.5018, tz: 'Asia/Bangkok' }
  ];

  const browserLocationCities = [
    { name: 'Seattle, WA USA', lat: 47.6062, lng: -122.3321 },
    { name: 'Portland, OR USA', lat: 45.5152, lng: -122.6784 },
    { name: 'Vancouver, BC Canada', lat: 49.2827, lng: -123.1207 },
    { name: 'San Francisco, CA USA', lat: 37.7749, lng: -122.4194 },
    { name: 'Los Angeles, CA USA', lat: 34.0522, lng: -118.2437 },
    { name: 'San Diego, CA USA', lat: 32.7157, lng: -117.1611 },
    { name: 'Las Vegas, NV USA', lat: 36.1699, lng: -115.1398 },
    { name: 'Phoenix, AZ USA', lat: 33.4484, lng: -112.0740 },
    { name: 'Salt Lake City, UT USA', lat: 40.7608, lng: -111.8910 },
    { name: 'Denver, CO USA', lat: 39.7392, lng: -104.9903 },
    { name: 'Dallas, TX USA', lat: 32.7767, lng: -96.7970 },
    { name: 'Austin, TX USA', lat: 30.2672, lng: -97.7431 },
    { name: 'Houston, TX USA', lat: 29.7604, lng: -95.3698 },
    { name: 'Kansas City, MO USA', lat: 39.0997, lng: -94.5786 },
    { name: 'Minneapolis, MN USA', lat: 44.9778, lng: -93.2650 },
    { name: 'Chicago, IL USA', lat: 41.8781, lng: -87.6298 },
    { name: 'Detroit, MI USA', lat: 42.3314, lng: -83.0458 },
    { name: 'St. Louis, MO USA', lat: 38.6270, lng: -90.1994 },
    { name: 'Nashville, TN USA', lat: 36.1627, lng: -86.7816 },
    { name: 'Atlanta, GA USA', lat: 33.7490, lng: -84.3880 },
    { name: 'Charlotte, NC USA', lat: 35.2271, lng: -80.8431 },
    { name: 'Washington, DC USA', lat: 38.9072, lng: -77.0369 },
    { name: 'Philadelphia, PA USA', lat: 39.9526, lng: -75.1652 },
    { name: 'New York, NY USA', lat: 40.7128, lng: -74.0060 },
    { name: 'Boston, MA USA', lat: 42.3601, lng: -71.0589 },
    { name: 'Miami, FL USA', lat: 25.7617, lng: -80.1918 },
    { name: 'Toronto, ON Canada', lat: 43.6532, lng: -79.3832 },
    { name: 'Montreal, QC Canada', lat: 45.5017, lng: -73.5673 },
    { name: 'Mexico City, Mexico', lat: 19.4326, lng: -99.1332 },
    { name: 'Bogota, Colombia', lat: 4.7110, lng: -74.0721 },
    { name: 'Lima, Peru', lat: -12.0464, lng: -77.0428 },
    { name: 'Santiago, Chile', lat: -33.4489, lng: -70.6693 },
    { name: 'Buenos Aires, Argentina', lat: -34.6037, lng: -58.3816 },
    { name: 'Sao Paulo, Brazil', lat: -23.5505, lng: -46.6333 },
    { name: 'Rio de Janeiro, Brazil', lat: -22.9068, lng: -43.1729 },
    { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
    { name: 'Dublin, Ireland', lat: 53.3498, lng: -6.2603 },
    { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
    { name: 'Madrid, Spain', lat: 40.4168, lng: -3.7038 },
    { name: 'Lisbon, Portugal', lat: 38.7223, lng: -9.1393 },
    { name: 'Amsterdam, Netherlands', lat: 52.3676, lng: 4.9041 },
    { name: 'Brussels, Belgium', lat: 50.8503, lng: 4.3517 },
    { name: 'Berlin, Germany', lat: 52.5200, lng: 13.4050 },
    { name: 'Zurich, Switzerland', lat: 47.3769, lng: 8.5417 },
    { name: 'Vienna, Austria', lat: 48.2082, lng: 16.3738 },
    { name: 'Rome, Italy', lat: 41.9028, lng: 12.4964 },
    { name: 'Prague, Czechia', lat: 50.0755, lng: 14.4378 },
    { name: 'Warsaw, Poland', lat: 52.2297, lng: 21.0122 },
    { name: 'Stockholm, Sweden', lat: 59.3293, lng: 18.0686 },
    { name: 'Oslo, Norway', lat: 59.9139, lng: 10.7522 },
    { name: 'Helsinki, Finland', lat: 60.1699, lng: 24.9384 },
    { name: 'Moscow, Russia', lat: 55.7558, lng: 37.6173 },
    { name: 'Istanbul, Turkey', lat: 41.0082, lng: 28.9784 },
    { name: 'Cairo, Egypt', lat: 30.0444, lng: 31.2357 },
    { name: 'Lagos, Nigeria', lat: 6.5244, lng: 3.3792 },
    { name: 'Nairobi, Kenya', lat: -1.2921, lng: 36.8219 },
    { name: 'Johannesburg, South Africa', lat: -26.2041, lng: 28.0473 },
    { name: 'Dubai, UAE', lat: 25.2048, lng: 55.2708 },
    { name: 'Riyadh, Saudi Arabia', lat: 24.7136, lng: 46.6753 },
    { name: 'Delhi, India', lat: 28.6139, lng: 77.2090 },
    { name: 'Mumbai, India', lat: 19.0760, lng: 72.8777 },
    { name: 'Bengaluru, India', lat: 12.9716, lng: 77.5946 },
    { name: 'Bangkok, Thailand', lat: 13.7563, lng: 100.5018 },
    { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
    { name: 'Kuala Lumpur, Malaysia', lat: 3.1390, lng: 101.6869 },
    { name: 'Jakarta, Indonesia', lat: -6.2088, lng: 106.8456 },
    { name: 'Hong Kong', lat: 22.3193, lng: 114.1694 },
    { name: 'Shanghai, China', lat: 31.2304, lng: 121.4737 },
    { name: 'Beijing, China', lat: 39.9042, lng: 116.4074 },
    { name: 'Seoul, South Korea', lat: 37.5665, lng: 126.9780 },
    { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503 },
    { name: 'Manila, Philippines', lat: 14.5995, lng: 120.9842 },
    { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093 },
    { name: 'Melbourne, Australia', lat: -37.8136, lng: 144.9631 },
    { name: 'Auckland, New Zealand', lat: -36.8509, lng: 174.7645 }
  ];

  let cityLayer = L.layerGroup().addTo(map);

  function renderCities() {
    cityLayer.clearLayers();
    cities.forEach(city => {
      const marker = L.circleMarker([city.lat, city.lng], {
        radius: 4,
        fillColor: '#5b8cff',
        color: '#ffffff',
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.9
      }).addTo(cityLayer);

      marker.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        map.panTo([city.lat, city.lng], { animate: true, duration: 0.8 });
        setFollowSun(false);
        showLocationTimes(city.lat, city.lng, city.name, city.tz);
      });

      L.tooltip({
        permanent: true,
        direction: 'top',
        offset: [0, -6],
        className: 'city-label'
      })
        .setContent(city.name)
        .setLatLng([city.lat, city.lng])
        .addTo(cityLayer);
    });
  }
  renderCities();

  function formatCoord(lat, lng) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
  }

  function formatTime(date) {
    if (!date || isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  }

  function formatTimeTz(date, timeZone) {
    if (!date || isNaN(date.getTime())) return '--:--';
    if (!timeZone) return formatTime(date);
    try {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
    } catch (e) {
      return formatTime(date);
    }
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function isValidDate(date) {
    return date && !isNaN(date.getTime());
  }

  function formatPolarDayLength(isDaylight) {
    return isDaylight ? '24h 0m' : '0h 0m';
  }

  function getMoonPhaseName(phase) {
    const age = phase * 29.53;
    if (age < 1) return 'New Moon';
    if (age < 7) return 'Waxing Crescent';
    if (age < 8) return 'First Quarter';
    if (age < 14) return 'Waxing Gibbous';
    if (age < 16) return 'Full Moon';
    if (age < 22) return 'Waning Gibbous';
    if (age < 23) return 'Last Quarter';
    if (age < 29) return 'Waning Crescent';
    return 'New Moon';
  }

  function update(date) {
    updateTwilight(date);

    const subsolar = getSubsolarPoint(date);
    subsolarMarker.setLatLng([subsolar.lat, subsolar.lng]);
    subsolarLabel.setLatLng([subsolar.lat, subsolar.lng]);

    document.getElementById('utc-time').textContent = date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    document.getElementById('sun-position').textContent = formatCoord(subsolar.lat, subsolar.lng);

    const greenwich = SunCalc.getTimes(date, 51.4769, -0.0005);
    const solarNoon = greenwich.solarNoon;
    document.getElementById('solar-noon').textContent = solarNoon && !isNaN(solarNoon) ? formatTime(solarNoon) + ' UTC' : '--:--';

    const moonIllum = SunCalc.getMoonIllumination(date);
    document.getElementById('moon-phase').textContent = getMoonPhaseName(moonIllum.phase);
    updateBrowserLocalSunReadout(date);
  }

  function updateHover(latlng, label = 'Hovered map point') {
    const lat = latlng.lat;
    const lng = (((latlng.lng + 180) % 360 + 360) % 360) - 180;
    const now = currentTime();
    const times = SunCalc.getTimes(now, lat, lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset);

    document.getElementById('location-info').querySelector('h2').textContent = label;
    document.getElementById('hover-coords').textContent = formatCoord(lat, lng);

    if (hasSunTimes) {
      document.getElementById('hover-sunrise').textContent = formatTime(times.sunrise) + ' UTC';
      document.getElementById('hover-sunset').textContent = formatTime(times.sunset) + ' UTC';
      document.getElementById('hover-daylength').textContent = formatDuration((times.sunset - times.sunrise) / 1000);
      return;
    }

    const isDaylight = getSolarSinAltitude(now, lat, lng) >= TWILIGHT_THRESHOLDS.daylight;
    document.getElementById('hover-sunrise').textContent = 'No sunrise';
    document.getElementById('hover-sunset').textContent = 'No sunset';
    document.getElementById('hover-daylength').textContent = formatPolarDayLength(isDaylight);
  }

  // Show sunrise/sunset for a known location (city or "my location") in its
  // own IANA timezone. Falls back to UTC if no timezone is provided.
  function showLocationTimes(lat, lng, label, timeZone) {
    const now = currentTime();
    const times = SunCalc.getTimes(now, lat, lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset);

    document.getElementById('location-info').querySelector('h2').textContent = label;
    document.getElementById('hover-coords').textContent = formatCoord(lat, lng);
    const tzSuffix = timeZone ? ' ' + getTimeZoneAbbr(timeZone) : ' UTC';

    if (hasSunTimes) {
      document.getElementById('hover-sunrise').textContent = formatTimeTz(times.sunrise, timeZone) + tzSuffix;
      document.getElementById('hover-sunset').textContent = formatTimeTz(times.sunset, timeZone) + tzSuffix;
      document.getElementById('hover-daylength').textContent = formatDuration((times.sunset - times.sunrise) / 1000);
      return;
    }

    const isDaylight = getSolarSinAltitude(now, lat, lng) >= TWILIGHT_THRESHOLDS.daylight;
    document.getElementById('hover-sunrise').textContent = 'No sunrise';
    document.getElementById('hover-sunset').textContent = 'No sunset';
    document.getElementById('hover-daylength').textContent = formatPolarDayLength(isDaylight);
  }

  function getTimeZoneAbbr(timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date());
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : '';
    } catch (e) {
      return '';
    }
  }

  let browserLocation = null;

  function getBrowserTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (e) {
      return null;
    }
  }

  function getDistanceKm(aLat, aLng, bLat, bLng) {
    const earthRadiusKm = 6371;
    const dLat = (bLat - aLat) * D2R;
    const dLng = (bLng - aLng) * D2R;
    const lat1 = aLat * D2R;
    const lat2 = bLat * D2R;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function findNearestBrowserCity(lat, lng) {
    return browserLocationCities.reduce((nearest, city) => {
      const distance = getDistanceKm(lat, lng, city.lat, city.lng);
      if (!nearest || distance < nearest.distance) {
        return { ...city, distance };
      }
      return nearest;
    }, null);
  }

  function updateBrowserTimezoneReadout() {
    const timeZone = getBrowserTimeZone();
    document.getElementById('browser-timezone').textContent = timeZone || 'Unavailable';
    return timeZone;
  }

  function updateBrowserNearestCityReadout(lat, lng) {
    const nearestCity = findNearestBrowserCity(lat, lng);
    document.getElementById('browser-nearest-city').textContent = nearestCity ? nearestCity.name : 'Unavailable';
    return nearestCity;
  }

  function resetBrowserLocalSunReadout() {
    document.getElementById('browser-sunrise').textContent = '--';
    document.getElementById('browser-sunset').textContent = '--';
    document.getElementById('browser-daylength').textContent = '--';
  }

  function updateBrowserLocalSunReadout(date = currentTime()) {
    if (!browserLocation) {
      resetBrowserLocalSunReadout();
      return;
    }

    const times = SunCalc.getTimes(date, browserLocation.lat, browserLocation.lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset);
    const tzSuffix = browserLocation.timeZone ? ' ' + getTimeZoneAbbr(browserLocation.timeZone) : ' UTC';

    if (hasSunTimes) {
      document.getElementById('browser-sunrise').textContent = formatTimeTz(times.sunrise, browserLocation.timeZone) + tzSuffix;
      document.getElementById('browser-sunset').textContent = formatTimeTz(times.sunset, browserLocation.timeZone) + tzSuffix;
      document.getElementById('browser-daylength').textContent = formatDuration((times.sunset - times.sunrise) / 1000);
      return;
    }

    const isDaylight = getSolarSinAltitude(date, browserLocation.lat, browserLocation.lng) >= TWILIGHT_THRESHOLDS.daylight;
    document.getElementById('browser-sunrise').textContent = 'No sunrise';
    document.getElementById('browser-sunset').textContent = 'No sunset';
    document.getElementById('browser-daylength').textContent = formatPolarDayLength(isDaylight);
  }

  function setBrowserNearestCityStatus(status) {
    document.getElementById('browser-nearest-city').textContent = status;
    browserLocation = null;
    resetBrowserLocalSunReadout();
  }

  function requestBrowserLocation(options = {}) {
    const { panToLocation = false, showTimes = false, updateButton = false } = options;
    const myLocationBtn = document.getElementById('my-location-btn');

    if (!navigator.geolocation) {
      setBrowserNearestCityStatus('Unavailable');
      if (updateButton) {
        myLocationBtn.textContent = 'Unsupported';
        setTimeout(() => { myLocationBtn.textContent = 'Use My Location'; }, 2000);
      }
      return;
    }

    if (updateButton) {
      myLocationBtn.disabled = true;
      myLocationBtn.textContent = 'Locating...';
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const tz = updateBrowserTimezoneReadout();
        const nearestCity = updateBrowserNearestCityReadout(lat, lng);
        browserLocation = {
          lat,
          lng,
          timeZone: tz,
          label: nearestCity ? nearestCity.name : 'Your location'
        };
        updateBrowserLocalSunReadout();

        if (updateButton) {
          myLocationBtn.disabled = false;
          myLocationBtn.textContent = 'Use My Location';
        }

        if (panToLocation) {
          setFollowSun(false);
          map.panTo([lat, lng], { animate: true, duration: 0.8 });
        }

        if (showTimes) {
          showLocationTimes(lat, lng, browserLocation.label, tz);
        }
      },
      function (err) {
        const messages = {
          1: 'Permission denied',
          2: 'Location unavailable',
          3: 'Request timed out'
        };
        const message = messages[err.code] || 'Location error';
        setBrowserNearestCityStatus(message);

        if (updateButton) {
          myLocationBtn.disabled = false;
          myLocationBtn.textContent = message;
          setTimeout(() => { myLocationBtn.textContent = 'Use My Location'; }, 2500);
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  function initializeBrowserLocationReadout() {
    updateBrowserTimezoneReadout();

    if (!navigator.geolocation) {
      setBrowserNearestCityStatus('Unavailable');
      return;
    }

    setBrowserNearestCityStatus('Location not shared');

    if (!navigator.permissions || !navigator.permissions.query) return;

    navigator.permissions.query({ name: 'geolocation' })
      .then(status => {
        if (status.state === 'granted') {
          requestBrowserLocation();
        } else if (status.state === 'denied') {
          setBrowserNearestCityStatus('Permission denied');
        }
      })
      .catch(() => {});
  }

  let lastHover = null;
  map.on('mousemove', function (e) {
    if (e.latlng && (!lastHover || e.latlng.distanceTo(lastHover) > 50000)) {
      lastHover = e.latlng;
      updateHover(e.latlng);
    }
  });

  map.on('click', function (e) {
    // City marker clicks are handled by the marker's own click handler
    // (with stopPropagation); this handles clicks on the open map only.
    if (e.sourceTarget && e.sourceTarget instanceof L.CircleMarker) return;
    updateHover(e.latlng, 'Selected map point');
  });

  // "Use My Location" — browser geolocation. Times display in the browser's
  // local timezone, which is correct because the user is physically there.
  const myLocationBtn = document.getElementById('my-location-btn');
  initializeBrowserLocationReadout();
  myLocationBtn.addEventListener('click', function () {
    requestBrowserLocation({ panToLocation: true, showTimes: true, updateButton: true });
  });

  // UI controls
  const followSunCheckbox = document.getElementById('follow-sun');
  const showTerminatorCheckbox = document.getElementById('show-terminator');
  const showCitiesCheckbox = document.getElementById('show-cities');
  const timeSlider = document.getElementById('time-slider');
  const timeSliderValue = document.getElementById('time-slider-value');
  const liveBtn = document.getElementById('live-btn');
  const presetBtns = document.querySelectorAll('[data-preset]');

  const presets = {
    'mar-equinox': new Date('2026-03-20T14:46:00Z'),
    'jun-solstice': new Date('2026-06-21T08:24:00Z'),
    'sep-equinox': new Date('2026-09-23T00:05:00Z'),
    'dec-solstice': new Date('2026-12-21T20:50:00Z')
  };

  let followSun = false;
  let isLive = !initialTime;
  let manualTime = initialTime ? new Date(initialTime.getTime()) : new Date();
  let sliderOffsetHours = 0;
  let selectedPresetKey = initialTime ? findPresetKeyForDate(initialTime) : null;

  function currentTime() {
    if (isLive) return new Date();
    return new Date(manualTime.getTime() + sliderOffsetHours * 3600000);
  }

  function findPresetKeyForDate(date) {
    if (!isValidDate(date)) return null;
    const time = date.getTime();
    return Object.keys(presets).find(key => presets[key].getTime() === time) || null;
  }

  function updatePresetSelection() {
    presetBtns.forEach(btn => {
      const key = btn.getAttribute('data-preset');
      const active = !isLive && sliderOffsetHours === 0 && selectedPresetKey === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // The Sun marker and label are always on the map — the "Follow Sun"
  // toggle only controls auto-panning, not visibility.
  function setFollowSun(enabled) {
    followSun = enabled;
    followSunCheckbox.checked = enabled;
    if (followSun) {
      const subsolar = getSubsolarPoint(currentTime());
      map.panTo([subsolar.lat, subsolar.lng], { animate: true, duration: 0.8 });
    }
  }

  followSunCheckbox.addEventListener('change', function () {
    setFollowSun(this.checked);
  });

  function onUserMovedMap() {
    if (followSun) {
      setFollowSun(false);
    }
  }
  map.on('dragstart', onUserMovedMap);
  map.on('zoomstart', onUserMovedMap);

  showTerminatorCheckbox.addEventListener('change', function () {
    const visible = this.checked;
    twilightLayer.setOpacity(visible ? 1 : 0);
  });

  showCitiesCheckbox.addEventListener('change', function () {
    if (this.checked) {
      map.addLayer(cityLayer);
    } else {
      map.removeLayer(cityLayer);
    }
  });

  // Time slider: ±12 hours around the current manualTime anchor.
  // The anchor is set when a preset is chosen or when the user first drags
  // the slider from live mode. This makes presets and the slider compose.
  function updateSliderLabel() {
    const target = currentTime();
    if (isLive) {
      timeSliderValue.textContent = 'Live';
    } else {
      timeSliderValue.textContent = target.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }
  }

  function resetSliderToCenter() {
    sliderOffsetHours = 0;
    timeSlider.value = 0;
    updateSliderLabel();
  }

  let sliderRaf = null;
  timeSlider.addEventListener('input', function () {
    if (isLive) {
      // Freeze the anchor at the current live moment before applying offset
      manualTime = new Date();
      isLive = false;
      liveBtn.classList.remove('active');
      selectedPresetKey = null;
    }
    sliderOffsetHours = parseFloat(this.value);
    updateSliderLabel();
    updatePresetSelection();
    updatePermalink();
    if (sliderRaf) cancelAnimationFrame(sliderRaf);
    sliderRaf = requestAnimationFrame(() => {
      update(currentTime());
      sliderRaf = null;
    });
  });

  liveBtn.addEventListener('click', function () {
    isLive = true;
    manualTime = new Date();
    sliderOffsetHours = 0;
    timeSlider.value = 0;
    selectedPresetKey = null;
    updateSliderLabel();
    updatePresetSelection();
    update(currentTime());
    liveBtn.classList.add('active');
    updatePermalink();
  });

  presetBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const key = this.getAttribute('data-preset');
      if (presets[key]) {
        isLive = false;
        manualTime = new Date(presets[key].getTime());
        sliderOffsetHours = 0;
        selectedPresetKey = key;
        timeSlider.value = 0;
        liveBtn.classList.remove('active');
        updateSliderLabel();
        updatePresetSelection();
        update(currentTime());
        updatePermalink();
      }
    });
  });

  // Permalink: keep the root URL clean unless the page was opened as an
  // explicit map view. Time travel still gets a shareable timestamp.
  let permalinkDebounce;
  function updatePermalink() {
    clearTimeout(permalinkDebounce);
    permalinkDebounce = setTimeout(() => {
      const params = new URLSearchParams();
      const time = currentTime();
      if (!isLive) {
        params.set('time', time.toISOString());
      }

      if (syncViewInUrl) {
        const center = map.getCenter();
        params.set('lat', center.lat.toFixed(4));
        params.set('lon', wrapLng(center.lng).toFixed(4));
        params.set('zoom', map.getZoom());
      }

      const query = params.toString();
      const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
    }, 300);
  }

  map.on('moveend', updatePermalink);
  map.on('zoomend', updatePermalink);

  function tick() {
    const now = currentTime();
    update(now);

    if (isLive) {
      updateSliderLabel();
    }

    if (followSun) {
      const subsolar = getSubsolarPoint(now);
      const currentCenter = map.getCenter();
      const newCenter = L.latLng(subsolar.lat, subsolar.lng);
      const distance = currentCenter.distanceTo(newCenter);
      if (distance > 100000) {
        map.panTo(newCenter, { animate: true, duration: 1 });
      }
    }
  }

  update(currentTime());
  subsolarLabel.addTo(map);
  timeSlider.value = 0;
  updateSliderLabel();
  if (initialTime) {
    liveBtn.classList.remove('active');
  }
  updatePresetSelection();
  followSunCheckbox.checked = followSun;
  setInterval(tick, 1000);
})();
