const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const BrowserLocation = require('../html/browser-location.js');
const DaylightCities = require('../html/cities.js');

// Nearest-city coverage regression suite for the bounded geographic
// expansion. These points are deterministic reference locations; each
// must resolve to its own region's canonical city rather than a distant
// metro. The expansion's primary case is Forks, WA (Olympic Peninsula),
// which previously resolved to Seattle 158 km away.

const LOCATION_CITIES = DaylightCities.locationCities;

function nearestAt(lat, lng) {
  return BrowserLocation.findNearestBrowserCity(lat, lng, LOCATION_CITIES);
}

describe('coverage — Forks / Olympic Peninsula', () => {
  test('Forks resolves to Forks, not Seattle', () => {
    const nearest = nearestAt(47.9503, -124.3856);
    assert.equal(nearest.name, 'Forks, WA USA');
    assert.ok(nearest.distance < 5, `Forks should be ~0 km away, got ${nearest.distance.toFixed(1)} km`);
  });

  test('La Push / Olympic coast area resolves to Forks', () => {
    const nearest = nearestAt(47.9011, -124.6336);
    assert.equal(nearest.name, 'Forks, WA USA');
    assert.ok(nearest.distance < 30, `La Push should be near Forks, got ${nearest.distance.toFixed(1)} km`);
  });

  test('Seattle still resolves to Seattle', () => {
    const nearest = nearestAt(47.6062, -122.3321);
    assert.equal(nearest.name, 'Seattle, WA USA');
    assert.ok(nearest.distance < 1);
  });
});

describe('coverage — Washington state', () => {
  test('Bellingham (northern WA) resolves to Bellingham', () => {
    const nearest = nearestAt(48.75, -122.4833);
    assert.equal(nearest.name, 'Bellingham, WA USA');
    assert.ok(nearest.distance < 5);
  });

  test('Spokane (Inland Northwest) resolves to Spokane, not Seattle', () => {
    const nearest = nearestAt(47.6589, -117.425);
    assert.equal(nearest.name, 'Spokane, WA USA');
    assert.ok(nearest.distance < 5);
  });

  test('Port Angeles (north Olympic Peninsula) resolves to Port Angeles, not Forks', () => {
    const nearest = nearestAt(48.1264, -123.4778);
    assert.equal(nearest.name, 'Port Angeles, WA USA');
    assert.ok(nearest.distance < 5);
  });

  test('Pullman (Palouse / SE Washington) resolves to Pullman, not Spokane', () => {
    const nearest = nearestAt(46.7333, -117.1686);
    assert.equal(nearest.name, 'Pullman, WA USA');
    assert.ok(nearest.distance < 5);
  });
});

describe('coverage — Oregon', () => {
  test('Eugene (Willamette Valley) resolves to Eugene', () => {
    const nearest = nearestAt(44.0564, -123.1175);
    assert.equal(nearest.name, 'Eugene, OR USA');
    assert.ok(nearest.distance < 5);
  });

  test('Bend (central Oregon) resolves to Bend', () => {
    const nearest = nearestAt(44.0581, -121.3153);
    assert.equal(nearest.name, 'Bend, OR USA');
    assert.ok(nearest.distance < 5);
  });
});

describe('coverage — interior west', () => {
  test('Boise resolves to Boise, not Salt Lake City', () => {
    const nearest = nearestAt(43.6158, -116.2017);
    assert.equal(nearest.name, 'Boise, ID USA');
    assert.ok(nearest.distance < 5);
  });

  test('Missoula (western Montana) resolves to Missoula', () => {
    const nearest = nearestAt(46.8744, -114.0261);
    assert.equal(nearest.name, 'Missoula, MT USA');
    assert.ok(nearest.distance < 5);
  });

  test('Reno resolves to Reno, not San Francisco', () => {
    const nearest = nearestAt(39.5261, -119.8125);
    assert.equal(nearest.name, 'Reno, NV USA');
    assert.ok(nearest.distance < 5);
  });

  test('Albuquerque resolves to Albuquerque, not Phoenix', () => {
    const nearest = nearestAt(35.0844, -106.6503);
    assert.equal(nearest.name, 'Albuquerque, NM USA');
    assert.ok(nearest.distance < 5);
  });

  test('Tucson resolves to Tucson', () => {
    const nearest = nearestAt(32.2217, -110.9264);
    assert.equal(nearest.name, 'Tucson, AZ USA');
    assert.ok(nearest.distance < 5);
  });
});

describe('coverage — Alaska and Hawaii', () => {
  test('Anchorage resolves to Anchorage, not a lower-48 city', () => {
    const nearest = nearestAt(61.2167, -149.8936);
    assert.equal(nearest.name, 'Anchorage, AK USA');
    assert.ok(nearest.distance < 5);
  });

  test('Honolulu resolves to Honolulu', () => {
    const nearest = nearestAt(21.3, -157.85);
    assert.equal(nearest.name, 'Honolulu, HI USA');
    assert.ok(nearest.distance < 5);
  });
});

describe('coverage — western Canada', () => {
  test('Calgary resolves to Calgary, not Vancouver', () => {
    const nearest = nearestAt(51.0475, -114.0625);
    assert.equal(nearest.name, 'Calgary, AB Canada');
    assert.ok(nearest.distance < 5);
  });

  test('Saskatoon resolves to Saskatoon', () => {
    const nearest = nearestAt(52.1397, -106.6861);
    assert.equal(nearest.name, 'Saskatoon, SK Canada');
    assert.ok(nearest.distance < 5);
  });

  test('Winnipeg resolves to Winnipeg', () => {
    const nearest = nearestAt(49.8956, -97.1386);
    assert.equal(nearest.name, 'Winnipeg, MB Canada');
    assert.ok(nearest.distance < 5);
  });
});

describe('coverage — existing non-U.S. behavior preserved', () => {
  test('Sydney still resolves to Sydney', () => {
    const nearest = nearestAt(-33.86, 151.21);
    assert.equal(nearest.name, 'Sydney, Australia');
  });

  test('London still resolves to London', () => {
    const nearest = nearestAt(51.5074, -0.1278);
    assert.equal(nearest.name, 'London, UK');
    assert.ok(nearest.distance < 1);
  });

  test('Kansas City still resolves to Kansas City', () => {
    const nearest = nearestAt(39.0, -95.0);
    assert.equal(nearest.name, 'Kansas City, MO USA');
  });
});
