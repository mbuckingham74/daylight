/**
 * browser-location.js — Browser-geolocation controller for the Daylight map.
 *
 * UMD module: works in the browser (exposes window.BrowserLocation) and in
 * Node (exports the same functions for unit testing), matching solar.js /
 * view.js / app-scheduler.js.
 *
 * Owns the "Use My Location" subsystem extracted from app.js (A-01): the
 * browser-reported geolocation state, the nearest-city lookup, the location
 * marker, and the sunrise/sunset/daylight readouts for the user's actual
 * position. All external dependencies (Leaflet, the map, view helpers,
 * formatting functions, SunCalc-backed readout helpers, and app callbacks
 * such as showLocationTimes / setFollowSun / centerMapOnLocation) are
 * injected explicitly through BrowserLocation.create(). Pure helpers
 * (getDistanceKm, findNearestBrowserCity, getBrowserTimeZone,
 * getGeolocationErrorMessage) are exported for direct unit testing without
 * a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BrowserLocation = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const D2R = Math.PI / 180;

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

  function getGeolocationErrorMessage(code) {
    const messages = {
      1: 'Permission denied',
      2: 'Location unavailable',
      3: 'Request timed out'
    };
    return messages[code] || 'Location error';
  }

  function create(deps) {
    const {
      getEl, map, L, view, sun, sunCalc, format, setLightStats, getTimeZoneAbbr,
      getDayLengthSeconds, getCurrentTime, showLocationTimes, setFollowSun,
      centerMapOnLocation
    } = deps;
    const { getSolarSinAltitude, TWILIGHT_THRESHOLDS, isValidDate, MS_PER_DAY } = sun;
    const { formatTimeTz, formatSignedDuration, formatDuration, formatPolarDayLength } = format;

    let browserLocation = null;
    let browserLocationMarker = null;
  function updateBrowserTimezoneReadout() {
    const timeZone = getBrowserTimeZone();
    getEl('browser-timezone').textContent = timeZone || 'Unavailable';
    return timeZone;
  }

  function updateBrowserNearestCityReadout(lat, lng) {
    const nearestCity = findNearestBrowserCity(lat, lng);
    getEl('browser-nearest-city').textContent = nearestCity ? nearestCity.name : 'Unavailable';
    return nearestCity;
  }

  function resetBrowserLocalSunReadout() {
    getEl('browser-sunrise').textContent = '--';
    getEl('browser-sunset').textContent = '--';
    getEl('browser-light-state').textContent = '--';
    getEl('browser-daylight-remaining').textContent = '--';
    getEl('browser-daylength').textContent = '--';
    getEl('browser-daylength-change').textContent = '--';
  }

  function updateBrowserLocalSunReadout(date = getCurrentTime()) {
    if (!browserLocation) {
      resetBrowserLocalSunReadout();
      return;
    }

    const times = sunCalc.getTimes(date, browserLocation.lat, browserLocation.lng);
    const hasSunTimes = isValidDate(times.sunrise) && isValidDate(times.sunset) && times.sunset > times.sunrise;
    const tzSuffix = browserLocation.timeZone ? ' ' + getTimeZoneAbbr(browserLocation.timeZone, date) : ' UTC';

    const yesterdayLen = getDayLengthSeconds(new Date(date.getTime() - MS_PER_DAY), browserLocation.lat, browserLocation.lng);
    const tomorrowLen = getDayLengthSeconds(new Date(date.getTime() + MS_PER_DAY), browserLocation.lat, browserLocation.lng);
    getEl('browser-daylength-change').textContent = formatSignedDuration((tomorrowLen - yesterdayLen) / 2);

    if (hasSunTimes) {
      getEl('browser-sunrise').textContent = formatTimeTz(times.sunrise, browserLocation.timeZone) + tzSuffix;
      getEl('browser-sunset').textContent = formatTimeTz(times.sunset, browserLocation.timeZone) + tzSuffix;
      setLightStats('browser-light-state', 'browser-daylight-remaining', date, browserLocation.lat, browserLocation.lng);
      getEl('browser-daylength').textContent = formatDuration((times.sunset - times.sunrise) / 1000);
      return;
    }

    const isDaylight = getSolarSinAltitude(date, browserLocation.lat, browserLocation.lng) >= TWILIGHT_THRESHOLDS.daylight;
    getEl('browser-sunrise').textContent = 'No sunrise';
    getEl('browser-sunset').textContent = 'No sunset';
    setLightStats('browser-light-state', 'browser-daylight-remaining', date, browserLocation.lat, browserLocation.lng);
    getEl('browser-daylength').textContent = formatPolarDayLength(isDaylight);
  }

  function setBrowserLocationStatus(status) {
    getEl('browser-location-status').textContent = status;
  }

  function setBrowserLocationDetailsVisible(visible) {
    const details = getEl('browser-location-details');
    const card = getEl('browser-location-info');
    const button = getEl('my-location-btn');
    details.hidden = !visible;
    card.classList.toggle('has-location', visible);
    button.setAttribute('aria-expanded', visible ? 'true' : 'false');
  }

  function clearBrowserLocationReadout() {
    browserLocation = null;
    getEl('browser-nearest-city').textContent = '--';
    clearBrowserLocationMarker();
    resetBrowserLocalSunReadout();
    setBrowserLocationDetailsVisible(false);
  }

  function getLocationButtonLabel() {
    return browserLocation ? 'Update My Location' : 'Use My Location';
  }

  function clearBrowserLocationMarker() {
    if (!browserLocationMarker) return;
    map.removeLayer(browserLocationMarker);
    browserLocationMarker = null;
  }

  function updateBrowserLocationMarker(lat, lng, label) {
    const displayLng = view.getNearestWorldLongitude(lng, map.getCenter().lng);
    const latlng = [lat, displayLng];

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
    centerMapOnLocation(lat, lng);
  }

  function requestBrowserLocation(options = {}) {
    const { centerOnLocation = false, showTimes = false, updateButton = false } = options;
    const myLocationBtn = getEl('my-location-btn');

    if (!navigator.geolocation) {
      clearBrowserLocationReadout();
      setBrowserLocationStatus('Geolocation is not supported by this browser.');
      if (updateButton) {
        myLocationBtn.disabled = true;
        myLocationBtn.textContent = 'Unsupported';
      }
      return;
    }

    setBrowserLocationStatus('Requesting your current location...');

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
        setBrowserLocationDetailsVisible(true);
        setBrowserLocationStatus(`Using your browser-reported location near ${browserLocation.label}.`);

        if (updateButton) {
          myLocationBtn.disabled = false;
          myLocationBtn.textContent = getLocationButtonLabel();
        }

        if (centerOnLocation) {
          centerMapOnBrowserLocation(lat, lng);
        }

        if (showTimes) {
          showLocationTimes(lat, lng, browserLocation.label, tz);
        }
      },
      function (err) {
        const message = getGeolocationErrorMessage(err.code);
        clearBrowserLocationReadout();
        setBrowserLocationStatus(`${message}. You can update the site's location permission and try again.`);

        if (updateButton) {
          myLocationBtn.disabled = false;
          myLocationBtn.textContent = message;
          setTimeout(() => { myLocationBtn.textContent = getLocationButtonLabel(); }, 2500);
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  function initializeBrowserLocationReadout() {
    updateBrowserTimezoneReadout();
    clearBrowserLocationReadout();

    if (!navigator.geolocation) {
      setBrowserLocationStatus('Geolocation is not supported by this browser.');
      const button = getEl('my-location-btn');
      button.disabled = true;
      button.textContent = 'Unsupported';
    } else {
      setBrowserLocationStatus('See sunrise, sunset, and daylight for your current location.');
    }
  }
    return {
      initialize: initializeBrowserLocationReadout,
      request: requestBrowserLocation,
      refreshSunReadout: updateBrowserLocalSunReadout,
      getLocation: function () { return browserLocation; }
    };
  }

  return {
    create,
    getDistanceKm,
    findNearestBrowserCity,
    getBrowserTimeZone,
    getGeolocationErrorMessage
  };
}));
