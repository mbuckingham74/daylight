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
    let lng = sun.alpha - sun.gmstDeg;
    lng = ((lng + 540) % 360) - 180;
    return { lat: sun.delta, lng };
  }

  // Wrap longitude to [-180, 180)
  function wrapLng(lng) {
    return ((lng + 540) % 360) - 180;
  }

  // The daylight/twilight layer is rendered as canvas map tiles instead of
  // polygons. This keeps the overlay aligned through antimeridian wrapping,
  // world copies, and Web Mercator projection without hand-closing rings.
  const REFRACTION = 0.833;
  const DAY_COLOR = [255, 205, 92];
  const TWILIGHT_COLOR = [5, 12, 30];
  const NIGHT_COLOR = [1, 4, 14];
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
      return { color: TWILIGHT_COLOR, alpha: Math.round(32 + 24 * amount) };
    }

    if (sinAltitude >= TWILIGHT_THRESHOLDS.nautical) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.civil, TWILIGHT_THRESHOLDS.nautical, sinAltitude);
      return { color: mixColor(TWILIGHT_COLOR, NIGHT_COLOR, 0.25), alpha: Math.round(68 + 26 * amount) };
    }

    if (sinAltitude >= TWILIGHT_THRESHOLDS.astronomical) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.nautical, TWILIGHT_THRESHOLDS.astronomical, sinAltitude);
      return { color: mixColor(TWILIGHT_COLOR, NIGHT_COLOR, 0.6), alpha: Math.round(106 + 30 * amount) };
    }

    return { color: NIGHT_COLOR, alpha: 156 };
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
  }

  function updateHover(latlng) {
    const lat = latlng.lat;
    const lng = (((latlng.lng + 180) % 360 + 360) % 360) - 180;
    const now = currentTime();
    const times = SunCalc.getTimes(now, lat, lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset);

    document.getElementById('location-info').querySelector('h2').textContent = 'Hover a location';
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
    updateHover(e.latlng);
  });

  // "Use My Location" — browser geolocation. Times display in the browser's
  // local timezone, which is correct because the user is physically there.
  const myLocationBtn = document.getElementById('my-location-btn');
  myLocationBtn.addEventListener('click', function () {
    if (!navigator.geolocation) {
      myLocationBtn.textContent = 'Unsupported';
      setTimeout(() => { myLocationBtn.textContent = 'Use My Location'; }, 2000);
      return;
    }
    myLocationBtn.disabled = true;
    myLocationBtn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        myLocationBtn.disabled = false;
        myLocationBtn.textContent = 'Use My Location';
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setFollowSun(false);
        map.panTo([lat, lng], { animate: true, duration: 0.8 });
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
        showLocationTimes(lat, lng, 'Your location', tz);
      },
      function (err) {
        myLocationBtn.disabled = false;
        myLocationBtn.textContent = 'Use My Location';
        const messages = {
          1: 'Location permission denied.',
          2: 'Location unavailable.',
          3: 'Location request timed out.'
        };
        myLocationBtn.textContent = messages[err.code] || 'Location error';
        setTimeout(() => { myLocationBtn.textContent = 'Use My Location'; }, 2500);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });

  // UI controls
  const followSunCheckbox = document.getElementById('follow-sun');
  const showTerminatorCheckbox = document.getElementById('show-terminator');
  const showCitiesCheckbox = document.getElementById('show-cities');
  const timeSlider = document.getElementById('time-slider');
  const timeSliderValue = document.getElementById('time-slider-value');
  const liveBtn = document.getElementById('live-btn');
  const presetBtns = document.querySelectorAll('[data-preset]');

  let followSun = false;
  let isLive = !initialTime;
  let manualTime = initialTime ? new Date(initialTime.getTime()) : new Date();
  let sliderOffsetHours = 0;

  function currentTime() {
    if (isLive) return new Date();
    return new Date(manualTime.getTime() + sliderOffsetHours * 3600000);
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
    }
    sliderOffsetHours = parseFloat(this.value);
    updateSliderLabel();
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
    updateSliderLabel();
    update(currentTime());
    liveBtn.classList.add('active');
    updatePermalink();
  });

  const presets = {
    'mar-equinox': new Date('2026-03-20T14:46:00Z'),
    'jun-solstice': new Date('2026-06-21T10:50:00Z'),
    'sep-equinox': new Date('2026-09-23T02:19:00Z'),
    'dec-solstice': new Date('2026-12-21T15:59:00Z')
  };

  presetBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const key = this.getAttribute('data-preset');
      if (presets[key]) {
        isLive = false;
        manualTime = new Date(presets[key].getTime());
        sliderOffsetHours = 0;
        timeSlider.value = 0;
        liveBtn.classList.remove('active');
        updateSliderLabel();
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
  followSunCheckbox.checked = followSun;
  setInterval(tick, 1000);
})();
