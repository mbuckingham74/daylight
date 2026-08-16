(function () {
  'use strict';

  // ── Dependency check ────────────────────────────────────────────────
  // If a required library failed to load from its CDN, show a non-blocking
  // error with a reload button. SolarMath is bundled locally so it should
  // always be available.
  const missingDeps = [];
  if (!window.SolarMath) missingDeps.push('Solar math module');
  if (!window.DaylightView) missingDeps.push('Map view module');
  if (!window.AppScheduler) missingDeps.push('App scheduler module');
  if (!window.SeasonYear) missingDeps.push('Season year module');
  if (!window.DaylightCities) missingDeps.push('City data module');
  if (!window.BrowserLocation) missingDeps.push('Browser location module');
  if (!window.SolarDetails) missingDeps.push('Solar details module');
  if (!window.UrlState) missingDeps.push('URL state module');
  if (!window.L) missingDeps.push('Leaflet (map library)');
  if (!window.SunCalc) missingDeps.push('SunCalc (sunrise/sunset times)');

  if (missingDeps.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'loading-error';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `<strong>${missingDeps.join(' and ')} could not be loaded.</strong><br>The map cannot run without it.<br><button onclick="window.location.reload()">Reload page</button>`;
    document.body.appendChild(banner);
    return;
  }

  const SM = window.SolarMath;
  const View = window.DaylightView;
  const scheduler = window.AppScheduler;
  const DaylightCities = window.DaylightCities;
  const BrowserLocation = window.BrowserLocation;
  const SolarDetails = window.SolarDetails;
  const UrlState = window.UrlState;
  const { getSeasonEventYear, isWithinSupportedRange } = window.SeasonYear;
  const {
    D2R, MS_PER_DAY, TWILIGHT_THRESHOLDS,
    normalizeDegrees, wrapLng, clamp,
    isValidDate, getSunEquatorial, getSubsolarPoint, getSunRenderState,
    getSolarSinAltitude, getEarthSunDistanceAu, getSolarOrbitStats,
    getEquationOfTimeMinutes, getSolarPosition, getGlobalLightFractions,
    getTwilightPixel, getNextSeasonEvent,
    getDayLengthSeconds: smGetDayLengthSeconds, getLightStateLabel
  } = SM;

  // Parse and validate permalink params on load. Invalid fields are ignored
  // individually so a single bad value doesn't break the whole page.
  const LEGACY_MAP_VIEW_STORAGE_KEY = 'daylight-map-view';
  const TIME_FORMAT_STORAGE_KEY = 'daylight-time-format';
  const WORLD_OVERVIEW_ZOOM = 2;
  const DEFAULT_MAP_CENTER = [20, 0];
  clearLegacyMapView();

  const parsedPermalink = SM.parsePermalinkParams(window.location.search);
  const { time: initialTime, lat: initialLat, lng: initialLng, zoom: initialZoom, invalid: invalidUrlParams } = parsedPermalink;
  let syncViewInUrl = parsedPermalink.hasView;

  const hasInitialCenter = !isNaN(initialLat) && !isNaN(initialLng);
  const mapCenter = hasInitialCenter
    ? [initialLat, initialLng]
    : DEFAULT_MAP_CENTER;
  const mapZoom = !isNaN(initialZoom)
    ? initialZoom
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

  function clearLegacyMapView() {
    try {
      window.localStorage.removeItem(LEGACY_MAP_VIEW_STORAGE_KEY);
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

  function getSolarDetailsTarget() {
    if (activeMapPoint) return activeMapPoint;
    const location = browserLocationController.getLocation();
    if (location) return location;

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

  function getPanelBoundsInMap() {
    const panel = document.getElementById('info-panel');
    if (!panel) return null;

    const mapRect = map.getContainer().getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      left: panelRect.left - mapRect.left,
      top: panelRect.top - mapRect.top,
      right: panelRect.right - mapRect.left,
      bottom: panelRect.bottom - mapRect.top,
      width: panelRect.width,
      height: panelRect.height
    };
  }

  function getMapSafeAreaCenter() {
    const size = map.getSize();
    const point = View.getSafeAreaCenter(
      { x: size.x, y: size.y },
      getPanelBoundsInMap()
    );
    return L.point(point.x, point.y);
  }

  function getTargetCenterForMapPoint(latlng, zoom = map.getZoom()) {
    const size = map.getSize();
    const safePoint = getMapSafeAreaCenter();
    const offset = View.getMapCenterOffset(
      { x: size.x, y: size.y },
      { x: safePoint.x, y: safePoint.y }
    );
    const displayLng = View.getNearestWorldLongitude(latlng.lng, map.getCenter().lng);
    const projectedPoint = map.project(L.latLng(latlng.lat, displayLng), zoom);
    return map.unproject(projectedPoint.add(L.point(offset.x, offset.y)), zoom);
  }

  function panMapPointToSafeCenter(latlng, duration = 0.8) {
    map.panTo(getTargetCenterForMapPoint(latlng), panOptions(duration));
  }

  function updateSunLabelPlacement() {
    const point = map.latLngToContainerPoint(subsolarMarker.getLatLng());
    const size = map.getSize();
    const placement = View.getEdgeAwareLabelPlacement(
      { x: point.x, y: point.y },
      { x: size.x, y: size.y }
    );
    subsolarLabel.options.direction = placement.direction;
    subsolarLabel.options.offset = L.point(placement.offset[0], placement.offset[1]);
    subsolarLabel.update();
  }

  // Canonical city data lives in cities.js (A-02): one record per city,
  // with the visible-marker subset selected by DaylightCities.markerCities.
  const cities = DaylightCities.markerCities;
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
        map.panTo([city.lat, city.lng], panOptions(0.8));
        setFollowSun(false);
        showLocationTimes(city.lat, city.lng, city.markerName || city.name, city.timeZone);
      });

      L.tooltip({
        permanent: true,
        direction: 'top',
        offset: [0, -6],
        className: 'city-label'
      })
        .setContent(city.markerName || city.name)
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

  const solarDetails = SolarDetails.create({
    getEl: id => document.getElementById(id),
    sun: {
      getSunEquatorial, getSubsolarPoint, getSolarOrbitStats, getSolarPosition,
      getNextSeasonEvent, getGlobalLightFractions, getEquationOfTimeMinutes,
      getEarthSunDistanceAu, wrapLng, D2R, MS_PER_DAY, clamp, isValidDate
    },
    sunCalc: SunCalc,
    getDayLengthSeconds,
    format: {
      formatMillions, formatLightTime, formatDegrees, formatSignedDegrees,
      formatRightAscension, formatSiderealTime, formatSignedDuration,
      formatCoord, formatDuration, formatPercent, formatSeasonCountdown,
      formatChartClock
    },
    setStatValue,
    setLightStats,
    getTarget: getSolarDetailsTarget,
    getDevicePixelRatio: () => window.devicePixelRatio || 1
  });
  // ── Reduced motion support ──────────────────────────────────────────
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  function prefersReducedMotion() {
    return reducedMotionQuery.matches;
  }
  function panOptions(defaultDuration) {
    return prefersReducedMotion()
      ? { animate: false }
      : { animate: true, duration: defaultDuration };
  }

  // ── State-aware update scheduler ────────────────────────────────────
  // The clock display updates every second. The expensive twilight tile
  // redraw and chart rendering run at a reduced rate (~20s) in live mode
  // and immediately on manual interaction (slider, preset, resize, hover
  // settle). In pinned/time-travel mode the displayed instant is static, so
  // the tick never schedules heavy work (D-02); interactions render directly.

  const LIVE_HEAVY_INTERVAL_MS = 20000;
  let lastHeavyUpdateMs = 0;

  function updateClock(date) {
    const subsolar = getSubsolarPoint(date);
    const displayLng = View.getNearestWorldLongitude(subsolar.lng, map.getCenter().lng);
    subsolarMarker.setLatLng([subsolar.lat, displayLng]);
    subsolarLabel.setLatLng([subsolar.lat, displayLng]);
    updateSunLabelPlacement();
    document.getElementById('utc-time').textContent = `${formatUtcDate(date)} ${formatClockTz(date, 'UTC')} UTC`;
    document.getElementById('sun-position').textContent = formatCoord(subsolar.lat, subsolar.lng);
  }

  function updateHeavy(date) {
    updateTwilight(date);

    const greenwich = SunCalc.getTimes(date, 51.4769, -0.0005);
    const solarNoon = greenwich.solarNoon;
    document.getElementById('solar-noon').textContent = solarNoon && !isNaN(solarNoon) ? formatTime(solarNoon) + ' UTC' : '--:--';

    const moonIllum = SunCalc.getMoonIllumination(date);
    document.getElementById('moon-phase').textContent = getMoonPhaseName(moonIllum.phase);
    refreshMapPointReadout(date);
    browserLocationController.refreshSunReadout(date);
    solarDetails.update(date);

    lastHeavyUpdateMs = Date.now();
  }

  function update(date) {
    updateClock(date);
    updateHeavy(date);
  }

  let activeMapPoint = null;
  let hoverDebounceTimer = null;
  const HOVER_DEBOUNCE_MS = 200;

  function updateHover(latlng, label = 'Hovered map point') {
    const lat = latlng.lat;
    const lng = (((latlng.lng + 180) % 360 + 360) % 360) - 180;
    activeMapPoint = { lat, lng, label, timeZone: lookupTimeZone(lat, lng) };

    // Update coordinates immediately (cheap)
    document.getElementById('location-info').querySelector('h2').textContent = label;
    document.getElementById('hover-coords').textContent = formatCoord(lat, lng);

    // Debounce the expensive sunrise/sunset and chart updates
    clearTimeout(hoverDebounceTimer);
    hoverDebounceTimer = setTimeout(() => {
      refreshMapPointReadout();
      solarDetails.update(currentTime());
      hoverDebounceTimer = null;
    }, HOVER_DEBOUNCE_MS);
  }

  // Show sunrise/sunset for a known location (city or "my location"). The
  // map card keeps UTC primary and adds the location's civil time underneath.
  function showLocationTimes(lat, lng, label, timeZone) {
    const normalizedLng = (((lng + 180) % 360 + 360) % 360) - 180;
    activeMapPoint = { lat, lng: normalizedLng, label, timeZone: timeZone || lookupTimeZone(lat, normalizedLng) };
    refreshMapPointReadout();
    solarDetails.update(currentTime());
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

  const browserLocationController = BrowserLocation.create({
    getEl: id => document.getElementById(id),
    map,
    L,
    view: View,
    sun: {
      getSolarSinAltitude, TWILIGHT_THRESHOLDS, isValidDate, MS_PER_DAY
    },
    sunCalc: SunCalc,
    format: {
      formatTimeTz, formatSignedDuration, formatDuration, formatPolarDayLength
    },
    setLightStats,
    getTimeZoneAbbr,
    getDayLengthSeconds,
    getCurrentTime: currentTime,
    cities: DaylightCities.locationCities,
    showLocationTimes,
    setFollowSun,
    centerMapOnLocation: (lat, lng) => {
      const location = L.latLng(lat, lng);
      map.setView(
        getTargetCenterForMapPoint(location, WORLD_OVERVIEW_ZOOM),
        WORLD_OVERVIEW_ZOOM,
        panOptions(0.8)
      );
    }
  });
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
  browserLocationController.initialize();
  myLocationBtn.addEventListener('click', function () {
    browserLocationController.request({ centerOnLocation: true, showTimes: true, updateButton: true });
  });

  // UI controls
  const centerSunBtn = document.getElementById('center-sun-btn');
  const resetViewBtn = document.getElementById('reset-view-btn');
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
  const datetimeInput = document.getElementById('datetime-input');
  const datetimeUtcHint = document.getElementById('datetime-utc-hint');
  const panelHandle = document.getElementById('panel-handle');

  // ── Mobile bottom sheet: collapsed/half/full states ─────────────────
  // Tapping the handle cycles through states. State is not persisted to
  // avoid trapping a returning user in a confusing layout.
  const panelStates = ['collapsed', 'half', 'full'];
  let panelStateIndex = 1;

  function applyPanelState() {
    panelStates.forEach(s => infoPanel.classList.remove(s));
    infoPanel.classList.add(panelStates[panelStateIndex]);
    if (followSun) {
      setTimeout(() => centerMapOnSun(0.3), 320);
    }
  }

  panelHandle.addEventListener('click', function () {
    panelStateIndex = (panelStateIndex + 1) % panelStates.length;
    applyPanelState();
  });

  const PRESET_KEYS = ['mar-equinox', 'jun-solstice', 'sep-equinox', 'dec-solstice'];

  function getPresetEventDate(key, year) {
    const events = SM.getSeasonEvents(year);
    switch (key) {
      case 'mar-equinox': return events[0].date;
      case 'jun-solstice': return events[1].date;
      case 'sep-equinox': return events[2].date;
      case 'dec-solstice': return events[3].date;
      default: return null;
    }
  }

  function getActiveYear() {
    if (isLive || !manualTime) return getSeasonEventYear(new Date());
    return getSeasonEventYear(manualTime);
  }

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
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });

    infoPanel.classList.toggle('details-active', pageId === 'solar-page');

    if (pageId === 'solar-page') {
      solarDetails.invalidate();
      solarDetails.update(currentTime());
    }
  }

  function focusTab(index) {
    const tab = panelTabs[index];
    if (tab) {
      setPanelPage(tab.getAttribute('data-panel-page'));
      tab.focus();
    }
  }

  panelTabs.forEach((tab, index) => {
    tab.addEventListener('click', function () {
      setPanelPage(this.getAttribute('data-panel-page'));
    });

    tab.addEventListener('keydown', function (e) {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          focusTab((index + 1) % panelTabs.length);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          focusTab((index - 1 + panelTabs.length) % panelTabs.length);
          break;
        case 'Home':
          e.preventDefault();
          focusTab(0);
          break;
        case 'End':
          e.preventDefault();
          focusTab(panelTabs.length - 1);
          break;
      }
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
    solarDetails.invalidate();
    update(currentTime());
    updateSliderLabel();
  }

  timeFormatBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      setTimeFormat(this.getAttribute('data-time-format'));
    });
  });

  window.addEventListener('resize', function () {
    solarDetails.invalidate();
    solarDetails.update(currentTime());
    updateSunLabelPlacement();
    if (followSun) centerMapOnSun(0.3);
  });

  function findPresetKeyForDate(date) {
    if (!isValidDate(date)) return null;
    const year = date.getUTCFullYear();
    return PRESET_KEYS.find(key => {
      const eventDate = getPresetEventDate(key, year);
      return eventDate && Math.abs(date.getTime() - eventDate.getTime()) < 3600000;
    }) || null;
  }

  function getPresetEventDateForActiveYear(key) {
    return getPresetEventDate(key, getActiveYear());
  }

  function formatLocalDateTime(date) {
    const timeZone = BrowserLocation.getBrowserTimeZone();
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
    const activeYear = getActiveYear();
    presetBtns.forEach(btn => {
      const key = btn.getAttribute('data-preset');
      const eventDate = getPresetEventDate(key, activeYear);
      if (eventDate) {
        btn.title = eventDate.toLocaleString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short'
        });
      }
      const active = !isLive && sliderOffsetHours === 0 && selectedPresetKey === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function centerMapOnSun(duration = 0.8) {
    const subsolar = getSubsolarPoint(currentTime());
    panMapPointToSafeCenter(L.latLng(subsolar.lat, subsolar.lng), duration);
  }

  function resetMapView() {
    syncViewInUrl = false;
    setFollowSun(false);
    map.setView(DEFAULT_MAP_CENTER, WORLD_OVERVIEW_ZOOM, panOptions(0.8));
    urlState.updatePermalink();
  }

  centerSunBtn.addEventListener('click', function () {
    centerMapOnSun();
  });

  resetViewBtn.addEventListener('click', resetMapView);

  // The Sun marker and label are always on the map. "Center Sun" is a
  // one-shot camera action; "Follow Sun" keeps it in the unobstructed area.
  function setFollowSun(enabled) {
    followSun = enabled;
    followSunCheckbox.checked = enabled;
    if (followSun) {
      centerMapOnSun();
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
      timeSlider.setAttribute('aria-valuetext', 'Live mode');
    } else {
      const utcText = `${formatUtcDate(target)} ${formatTime(target)} UTC`;
      const localText = formatLocalDateTime(target);
      timeSliderValue.textContent = `${utcText} / ${localText}`;
      const offsetDesc = sliderOffsetHours === 0
        ? 'at anchor time'
        : `${sliderOffsetHours > 0 ? '+' : ''}${sliderOffsetHours.toFixed(1)} hours from anchor`;
      timeSlider.setAttribute('aria-valuetext', `${offsetDesc}, ${utcText}`);
    }
  }

  // ── Datetime-local picker ───────────────────────────────────────────
  // Allows arbitrary date/time selection in the viewer's local timezone.
  // Shows the UTC equivalent and warns outside the 1900–2100 accuracy range.
  function formatDateTimeLocal(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function updateDateTimeInput() {
    if (isLive) {
      datetimeInput.value = '';
      datetimeInput.placeholder = 'Live mode — click to pick a time';
      datetimeUtcHint.textContent = '';
    } else {
      datetimeInput.value = formatDateTimeLocal(manualTime);
      const utcText = `${formatUtcDate(manualTime)} ${formatTime(manualTime)} UTC`;
      const outOfRange = !isWithinSupportedRange(manualTime);
      datetimeUtcHint.textContent = outOfRange
        ? `${utcText} — ⚠ outside 1900–2100 accuracy range`
        : utcText;
      datetimeUtcHint.classList.toggle('datetime-warning', outOfRange);
    }
  }

  datetimeInput.addEventListener('change', function () {
    if (!this.value) return;
    const parsed = new Date(this.value);
    if (isNaN(parsed.getTime())) return;
    isLive = false;
    manualTime = parsed;
    sliderOffsetHours = 0;
    selectedPresetKey = null;
    timeSlider.value = 0;
    liveBtn.classList.remove('active');
    updateSliderLabel();
    updateDateTimeInput();
    updatePresetSelection();
    update(currentTime());
    urlState.updatePermalink();
  });

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
    updateDateTimeInput();
    updatePresetSelection();
    urlState.updatePermalink();
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
    updateDateTimeInput();
    updatePresetSelection();
    update(currentTime());
    liveBtn.classList.add('active');
    urlState.updatePermalink();
  });

  presetBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const key = this.getAttribute('data-preset');
      const presetTime = getPresetEventDateForActiveYear(key);
      if (presetTime) {
        isLive = false;
        manualTime = new Date(presetTime.getTime());
        sliderOffsetHours = 0;
        selectedPresetKey = key;
        timeSlider.value = 0;
        liveBtn.classList.remove('active');
        updateSliderLabel();
        updateDateTimeInput();
        updatePresetSelection();
        update(currentTime());
        urlState.updatePermalink();
      }
    });
  });

  // ── Permalink, history, and Share / Copy Link ───────────────────────
  // URL serialization lives in url-state.js; this is the wiring point.
  const urlState = UrlState.create({
    getEl: id => document.getElementById(id),
    getTime: currentTime,
    isLive: () => isLive,
    getView: () => ({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom()
    }),
    getSyncView: () => syncViewInUrl,
    history: window.history,
    location: window.location,
    wrapLng
  });
  urlState.initShare();

  map.on('moveend', urlState.updatePermalink);
  map.on('zoomend', urlState.updatePermalink);
  map.on('move zoom resize', updateSunLabelPlacement);
  function tick() {
    if (document.hidden) return;

    const now = currentTime();
    const nowMs = Date.now();

    // Clock display updates every second (cheap)
    updateClock(now);

    // Heavy updates (twilight tiles, charts) run at a reduced rate in live
    // mode and never for a static pinned instant (D-02): explicit time
    // changes already rendered immediately through their own handlers.
    if (scheduler.shouldRunHeavyUpdate({
      isLive,
      nowMs,
      lastHeavyUpdateMs,
      heavyIntervalMs: LIVE_HEAVY_INTERVAL_MS
    })) {
      updateHeavy(now);
    }

    if (isLive) {
      updateSliderLabel();
    }

    if (followSun) {
      const subsolar = getSubsolarPoint(now);
      const currentCenter = map.getCenter();
      const sunPoint = L.latLng(subsolar.lat, subsolar.lng);
      const targetCenter = getTargetCenterForMapPoint(sunPoint);
      const distance = currentCenter.distanceTo(targetCenter);
      if (distance > 100000) {
        map.panTo(targetCenter, panOptions(1));
      }
    }
  }

  // Skip expensive work while the document is hidden. On visibility return,
  // catch up once immediately and resume the normal scheduler.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      const now = currentTime();
      update(now);
      if (isLive) updateSliderLabel();
    }
  });

  updateTimeFormatButtons();
  update(currentTime());
  subsolarLabel.addTo(map);
  timeSlider.value = 0;
  updateSliderLabel();
  updateDateTimeInput();
  if (initialTime) {
    liveBtn.classList.remove('active');
  }
  updatePresetSelection();
  followSunCheckbox.checked = followSun;

  if (invalidUrlParams.length > 0) {
    urlState.showUrlParamNotice(invalidUrlParams);
  }

  setInterval(tick, 1000);
})();
