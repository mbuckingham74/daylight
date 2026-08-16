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
 * formatting functions, SunCalc-backed readout helpers, app callbacks
 * such as showLocationTimes / setFollowSun / centerMapOnLocation, and the
 * canonical nearest-city collection from cities.js) are injected explicitly
 * through BrowserLocation.create(). Pure helpers (getDistanceKm,
 * findNearestBrowserCity, getBrowserTimeZone, getGeolocationErrorMessage)
 * are exported for direct unit testing without a browser.
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

  function findNearestBrowserCity(lat, lng, cities) {
    return cities.reduce((nearest, city) => {
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
      centerMapOnLocation, cities
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
    const nearestCity = findNearestBrowserCity(lat, lng, cities);
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
