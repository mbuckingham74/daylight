(function () {
  'use strict';

  const SM = window.SolarMath;
  const {
    D2R, MS_PER_DAY, TWILIGHT_THRESHOLDS,
    normalizeDegrees, wrapLng, clamp, clampZoom,
    isValidDate, getSunEquatorial, getSubsolarPoint, getSunRenderState,
    getSolarSinAltitude, getEarthSunDistanceAu, getSolarOrbitStats,
    getEquationOfTimeMinutes, getSolarPosition, getGlobalLightFractions,
    getTwilightPixel, getNextSeasonEvent,
    getDayLengthSeconds: smGetDayLengthSeconds, getLightStateLabel
  } = SM;

  // Parse and validate permalink params on load. Invalid fields are ignored
  // individually so a single bad value doesn't break the whole page.
  const urlParams = new URLSearchParams(window.location.search);
  const MAP_VIEW_STORAGE_KEY = 'daylight-map-view';
  const TIME_FORMAT_STORAGE_KEY = 'daylight-time-format';
  const WORLD_OVERVIEW_ZOOM = 2;
  const invalidUrlParams = [];

  const parsedTime = urlParams.has('time') ? new Date(urlParams.get('time')) : null;
  const initialTime = parsedTime && !isNaN(parsedTime.getTime()) ? parsedTime : null;
  if (urlParams.has('time') && !initialTime) invalidUrlParams.push('time');

  const parsedLat = parseFloat(urlParams.get('lat'));
  const parsedLng = parseFloat(urlParams.get('lon'));
  const parsedZoom = parseInt(urlParams.get('zoom'), 10);

  const initialLat = isFinite(parsedLat) && parsedLat >= -85 && parsedLat <= 85 ? parsedLat : NaN;
  const initialLng = isFinite(parsedLng) ? wrapLng(parsedLng) : NaN;
  const initialZoom = isFinite(parsedZoom) ? clampZoom(parsedZoom) : NaN;
  if (urlParams.has('lat') && isNaN(initialLat)) invalidUrlParams.push('lat');
  if (urlParams.has('lon') && isNaN(initialLng)) invalidUrlParams.push('lon');
  if (urlParams.has('zoom') && isNaN(parsedZoom)) invalidUrlParams.push('zoom');

  const syncViewInUrl = !isNaN(initialLat) || !isNaN(initialLng) || !isNaN(initialZoom);

  const storedMapView = syncViewInUrl ? null : getStoredMapView();
  const hasInitialCenter = !isNaN(initialLat) && !isNaN(initialLng);
  const mapCenter = hasInitialCenter
    ? [initialLat, initialLng]
    : storedMapView
      ? [storedMapView.lat, storedMapView.lng]
      : [20, 0];
  const mapZoom = !isNaN(initialZoom)
    ? initialZoom
    : storedMapView
      ? storedMapView.zoom
      : WORLD_OVERVIEW_ZOOM;
  let timeFormat = getStoredTimeFormat();

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

  function getStoredMapView() {
    try {
      const raw = window.localStorage.getItem(MAP_VIEW_STORAGE_KEY);
      if (!raw) return null;

      const view = JSON.parse(raw);
      const lat = parseFloat(view.lat);
      const lng = parseFloat(view.lng);
      const zoom = clampZoom(parseInt(view.zoom, 10));

      if (!isFinite(lat) || !isFinite(lng) || !isFinite(zoom)) return null;
      if (lat < -85 || lat > 85) return null;

      return { lat, lng: wrapLng(lng), zoom };
    } catch (e) {
      return null;
    }
  }

  function saveMapView() {
    try {
      const center = map.getCenter();
      window.localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({
        lat: Number(center.lat.toFixed(4)),
        lng: Number(wrapLng(center.lng).toFixed(4)),
        zoom: map.getZoom()
      }));
    } catch (e) {}
  }

  function clearStoredMapView() {
    try {
      window.localStorage.removeItem(MAP_VIEW_STORAGE_KEY);
    } catch (e) {}
  }

  function getStoredTimeFormat() {
    try {
      return window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY) === '12' ? '12' : '24';
    } catch (e) {
      return '24';
    }
  }

  function saveTimeFormat(format) {
    try {
      window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
    } catch (e) {}
  }

  function is12HourTime() {
    return timeFormat === '12';
  }

  // The daylight/twilight layer is rendered as canvas map tiles instead of
  // polygons. This keeps the overlay aligned through antimeridian wrapping,
  // world copies, and Web Mercator projection without hand-closing rings.
  // Solar math (subsolar point, twilight pixels, seasonal events) is provided
  // by solar.js via the SolarMath global.

  function getDayLengthSeconds(date, lat, lng) {
    return smGetDayLengthSeconds(date, lat, lng, SunCalc);
  }

  function getTwilightDurations(date, lat, lng) {
    const times = SunCalc.getTimes(date, lat, lng);
    const diffSeconds = (later, earlier) => {
      if (!isValidDate(later) || !isValidDate(earlier) || later <= earlier) return 0;
      return (later - earlier) / 1000;
    };
    const civil = diffSeconds(times.sunrise, times.dawn) + diffSeconds(times.dusk, times.sunset);
    const nautical = diffSeconds(times.dawn, times.nauticalDawn) + diffSeconds(times.nauticalDusk, times.dusk);
    const astronomical = diffSeconds(times.nauticalDawn, times.nightEnd) + diffSeconds(times.night, times.nauticalDusk);

    return {
      civil,
      nautical,
      astronomical,
      hasTransitions: civil + nautical + astronomical > 0
    };
  }

  function getSolarDetailsTarget() {
    if (activeMapPoint) return activeMapPoint;
    if (browserLocation) return browserLocation;

    const center = map.getCenter();
    const lat = clamp(center.lat, -85, 85);
    const lng = wrapLng(center.lng);
    return {
      lat,
      lng,
      label: 'Map center',
      timeZone: lookupTimeZone(lat, lng)
    };
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

  function getClockOptions(timeZone, includeSeconds = false) {
    const options = {
      hour: is12HourTime() ? 'numeric' : '2-digit',
      minute: '2-digit',
      hour12: is12HourTime()
    };
    if (includeSeconds) options.second = '2-digit';
    if (timeZone) options.timeZone = timeZone;
    return options;
  }

  function formatTime(date) {
    if (!date || isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-US', getClockOptions('UTC'));
  }

  function formatTimeTz(date, timeZone) {
    if (!date || isNaN(date.getTime())) return '--:--';
    if (!timeZone) return formatTime(date);
    try {
      return date.toLocaleTimeString('en-US', getClockOptions(timeZone));
    } catch (e) {
      return formatTime(date);
    }
  }

  function formatClockTz(date, timeZone) {
    if (!date || isNaN(date.getTime())) return '--:--:--';
    if (!timeZone) return date.toLocaleTimeString('en-US', getClockOptions('UTC', true));
    try {
      return date.toLocaleTimeString('en-US', getClockOptions(timeZone, true));
    } catch (e) {
      return date.toLocaleTimeString('en-US', getClockOptions('UTC', true));
    }
  }

  function formatUtcDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function lookupTimeZone(lat, lng) {
    if (typeof window.tzlookup !== 'function') return null;
    try {
      return window.tzlookup(lat, lng);
    } catch (e) {
      return null;
    }
  }

  function getTimeZoneLabel(timeZone, date) {
    if (!timeZone) return '';
    return getTimeZoneAbbr(timeZone, date) || timeZone;
  }

  function setStatValue(id, text) {
    const el = document.getElementById(id);
    el.classList.remove('stacked-value');
    el.textContent = text;
  }

  function setStackedTimeValue(id, primary, secondary) {
    const el = document.getElementById(id);
    el.classList.toggle('stacked-value', Boolean(secondary));
    el.textContent = '';

    const primaryLine = document.createElement('span');
    primaryLine.className = 'time-primary';
    primaryLine.textContent = primary;
    el.appendChild(primaryLine);

    if (secondary) {
      const secondaryLine = document.createElement('span');
      secondaryLine.className = 'time-secondary';
      secondaryLine.textContent = secondary;
      el.appendChild(secondaryLine);
    }
  }

  function setUtcAndLocalTimeValue(id, date, timeZone) {
    const utcText = formatTime(date) + ' UTC';
    const timeZoneLabel = getTimeZoneLabel(timeZone, date);
    const localText = timeZone && timeZoneLabel
      ? formatTimeTz(date, timeZone) + ' ' + timeZoneLabel
      : '';
    setStackedTimeValue(id, utcText, localText);
  }

  function setLocalClockValue(date, timeZone) {
    const timeZoneLabel = getTimeZoneLabel(timeZone, date);
    if (!timeZone || !timeZoneLabel) {
      setStatValue('hover-local-time', 'Unavailable');
      return;
    }

    setStatValue('hover-local-time', formatClockTz(date, timeZone) + ' ' + timeZoneLabel);
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function formatCompactDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const rounded = Math.round(seconds);
    const h = Math.floor(rounded / 3600);
    const m = Math.floor((rounded % 3600) / 60);
    const s = rounded % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatSignedDuration(seconds) {
    if (!isFinite(seconds)) return '--';
    const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : '';
    return sign + formatCompactDuration(Math.abs(seconds));
  }

  function formatDegrees(value, decimals = 2) {
    if (!isFinite(value)) return '--';
    return `${value.toFixed(decimals)}°`;
  }

  function getCompassDirection(degrees) {
    if (!isFinite(degrees)) return '';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(normalizeDegrees(degrees) / 45) % directions.length];
  }

  function formatSignedDegrees(value, decimals = 2) {
    if (!isFinite(value)) return '--';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${Math.abs(value).toFixed(decimals)}°`;
  }

  function formatRightAscension(degrees) {
    if (!isFinite(degrees)) return '--';
    const totalMinutes = Math.round(normalizeDegrees(degrees) / 15 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  function formatSiderealTime(degrees) {
    return formatRightAscension(degrees);
  }

  function formatPercent(value, decimals = 1) {
    if (!isFinite(value)) return '--';
    return `${(value * 100).toFixed(decimals)}%`;
  }

  function formatMillions(value) {
    if (!isFinite(value)) return '--';
    return `${(value / 1000000).toFixed(2)}M`;
  }

  function formatLightTime(seconds) {
    if (!isFinite(seconds)) return '--';
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
  }

  function formatSeasonCountdown(event, date) {
    if (!event) return '--';
    const remaining = event.date - date;
    if (remaining <= 0) return event.name;
    const hours = Math.round(remaining / 3600000);
    if (hours < 48) return `${event.name} in ${hours}h`;
    return `${event.name} in ${Math.round(remaining / MS_PER_DAY)}d`;
  }

  function formatChartClock(date) {
    return formatTime(date) + ' UTC';
  }

  function formatPolarDayLength(isDaylight) {
    return isDaylight ? '24h 0m' : '0h 0m';
  }

  function getDaylightWindows(date, lat, lng) {
    return [-1, 0, 1]
      .map(dayOffset => SunCalc.getTimes(new Date(date.getTime() + dayOffset * MS_PER_DAY), lat, lng))
      .filter(times => isValidDate(times.sunrise) && isValidDate(times.sunset) && times.sunset > times.sunrise)
      .map(times => ({ sunrise: times.sunrise, sunset: times.sunset }))
      .sort((a, b) => a.sunrise - b.sunrise);
  }

  function formatDaylightCountdown(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    return seconds < 3600 ? formatCompactDuration(seconds) : formatDuration(seconds);
  }

  function getDaylightRemainingText(date, lat, lng) {
    const daylightWindows = getDaylightWindows(date, lat, lng);
    for (const daylightWindow of daylightWindows) {
      if (date >= daylightWindow.sunrise && date < daylightWindow.sunset) {
        return `Ends in ${formatDaylightCountdown((daylightWindow.sunset - date) / 1000)}`;
      }

      if (date < daylightWindow.sunrise) {
        return `Starts in ${formatDaylightCountdown((daylightWindow.sunrise - date) / 1000)}`;
      }
    }

    const isDaylight = getSolarSinAltitude(date, lat, lng) >= TWILIGHT_THRESHOLDS.daylight;
    return isDaylight ? 'All day' : 'No daylight';
  }

  function setLightStats(stateId, remainingId, date, lat, lng) {
    setStatValue(stateId, getLightStateLabel(date, lat, lng));
    setStatValue(remainingId, getDaylightRemainingText(date, lat, lng));
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

  let lastChartSignature = '';

  function updateSolarDetails(date) {
    const solarPage = document.getElementById('solar-page');
    if (!solarPage || solarPage.hidden) return;

    const sun = getSunEquatorial(date);
    const subsolar = getSubsolarPoint(date);
    const antisolar = { lat: -subsolar.lat, lng: wrapLng(subsolar.lng + 180) };
    const orbit = getSolarOrbitStats(date);
    const target = getSolarDetailsTarget();
    const position = getSolarPosition(date, target.lat, target.lng);
    const dayLength = getDayLengthSeconds(date, target.lat, target.lng);
    const yesterdayLength = getDayLengthSeconds(new Date(date.getTime() - MS_PER_DAY), target.lat, target.lng);
    const tomorrowLength = getDayLengthSeconds(new Date(date.getTime() + MS_PER_DAY), target.lat, target.lng);
    const twilight = getTwilightDurations(date, target.lat, target.lng);
    const nextSeason = getNextSeasonEvent(date);
    const globalLight = getGlobalLightFractions();
    const shadowMultiplier = position.altitude > 0 ? 1 / Math.tan(position.altitude * D2R) : null;
    const noonAltitude = 90 - Math.abs(target.lat - sun.delta);
    const dailyChangeText = `${orbit.dailyChangeKm >= 0 ? '+' : '-'}${Math.abs(orbit.dailyChangeKm / 1000).toFixed(0)}k km/day`;

    setStatValue('solar-distance-au', `${orbit.distanceAu.toFixed(6)} AU`);
    setStatValue('solar-distance-km', `${formatMillions(orbit.distanceKm)} km / ${formatMillions(orbit.distanceMiles)} mi`);
    setStatValue('solar-light-time', formatLightTime(orbit.lightSeconds));
    setStatValue('solar-orbital-speed', `${orbit.orbitalSpeed.toFixed(2)} km/s`);
    setStatValue('solar-apparent-size', `${formatDegrees(orbit.apparentDiameterDeg, 3)} / ${(orbit.apparentDiameterDeg * 60).toFixed(2)}'`);
    setStatValue('solar-energy', `${(orbit.energyRatio * 100).toFixed(2)}% / ${Math.round(orbit.solarConstant)} W/m2`);
    document.getElementById('solar-distance-trend').textContent = `${orbit.trend} (${dailyChangeText})`;

    setStatValue('earth-axial-tilt', formatDegrees(sun.obliquity, 4));
    setStatValue('solar-declination', formatSignedDegrees(sun.delta, 3));
    setStatValue('solar-right-ascension', formatRightAscension(sun.alpha));
    setStatValue('solar-gmst', formatSiderealTime(sun.gmstDeg));
    setStatValue('equation-of-time', formatSignedDuration(getEquationOfTimeMinutes(date) * 60));
    setStatValue('antisolar-point', formatCoord(antisolar.lat, antisolar.lng));
    document.getElementById('next-season-event').textContent = formatSeasonCountdown(nextSeason, date);

    document.getElementById('detail-target-label').textContent = target.label || 'Selected point';
    setStatValue('detail-target-coords', formatCoord(target.lat, target.lng));
    setStatValue('local-sun-altitude', formatSignedDegrees(position.altitude, 2));
    setStatValue('local-sun-azimuth', `${formatDegrees(position.azimuth, 1)} ${getCompassDirection(position.azimuth)}`);
    setStatValue('local-sun-zenith', formatDegrees(position.zenith, 2));
    setStatValue('local-shadow-length', shadowMultiplier ? `${shadowMultiplier >= 99 ? '>99' : shadowMultiplier.toFixed(shadowMultiplier >= 10 ? 0 : 1)}x` : 'No direct Sun');
    setLightStats('local-light-state', 'local-daylight-remaining', date, target.lat, target.lng);
    setStatValue('local-noon-altitude', formatSignedDegrees(noonAltitude, 2));
    setStatValue('local-detail-daylength', formatDuration(dayLength));
    setStatValue('local-daylength-change', formatSignedDuration((tomorrowLength - yesterdayLength) / 2));
    setStatValue('local-civil-twilight', twilight.hasTransitions ? formatDuration(twilight.civil) : 'No transitions');
    setStatValue('local-deep-twilight', twilight.hasTransitions
      ? `${formatDuration(twilight.nautical)} + ${formatDuration(twilight.astronomical)}`
      : 'No transitions');

    setGlobalLightRow('global-daylight', 'global-daylight-bar', globalLight.daylight);
    setGlobalLightRow('global-civil', 'global-civil-bar', globalLight.civil);
    setGlobalLightRow('global-nautical', 'global-nautical-bar', globalLight.nautical);
    setGlobalLightRow('global-astro', 'global-astro-bar', globalLight.astronomical);
    setGlobalLightRow('global-night', 'global-night-bar', globalLight.night);
    document.getElementById('global-lit-summary').textContent = `Sun up or twilight ${formatPercent(1 - globalLight.night)}`;

    drawSolarCharts(date, target);
  }

  function setGlobalLightRow(valueId, barId, fraction) {
    setStatValue(valueId, formatPercent(fraction));
    document.getElementById(barId).style.width = formatPercent(fraction, 3);
  }

  function drawSolarCharts(date, target) {
    const solarPage = document.getElementById('solar-page');
    const panelWidth = Math.round(solarPage.getBoundingClientRect().width);
    const signature = [
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      target.lat.toFixed(2),
      target.lng.toFixed(2),
      target.label || '',
      panelWidth
    ].join('|');

    if (signature === lastChartSignature) return;
    lastChartSignature = signature;

    drawSolarYearChart(date);
    drawAnalemmaChart(date);
    drawDayLengthChart(date, target);
  }

  function setupCanvas(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width < 40 || height < 40) return null;

    const ratio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * ratio);
    const targetHeight = Math.round(height * ratio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function drawChartGrid(ctx, width, height, padding) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (height - padding.top - padding.bottom) * i / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (width - padding.left - padding.right) * i / 4;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  function plotLine(ctx, points, color, lineWidth = 2) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function plotCurrentMarker(ctx, x, y, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#101525';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawLegend(ctx, entries, x, y) {
    ctx.save();
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    let cursor = x;
    entries.forEach(entry => {
      ctx.fillStyle = entry.color;
      ctx.fillRect(cursor, y - 3, 10, 6);
      cursor += 14;
      ctx.fillStyle = '#cbd1df';
      ctx.fillText(entry.label, cursor, y);
      cursor += ctx.measureText(entry.label).width + 12;
    });
    ctx.restore();
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    const t = (value - inMin) / (inMax - inMin);
    return outMin + clamp(t, 0, 1) * (outMax - outMin);
  }

  function getYearStartAtCurrentClock(date) {
    return Date.UTC(
      date.getUTCFullYear(),
      0,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    );
  }

  function getDayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((today - start) / MS_PER_DAY);
  }

  function getYearDayCount(year) {
    return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  }

  function getYearSampleDates(date) {
    const year = date.getUTCFullYear();
    const dayCount = getYearDayCount(year);
    const start = getYearStartAtCurrentClock(date);
    return Array.from({ length: dayCount }, (_, index) => new Date(start + index * MS_PER_DAY));
  }

  function drawSolarYearChart(date) {
    const state = setupCanvas('solar-year-chart');
    if (!state) return;

    const { ctx, width, height } = state;
    const padding = { left: 36, right: 12, top: 16, bottom: 20 };
    const dates = getYearSampleDates(date);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxIndex = dates.length - 1;
    const declinationPoints = [];
    const distancePoints = [];

    drawChartGrid(ctx, width, height, padding);

    dates.forEach((sampleDate, index) => {
      const x = padding.left + plotWidth * index / maxIndex;
      const declination = getSunEquatorial(sampleDate).delta;
      const distanceAu = getEarthSunDistanceAu(sampleDate);
      declinationPoints.push({
        x,
        y: mapRange(declination, -24, 24, padding.top + plotHeight, padding.top)
      });
      distancePoints.push({
        x,
        y: mapRange(distanceAu, 0.983, 1.017, padding.top + plotHeight, padding.top)
      });
    });

    plotLine(ctx, declinationPoints, '#ffd85c', 2.2);
    plotLine(ctx, distancePoints, '#63d8ff', 1.8);
    const currentIndex = clamp(getDayOfYear(date), 0, maxIndex);
    const currentX = padding.left + plotWidth * currentIndex / maxIndex;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, height - padding.bottom);
    ctx.stroke();
    ctx.restore();
    plotCurrentMarker(ctx, declinationPoints[currentIndex].x, declinationPoints[currentIndex].y, '#ffd85c');
    drawLegend(ctx, [
      { label: 'declination', color: '#ffd85c' },
      { label: 'distance', color: '#63d8ff' }
    ], padding.left, height - 8);
  }

  function drawAnalemmaChart(date) {
    const state = setupCanvas('analemma-chart');
    if (!state) return;

    const { ctx, width, height } = state;
    const padding = { left: 34, right: 16, top: 16, bottom: 18 };
    const dates = getYearSampleDates(date);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const points = dates.map(sampleDate => {
      const eot = getEquationOfTimeMinutes(sampleDate);
      const declination = getSunEquatorial(sampleDate).delta;
      return {
        x: mapRange(eot, -16, 16, padding.left, padding.left + plotWidth),
        y: mapRange(declination, -24, 24, padding.top + plotHeight, padding.top)
      };
    });
    const currentPoint = {
      x: mapRange(getEquationOfTimeMinutes(date), -16, 16, padding.left, padding.left + plotWidth),
      y: mapRange(getSunEquatorial(date).delta, -24, 24, padding.top + plotHeight, padding.top)
    };

    drawChartGrid(ctx, width, height, padding);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(mapRange(0, -16, 16, padding.left, padding.left + plotWidth), padding.top);
    ctx.lineTo(mapRange(0, -16, 16, padding.left, padding.left + plotWidth), height - padding.bottom);
    ctx.moveTo(padding.left, mapRange(0, -24, 24, padding.top + plotHeight, padding.top));
    ctx.lineTo(width - padding.right, mapRange(0, -24, 24, padding.top + plotHeight, padding.top));
    ctx.stroke();
    ctx.restore();
    plotLine(ctx, points, '#ffd85c', 2);
    plotCurrentMarker(ctx, currentPoint.x, currentPoint.y, '#63d8ff');
    document.getElementById('analemma-clock-label').textContent = formatChartClock(date);
  }

  function drawDayLengthChart(date, target) {
    const state = setupCanvas('daylength-chart');
    if (!state) return;

    const { ctx, width, height } = state;
    const padding = { left: 34, right: 12, top: 16, bottom: 18 };
    const dates = getYearSampleDates(date);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxIndex = dates.length - 1;
    const points = dates.map((sampleDate, index) => {
      const hours = getDayLengthSeconds(sampleDate, target.lat, target.lng) / 3600;
      return {
        x: padding.left + plotWidth * index / maxIndex,
        y: mapRange(hours, 0, 24, padding.top + plotHeight, padding.top)
      };
    });
    const currentIndex = clamp(getDayOfYear(date), 0, maxIndex);

    drawChartGrid(ctx, width, height, padding);
    plotLine(ctx, points, '#7ee3a6', 2.2);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(points[currentIndex].x, padding.top);
    ctx.lineTo(points[currentIndex].x, height - padding.bottom);
    ctx.stroke();
    ctx.restore();
    plotCurrentMarker(ctx, points[currentIndex].x, points[currentIndex].y, '#7ee3a6');
    document.getElementById('daylength-chart-label').textContent = target.label || 'Selected point';
  }

  function update(date) {
    updateTwilight(date);

    const subsolar = getSubsolarPoint(date);
    subsolarMarker.setLatLng([subsolar.lat, subsolar.lng]);
    subsolarLabel.setLatLng([subsolar.lat, subsolar.lng]);

    document.getElementById('utc-time').textContent = `${formatUtcDate(date)} ${formatClockTz(date, 'UTC')} UTC`;
    document.getElementById('sun-position').textContent = formatCoord(subsolar.lat, subsolar.lng);

    const greenwich = SunCalc.getTimes(date, 51.4769, -0.0005);
    const solarNoon = greenwich.solarNoon;
    document.getElementById('solar-noon').textContent = solarNoon && !isNaN(solarNoon) ? formatTime(solarNoon) + ' UTC' : '--:--';

    const moonIllum = SunCalc.getMoonIllumination(date);
    document.getElementById('moon-phase').textContent = getMoonPhaseName(moonIllum.phase);
    refreshMapPointReadout(date);
    updateBrowserLocalSunReadout(date);
    updateSolarDetails(date);
  }

  let activeMapPoint = null;

  function updateHover(latlng, label = 'Hovered map point') {
    const lat = latlng.lat;
    const lng = (((latlng.lng + 180) % 360 + 360) % 360) - 180;
    activeMapPoint = { lat, lng, label, timeZone: lookupTimeZone(lat, lng) };
    refreshMapPointReadout();
    updateSolarDetails(currentTime());
  }

  // Show sunrise/sunset for a known location (city or "my location"). The
  // map card keeps UTC primary and adds the location's civil time underneath.
  function showLocationTimes(lat, lng, label, timeZone) {
    const normalizedLng = (((lng + 180) % 360 + 360) % 360) - 180;
    activeMapPoint = { lat, lng: normalizedLng, label, timeZone: timeZone || lookupTimeZone(lat, normalizedLng) };
    refreshMapPointReadout();
    updateSolarDetails(currentTime());
  }

  function refreshMapPointReadout(date = currentTime()) {
    if (!activeMapPoint) return;

    const { lat, lng, label, timeZone } = activeMapPoint;
    const times = SunCalc.getTimes(date, lat, lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset) && times.sunset > times.sunrise;

    document.getElementById('location-info').querySelector('h2').textContent = label;
    document.getElementById('hover-coords').textContent = formatCoord(lat, lng);
    setLocalClockValue(date, timeZone);

    if (hasSunTimes) {
      setUtcAndLocalTimeValue('hover-sunrise', times.sunrise, timeZone);
      setUtcAndLocalTimeValue('hover-sunset', times.sunset, timeZone);
      setLightStats('hover-light-state', 'hover-daylight-remaining', date, lat, lng);
      setStatValue('hover-daylength', formatDuration((times.sunset - times.sunrise) / 1000));
      return;
    }

    const isDaylight = getSolarSinAltitude(date, lat, lng) >= TWILIGHT_THRESHOLDS.daylight;
    setStatValue('hover-sunrise', 'No sunrise');
    setStatValue('hover-sunset', 'No sunset');
    setLightStats('hover-light-state', 'hover-daylight-remaining', date, lat, lng);
    setStatValue('hover-daylength', formatPolarDayLength(isDaylight));
  }

  function getTimeZoneAbbr(timeZone, date = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : '';
    } catch (e) {
      return '';
    }
  }

  let browserLocation = null;
  let browserLocationMarker = null;

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
    document.getElementById('browser-light-state').textContent = '--';
    document.getElementById('browser-daylight-remaining').textContent = '--';
    document.getElementById('browser-daylength').textContent = '--';
  }

  function updateBrowserLocalSunReadout(date = currentTime()) {
    if (!browserLocation) {
      resetBrowserLocalSunReadout();
      return;
    }

    const times = SunCalc.getTimes(date, browserLocation.lat, browserLocation.lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset) && times.sunset > times.sunrise;
    const tzSuffix = browserLocation.timeZone ? ' ' + getTimeZoneAbbr(browserLocation.timeZone, date) : ' UTC';

    if (hasSunTimes) {
      document.getElementById('browser-sunrise').textContent = formatTimeTz(times.sunrise, browserLocation.timeZone) + tzSuffix;
      document.getElementById('browser-sunset').textContent = formatTimeTz(times.sunset, browserLocation.timeZone) + tzSuffix;
      setLightStats('browser-light-state', 'browser-daylight-remaining', date, browserLocation.lat, browserLocation.lng);
      document.getElementById('browser-daylength').textContent = formatDuration((times.sunset - times.sunrise) / 1000);
      return;
    }

    const isDaylight = getSolarSinAltitude(date, browserLocation.lat, browserLocation.lng) >= TWILIGHT_THRESHOLDS.daylight;
    document.getElementById('browser-sunrise').textContent = 'No sunrise';
    document.getElementById('browser-sunset').textContent = 'No sunset';
    setLightStats('browser-light-state', 'browser-daylight-remaining', date, browserLocation.lat, browserLocation.lng);
    document.getElementById('browser-daylength').textContent = formatPolarDayLength(isDaylight);
  }

  function setBrowserNearestCityStatus(status) {
    document.getElementById('browser-nearest-city').textContent = status;
    browserLocation = null;
    clearBrowserLocationMarker();
    resetBrowserLocalSunReadout();
  }

  function clearBrowserLocationMarker() {
    if (!browserLocationMarker) return;
    map.removeLayer(browserLocationMarker);
    browserLocationMarker = null;
  }

  function updateBrowserLocationMarker(lat, lng, label) {
    const latlng = [lat, lng];

    if (!browserLocationMarker) {
      browserLocationMarker = L.circleMarker(latlng, {
        radius: 8,
        fillColor: '#2f8cff',
        color: '#ffffff',
        weight: 2,
        opacity: 0.95,
        fillOpacity: 0.95,
        interactive: true
      }).addTo(map);

      browserLocationMarker.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (!browserLocation) return;
        setFollowSun(false);
        showLocationTimes(
          browserLocation.lat,
          browserLocation.lng,
          browserLocation.label,
          browserLocation.timeZone
        );
      });
    } else {
      browserLocationMarker.setLatLng(latlng);
    }

    browserLocationMarker.bindTooltip(label, {
      direction: 'top',
      offset: [0, -10],
      className: 'city-label'
    });
    browserLocationMarker.bringToFront();
  }

  function centerMapOnBrowserLocation(lat, lng) {
    setFollowSun(false);
    map.setView([lat, lng], WORLD_OVERVIEW_ZOOM, { animate: true, duration: 0.8 });
  }

  function requestBrowserLocation(options = {}) {
    const { centerOnLocation = false, showTimes = false, updateButton = false } = options;
    const myLocationBtn = document.getElementById('my-location-btn');

    if (!navigator.geolocation) {
      setBrowserNearestCityStatus('Unavailable');
      if (updateButton) {
        myLocationBtn.textContent = 'Unsupported';
        setTimeout(() => { myLocationBtn.textContent = 'Use My Location'; }, 2000);
      }
      return;
    }

    setBrowserNearestCityStatus('Locating...');

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
        updateBrowserLocationMarker(lat, lng, browserLocation.label);
        updateBrowserLocalSunReadout();

        if (updateButton) {
          myLocationBtn.disabled = false;
          myLocationBtn.textContent = 'Use My Location';
        }

        if (centerOnLocation) {
          centerMapOnBrowserLocation(lat, lng);
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

    requestBrowserLocation({ centerOnLocation: !syncViewInUrl, updateButton: true });
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
  const homeLink = document.getElementById('home-link');
  const myLocationBtn = document.getElementById('my-location-btn');
  homeLink.addEventListener('click', clearStoredMapView);
  initializeBrowserLocationReadout();
  myLocationBtn.addEventListener('click', function () {
    requestBrowserLocation({ centerOnLocation: true, showTimes: true, updateButton: true });
  });

  // UI controls
  const followSunCheckbox = document.getElementById('follow-sun');
  const showTerminatorCheckbox = document.getElementById('show-terminator');
  const showCitiesCheckbox = document.getElementById('show-cities');
  const timeSlider = document.getElementById('time-slider');
  const timeSliderValue = document.getElementById('time-slider-value');
  const liveBtn = document.getElementById('live-btn');
  const presetBtns = document.querySelectorAll('[data-preset]');
  const infoPanel = document.getElementById('info-panel');
  const panelTabs = document.querySelectorAll('[data-panel-page]');
  const timeFormatBtns = document.querySelectorAll('[data-time-format]');

  const presets = {
    'mar-equinox': { year: 2026, month: 2, day: 20 },
    'jun-solstice': { year: 2026, month: 5, day: 21 },
    'sep-equinox': { year: 2026, month: 8, day: 23 },
    'dec-solstice': { year: 2026, month: 11, day: 21 }
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

  function setPanelPage(pageId) {
    document.querySelectorAll('.panel-page').forEach(page => {
      const active = page.id === pageId;
      page.hidden = !active;
      page.classList.toggle('active', active);
    });

    panelTabs.forEach(tab => {
      const active = tab.getAttribute('data-panel-page') === pageId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    infoPanel.classList.toggle('details-active', pageId === 'solar-page');

    if (pageId === 'solar-page') {
      lastChartSignature = '';
      updateSolarDetails(currentTime());
    }
  }

  panelTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      setPanelPage(this.getAttribute('data-panel-page'));
    });
  });

  function updateTimeFormatButtons() {
    timeFormatBtns.forEach(btn => {
      const active = btn.getAttribute('data-time-format') === timeFormat;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setTimeFormat(format) {
    if (format !== '12' && format !== '24') return;
    timeFormat = format;
    saveTimeFormat(format);
    updateTimeFormatButtons();
    lastChartSignature = '';
    update(currentTime());
    updateSliderLabel();
  }

  timeFormatBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      setTimeFormat(this.getAttribute('data-time-format'));
    });
  });

  window.addEventListener('resize', function () {
    lastChartSignature = '';
    updateSolarDetails(currentTime());
  });

  function findPresetKeyForDate(date) {
    if (!isValidDate(date)) return null;
    return Object.keys(presets).find(key => isSameLocalPresetDate(date, presets[key])) || null;
  }

  function isSameLocalPresetDate(date, preset) {
    return date.getFullYear() === preset.year
      && date.getMonth() === preset.month
      && date.getDate() === preset.day;
  }

  function getPresetTimeAtCurrentLocalClock(key) {
    const preset = presets[key];
    if (!preset) return null;
    const now = new Date();
    return new Date(
      preset.year,
      preset.month,
      preset.day,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );
  }

  function formatLocalDateTime(date) {
    const timeZone = getBrowserTimeZone();
    const timeZoneLabel = getTimeZoneLabel(timeZone, date);
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: is12HourTime() ? 'numeric' : '2-digit',
      minute: '2-digit',
      hour12: is12HourTime()
    };

    try {
      const text = date.toLocaleString('en-US', timeZone ? { ...options, timeZone } : options);
      return timeZoneLabel ? `${text} ${timeZoneLabel}` : text;
    } catch (e) {
      return date.toLocaleString('en-US', options);
    }
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
      const utcText = `${formatUtcDate(target)} ${formatTime(target)} UTC`;
      timeSliderValue.textContent = `${utcText} / ${formatLocalDateTime(target)}`;
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
        const presetTime = getPresetTimeAtCurrentLocalClock(key);
        isLive = false;
        manualTime = presetTime;
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
    saveMapView();
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

  function showUrlParamNotice(params) {
    const notice = document.createElement('div');
    notice.className = 'url-notice';
    notice.setAttribute('role', 'alert');
    notice.textContent = `Ignoring invalid URL parameter${params.length > 1 ? 's' : ''}: ${params.join(', ')}. Using default values.`;
    document.body.appendChild(notice);
    setTimeout(() => {
      notice.classList.add('url-notice--fade');
      setTimeout(() => notice.remove(), 500);
    }, 6000);
  }

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

  updateTimeFormatButtons();
  update(currentTime());
  subsolarLabel.addTo(map);
  timeSlider.value = 0;
  updateSliderLabel();
  if (initialTime) {
    liveBtn.classList.remove('active');
  }
  updatePresetSelection();
  followSunCheckbox.checked = followSun;

  if (invalidUrlParams.length > 0) {
    showUrlParamNotice(invalidUrlParams);
  }

  setInterval(tick, 1000);
})();
