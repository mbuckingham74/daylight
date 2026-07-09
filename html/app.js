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

  const mapCenter = (initialLat && initialLng) ? [initialLat, initialLng] : [20, 0];
  const mapZoom = initialZoom || 3;

  const map = L.map('map', {
    center: mapCenter,
    zoom: mapZoom,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: true,
    worldCopyJump: true
  });

  // Muted dark terrain-ish base + subtle reference overlay for borders/labels
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 16,
    noWrap: false
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: '',
    maxZoom: 16,
    noWrap: false,
    pane: 'overlayPane'
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
    lng = ((lng + 180) % 360) - 180;
    return { lat: sun.delta, lng };
  }

  // Generate points along a geodesic circle on the sphere.
  function geodesicCircle(lat0, lng0, radiusDeg, numPoints) {
    const points = [];
    const lat0r = lat0 * D2R;
    const lon0r = lng0 * D2R;
    const dr = radiusDeg * D2R;

    for (let i = 0; i <= numPoints; i++) {
      const bearing = i * 2 * Math.PI / numPoints;
      const lat = Math.asin(Math.sin(lat0r) * Math.cos(dr) +
        Math.cos(lat0r) * Math.sin(dr) * Math.cos(bearing));
      const lon = lon0r + Math.atan2(
        Math.sin(bearing) * Math.sin(dr) * Math.cos(lat0r),
        Math.cos(dr) - Math.sin(lat0r) * Math.sin(lat)
      );
      points.push([lat * R2D, lon * R2D]);
    }

    return points;
  }

  // Build a twilight band polygon. Bands are geodesic rings/caps centered on
  // the antisolar point. Angular radius from antipode = 90° + altitude.
  function computeTwilightBand(date, rOuter, rInner, isCap) {
    const subsolar = getSubsolarPoint(date);
    const antipode = [-subsolar.lat, subsolar.lng + 180];
    const poleLat = subsolar.lat > 0 ? -90 : 90;

    const outer = geodesicCircle(antipode[0], antipode[1], rOuter, 180);

    if (isCap) {
      // Night core: filled cap from outer boundary to pole
      return outer.concat([[poleLat, antipode[1] + 180]]);
    }

    const inner = geodesicCircle(antipode[0], antipode[1], rInner, 180);
    // Ring around the pole: outer clockwise, inner counter-clockwise,
    // connected via the pole.
    return outer
      .concat([[poleLat, antipode[1] + 180]])
      .concat(inner.reverse())
      .concat([[poleLat, antipode[1]]]);
  }

  // Twilight band layers (from lightest to darkest). Angular radii are measured
  // from the antisolar point: radius = 90° + solar altitude.
  const twilightDefs = [
    { rOuter: 90, rInner: 84, fillOpacity: 0.08, color: '#030816' },
    { rOuter: 84, rInner: 78, fillOpacity: 0.12, color: '#030816' },
    { rOuter: 78, rInner: 72, fillOpacity: 0.18, color: '#030816' },
    { rOuter: 72, rInner: 0, fillOpacity: 0.40, color: '#020612', isCap: true }
  ];

  const twilightLayers = twilightDefs.map(def => {
    return L.polygon([], {
      color: 'transparent',
      opacity: 0,
      fillColor: def.color,
      fillOpacity: def.fillOpacity,
      interactive: false,
      smoothFactor: 0
    }).addTo(map);
  });

  function updateTwilight(date) {
    twilightDefs.forEach((def, i) => {
      const ring = computeTwilightBand(date, def.rOuter, def.rInner, def.isCap);
      twilightLayers[i].setLatLngs([ring]);
    });
  }

  const subsolarMarker = L.circleMarker([0, 0], {
    radius: 8,
    fillColor: '#ffd700',
    color: '#ffaa00',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.9
  }).addTo(map);

  const subsolarLabel = L.tooltip({
    permanent: true,
    direction: 'right',
    offset: [10, 0],
    className: 'city-label'
  })
    .setContent('Subsolar point')
    .setLatLng([0, 0]);

  const cities = [
    { name: 'London', lat: 51.5074, lng: -0.1278 },
    { name: 'New York', lat: 40.7128, lng: -74.0060 },
    { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
    { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
    { name: 'São Paulo', lat: -23.5505, lng: -46.6333 },
    { name: 'Cairo', lat: 30.0444, lng: 31.2357 },
    { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
    { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
    { name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
    { name: 'Paris', lat: 48.8566, lng: 2.3522 },
    { name: 'Moscow', lat: 55.7558, lng: 37.6173 },
    { name: 'Beijing', lat: 39.9042, lng: 116.4074 },
    { name: 'Johannesburg', lat: -26.2041, lng: 28.0473 },
    { name: 'Dubai', lat: 25.2048, lng: 55.2708 },
    { name: 'Bangkok', lat: 13.7563, lng: 100.5018 }
  ];

  let cityLayer = L.layerGroup().addTo(map);

  function renderCities() {
    cityLayer.clearLayers();
    cities.forEach(city => {
      L.circleMarker([city.lat, city.lng], {
        radius: 3,
        fillColor: '#5b8cff',
        color: '#ffffff',
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.9
      }).addTo(cityLayer);

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
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function getMoonPhaseName(fraction) {
    const age = fraction * 29.53;
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
    document.getElementById('sun-position').textContent = `${subsolar.lat.toFixed(2)}°, ${subsolar.lng.toFixed(2)}°`;

    const greenwich = SunCalc.getTimes(date, 51.4769, -0.0005);
    const solarNoon = greenwich.solarNoon;
    document.getElementById('solar-noon').textContent = solarNoon && !isNaN(solarNoon) ? formatTime(solarNoon) + ' UTC' : '--:--';

    const moonIllum = SunCalc.getMoonIllumination(date);
    document.getElementById('moon-phase').textContent = getMoonPhaseName(moonIllum.fraction);
  }

  let hoverPopup = null;

  function updateHover(latlng) {
    const lat = latlng.lat;
    const lng = ((latlng.lng + 180) % 360) - 180;
    const now = currentTime();
    const times = SunCalc.getTimes(now, lat, lng);

    document.getElementById('hover-coords').textContent = formatCoord(lat, lng);
    document.getElementById('hover-sunrise').textContent = formatTime(times.sunrise) + ' local';
    document.getElementById('hover-sunset').textContent = formatTime(times.sunset) + ' local';

    let dayLength = 0;
    if (times.sunset && times.sunrise && !isNaN(times.sunset) && !isNaN(times.sunrise)) {
      dayLength = (times.sunset - times.sunrise) / 1000;
    }
    document.getElementById('hover-daylength').textContent = formatDuration(dayLength);

    if (hoverPopup) {
      map.closePopup(hoverPopup);
    }
    hoverPopup = L.popup({ autoClose: false, closeOnClick: false })
      .setLatLng(latlng)
      .setContent(`<strong>${formatCoord(lat, lng)}</strong><br>Sunrise: ${formatTime(times.sunrise)}<br>Sunset: ${formatTime(times.sunset)}<br>Daylight: ${formatDuration(dayLength)}`)
      .openOn(map);
  }

  let lastHover = null;
  map.on('mousemove', function (e) {
    if (e.latlng && (!lastHover || e.latlng.distanceTo(lastHover) > 50000)) {
      lastHover = e.latlng;
      updateHover(e.latlng);
    }
  });

  map.on('click', function (e) {
    updateHover(e.latlng);
  });

  // UI controls
  const followSunCheckbox = document.getElementById('follow-sun');
  const showTerminatorCheckbox = document.getElementById('show-terminator');
  const showCitiesCheckbox = document.getElementById('show-cities');
  const timeSlider = document.getElementById('time-slider');
  const timeSliderValue = document.getElementById('time-slider-value');
  const liveBtn = document.getElementById('live-btn');
  const presetBtns = document.querySelectorAll('[data-preset]');

  let followSun = true;
  let isLive = !initialTime;
  let manualTime = initialTime ? new Date(initialTime.getTime()) : new Date();
  let sliderOffsetHours = 0;

  function currentTime() {
    return isLive ? new Date() : new Date(manualTime.getTime());
  }

  function setFollowSun(enabled) {
    followSun = enabled;
    followSunCheckbox.checked = enabled;
    if (followSun) {
      subsolarMarker.addTo(map);
      subsolarLabel.addTo(map);
      const subsolar = getSubsolarPoint(currentTime());
      map.panTo([subsolar.lat, subsolar.lng], { animate: true, duration: 0.8 });
    } else {
      map.removeLayer(subsolarMarker);
      map.removeLayer(subsolarLabel);
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

  const twilightOpacities = twilightDefs.map(def => def.fillOpacity);
  showTerminatorCheckbox.addEventListener('change', function () {
    const visible = this.checked;
    terminator.setStyle({ fillOpacity: 0 });
    twilightLayers.forEach((layer, i) => {
      layer.setStyle({ fillOpacity: visible ? twilightOpacities[i] : 0 });
    });
  });

  showCitiesCheckbox.addEventListener('change', function () {
    if (this.checked) {
      map.addLayer(cityLayer);
    } else {
      map.removeLayer(cityLayer);
    }
  });

  // Time slider: range -12 to +12 hours from current moment
  function updateSliderFromTime() {
    const now = new Date();
    const target = currentTime();
    const diffMs = target.getTime() - now.getTime();
    sliderOffsetHours = diffMs / 3600000;
    // Clamp to slider range
    if (sliderOffsetHours < -12) sliderOffsetHours = -12;
    if (sliderOffsetHours > 12) sliderOffsetHours = 12;
    timeSlider.value = sliderOffsetHours;
    updateSliderLabel();
  }

  function updateSliderLabel() {
    const target = currentTime();
    if (isLive) {
      timeSliderValue.textContent = 'Live';
    } else {
      timeSliderValue.textContent = target.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }
  }

  let sliderRaf = null;
  timeSlider.addEventListener('input', function () {
    isLive = false;
    sliderOffsetHours = parseFloat(this.value);
    manualTime = new Date(Date.now() + sliderOffsetHours * 3600000);
    liveBtn.classList.remove('active');
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
    updateSliderFromTime();
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
        liveBtn.classList.remove('active');
        updateSliderFromTime();
        update(currentTime());
        updatePermalink();
      }
    });
  });

  // Permalink: time, lat, lon, zoom
  let permalinkDebounce;
  function updatePermalink() {
    clearTimeout(permalinkDebounce);
    permalinkDebounce = setTimeout(() => {
      const center = map.getCenter();
      const params = new URLSearchParams();
      const time = currentTime();
      if (!isLive) {
        params.set('time', time.toISOString());
      }
      params.set('lat', center.lat.toFixed(4));
      params.set('lon', center.lng.toFixed(4));
      params.set('zoom', map.getZoom());
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newUrl);
    }, 300);
  }

  map.on('moveend', updatePermalink);
  map.on('zoomend', updatePermalink);

  function tick() {
    const now = currentTime();
    update(now);

    if (isLive) {
      updateSliderFromTime();
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
  updateSliderFromTime();
  if (initialTime) {
    liveBtn.classList.remove('active');
  }
  setInterval(tick, 1000);
})();
