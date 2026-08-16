const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const BrowserLocation = require('../html/browser-location.js');
const DaylightCities = require('../html/cities.js');

// The nearest-city collection comes from the canonical cities.js module
// (A-02); findNearestBrowserCity takes it explicitly.
const LOCATION_CITIES = DaylightCities.locationCities;

describe('browser location — great-circle distance', () => {
  test('computes a known London-New York distance', () => {
    const km = BrowserLocation.getDistanceKm(51.5074, -0.1278, 40.7128, -74.0060);
    assert.ok(Math.abs(km - 5570) < 20, `London-NY should be ~5570 km, got ${km}`);
  });

  test('identical points are zero distance', () => {
    assert.equal(BrowserLocation.getDistanceKm(47.6062, -122.3321, 47.6062, -122.3321), 0);
  });

  test('distance is symmetric', () => {
    const a = BrowserLocation.getDistanceKm(-33.8688, 151.2093, 35.6762, 139.6503);
    const b = BrowserLocation.getDistanceKm(35.6762, 139.6503, -33.8688, 151.2093);
    assert.ok(Math.abs(a - b) < 1e-6);
  });
});

describe('browser location — nearest-city lookup', () => {
  test('exact Seattle coordinates resolve to Seattle, WA USA', () => {
    const nearest = BrowserLocation.findNearestBrowserCity(47.6062, -122.3321, LOCATION_CITIES);
    assert.equal(nearest.name, 'Seattle, WA USA');
    assert.ok(nearest.distance < 1);
  });

  test('San Francisco Bay coordinates resolve to San Francisco', () => {
    const nearest = BrowserLocation.findNearestBrowserCity(37.77, -122.42, LOCATION_CITIES);
    assert.equal(nearest.name, 'San Francisco, CA USA');
  });

  test('midwest coordinates resolve to Kansas City', () => {
    const nearest = BrowserLocation.findNearestBrowserCity(39.0, -95.0, LOCATION_CITIES);
    assert.equal(nearest.name, 'Kansas City, MO USA');
  });

  test('southern-hemisphere coordinates resolve to Sydney', () => {
    const nearest = BrowserLocation.findNearestBrowserCity(-33.86, 151.21, LOCATION_CITIES);
    assert.equal(nearest.name, 'Sydney, Australia');
  });

  test('the nearest-city result carries the matched dataset entry', () => {
    const nearest = BrowserLocation.findNearestBrowserCity(40.7128, -74.0060, LOCATION_CITIES);
    assert.equal(nearest.name, 'New York, NY USA');
    assert.equal(nearest.lat, 40.7128);
    assert.equal(nearest.lng, -74.0060);
  });

  test('nearest-city lookup sees the canonical shared records', () => {
    const nearest = BrowserLocation.findNearestBrowserCity(47.6062, -122.3321, LOCATION_CITIES);
    const canonical = DaylightCities.locationCities[0];
    assert.equal(nearest.name, canonical.name);
    assert.equal(nearest.lat, canonical.lat);
    assert.equal(nearest.lng, canonical.lng);
  });
});

describe('browser location — geolocation error messages', () => {
  test('maps the three standard geolocation error codes', () => {
    assert.equal(BrowserLocation.getGeolocationErrorMessage(1), 'Permission denied');
    assert.equal(BrowserLocation.getGeolocationErrorMessage(2), 'Location unavailable');
    assert.equal(BrowserLocation.getGeolocationErrorMessage(3), 'Request timed out');
  });

  test('unknown codes fall back to a generic message', () => {
    assert.equal(BrowserLocation.getGeolocationErrorMessage(0), 'Location error');
    assert.equal(BrowserLocation.getGeolocationErrorMessage(999), 'Location error');
  });
});
