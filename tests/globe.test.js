const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const GlobeMath = require('../html/globe-math.js');
const SM = require('../html/solar.js');

const EPS = 1e-9;

describe('geoToVector3 — coordinate convention', () => {
  test('latitude 0, longitude 0 maps to +X (prime meridian on equator)', () => {
    const v = GlobeMath.geoToVector3(0, 0);
    assert.ok(Math.abs(v.x - 1) < EPS);
    assert.ok(Math.abs(v.y) < EPS);
    assert.ok(Math.abs(v.z) < EPS);
  });

  test('latitude 0, longitude +90 maps to −Z (90°E)', () => {
    const v = GlobeMath.geoToVector3(0, 90);
    assert.ok(Math.abs(v.x) < EPS);
    assert.ok(Math.abs(v.y) < EPS);
    assert.ok(Math.abs(v.z + 1) < EPS);
  });

  test('latitude 0, longitude −90 maps to +Z (90°W) — east/west not reversed', () => {
    const v = GlobeMath.geoToVector3(0, -90);
    assert.ok(Math.abs(v.x) < EPS);
    assert.ok(Math.abs(v.y) < EPS);
    assert.ok(Math.abs(v.z - 1) < EPS);
  });

  test('east and west map to opposite z signs', () => {
    const east = GlobeMath.geoToVector3(0, 90);
    const west = GlobeMath.geoToVector3(0, -90);
    assert.ok(east.z * west.z < 0);
  });

  test('North Pole maps to +Y — north/south not inverted', () => {
    const v = GlobeMath.geoToVector3(90, 0);
    assert.ok(Math.abs(v.y - 1) < EPS);
    assert.ok(Math.abs(v.x) < EPS);
    assert.ok(Math.abs(v.z) < EPS);
  });

  test('South Pole maps to −Y', () => {
    const v = GlobeMath.geoToVector3(-90, 0);
    assert.ok(Math.abs(v.y + 1) < EPS);
  });

  test('north and south poles map to opposite y signs', () => {
    const north = GlobeMath.geoToVector3(90, 0);
    const south = GlobeMath.geoToVector3(-90, 0);
    assert.ok(north.y * south.y < 0);
  });

  test('antimeridian: lng +180 and lng −180 map to the same vector (−X)', () => {
    const a = GlobeMath.geoToVector3(0, 180);
    const b = GlobeMath.geoToVector3(0, -180);
    assert.ok(Math.abs(a.x + 1) < EPS);
    assert.ok(Math.abs(a.x - b.x) < EPS);
    assert.ok(Math.abs(a.y - b.y) < EPS);
    assert.ok(Math.abs(a.z - b.z) < EPS);
  });

  test('longitudes wrap correctly (190° ≡ −170°)', () => {
    const a = GlobeMath.geoToVector3(10, 190);
    const b = GlobeMath.geoToVector3(10, -170);
    assert.ok(Math.abs(a.x - b.x) < EPS);
    assert.ok(Math.abs(a.y - b.y) < EPS);
    assert.ok(Math.abs(a.z - b.z) < EPS);
  });

  test('produces unit vectors for a spread of coordinates', () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lng = -180; lng < 180; lng += 45) {
        const v = GlobeMath.geoToVector3(lat, lng);
        assert.ok(GlobeMath.isUnitVector(v, 1e-9), `not unit at lat ${lat}, lng ${lng}`);
      }
    }
  });
});

describe('vector3ToGeo — inverse conversion', () => {
  test('round-trips known points', () => {
    const cases = [
      [0, 0], [0, 90], [0, -90], [45, 120], [-33.8688, 151.2093],
      [51.5074, -0.1278], [89, 0], [-89, 170], [0, 179], [0, -179]
    ];
    for (const [lat, lng] of cases) {
      const v = GlobeMath.geoToVector3(lat, lng);
      const g = GlobeMath.vector3ToGeo(v);
      assert.ok(Math.abs(g.lat - lat) < 1e-6, `lat mismatch for ${lat},${lng}: ${g.lat}`);
      assert.ok(Math.abs(g.lng - lng) < 1e-6, `lng mismatch for ${lat},${lng}: ${g.lng}`);
    }
  });

  test('antimeridian round-trip wraps to [-180, 180)', () => {
    const g = GlobeMath.vector3ToGeo(GlobeMath.geoToVector3(0, 180));
    assert.ok(Math.abs(g.lng + 180) < 1e-6);
  });

  test('pole round-trip keeps latitude sign', () => {
    const north = GlobeMath.vector3ToGeo(GlobeMath.geoToVector3(90, 42));
    const south = GlobeMath.vector3ToGeo(GlobeMath.geoToVector3(-90, 42));
    assert.ok(north.lat > 89.999999);
    assert.ok(south.lat < -89.999999);
  });

  test('non-unit input is normalized', () => {
    const g = GlobeMath.vector3ToGeo({ x: 5, y: 0, z: 0 });
    assert.ok(Math.abs(g.lat) < 1e-9);
    assert.ok(Math.abs(g.lng) < 1e-9);
  });
});

describe('invalid input handling', () => {
  test('geoToVector3 returns null for NaN / undefined / non-numbers', () => {
    assert.equal(GlobeMath.geoToVector3(NaN, 0), null);
    assert.equal(GlobeMath.geoToVector3(0, NaN), null);
    assert.equal(GlobeMath.geoToVector3(undefined, 0), null);
    assert.equal(GlobeMath.geoToVector3(0), null);
    assert.equal(GlobeMath.geoToVector3('0', 0), null);
    assert.equal(GlobeMath.geoToVector3(0, Infinity), null);
  });

  test('geoToVector3 clamps out-of-range latitudes', () => {
    const high = GlobeMath.geoToVector3(120, 0);
    const low = GlobeMath.geoToVector3(-120, 0);
    assert.ok(Math.abs(high.y - 1) < EPS);
    assert.ok(Math.abs(low.y + 1) < EPS);
  });

  test('vector3ToGeo returns null for invalid input', () => {
    assert.equal(GlobeMath.vector3ToGeo(null), null);
    assert.equal(GlobeMath.vector3ToGeo({ x: 1 }), null);
    assert.equal(GlobeMath.vector3ToGeo({ x: NaN, y: 0, z: 0 }), null);
    assert.equal(GlobeMath.vector3ToGeo({ x: 0, y: 0, z: 0 }), null);
  });

  test('sineSolarAltitude returns null for invalid input', () => {
    assert.equal(GlobeMath.sineSolarAltitude(null, 0, 0), null);
    assert.equal(GlobeMath.sineSolarAltitude({ x: 1, y: 0, z: 0 }, NaN, 0), null);
  });

  test('isUnitVector rejects zero and non-unit vectors', () => {
    assert.equal(GlobeMath.isUnitVector({ x: 0, y: 0, z: 0 }), false);
    assert.equal(GlobeMath.isUnitVector({ x: 0.5, y: 0.5, z: 0.5 }), false);
    assert.equal(GlobeMath.isUnitVector({ x: 1, y: 0, z: 0 }), true);
    assert.equal(GlobeMath.isUnitVector({ x: NaN, y: 0, z: 0 }), false);
  });
});

describe('sunDirection and sineSolarAltitude — alignment with SolarMath', () => {
  // Deterministic instants: seasonal events of 2026 (times from solar.test.js)
  const instants = {
    'March equinox 2026': '2026-03-20T14:38:00Z',
    'June solstice 2026': '2026-06-21T08:24:00Z',
    'September equinox 2026': '2026-09-23T00:16:00Z',
    'December solstice 2026': '2026-12-21T20:54:00Z'
  };

  test('sunDirection is the unit vector of the subsolar point', () => {
    for (const [name, iso] of Object.entries(instants)) {
      const date = new Date(iso);
      const sub = SM.getSubsolarPoint(date);
      const dir = GlobeMath.sunDirection(sub.lat, sub.lng);
      assert.ok(GlobeMath.isUnitVector(dir, 1e-9), name);

      const geo = GlobeMath.vector3ToGeo(dir);
      assert.ok(Math.abs(geo.lat - sub.lat) < 1e-6, `${name}: lat ${geo.lat} vs ${sub.lat}`);
      assert.ok(Math.abs(geo.lng - sub.lng) < 1e-6, `${name}: lng ${geo.lng} vs ${sub.lng}`);
    }
  });

  test('sun overhead at the subsolar point (sin altitude ≈ 1)', () => {
    for (const [name, iso] of Object.entries(instants)) {
      const date = new Date(iso);
      const sub = SM.getSubsolarPoint(date);
      const dir = GlobeMath.sunDirection(sub.lat, sub.lng);
      const sinAlt = GlobeMath.sineSolarAltitude(dir, sub.lat, sub.lng);
      assert.ok(sinAlt > 1 - 1e-9, `${name}: sinAlt ${sinAlt}`);
    }
  });

  test('deep night at the antipode of the subsolar point (sin altitude ≈ −1)', () => {
    for (const [name, iso] of Object.entries(instants)) {
      const date = new Date(iso);
      const sub = SM.getSubsolarPoint(date);
      const dir = GlobeMath.sunDirection(sub.lat, sub.lng);
      const sinAlt = GlobeMath.sineSolarAltitude(dir, -sub.lat, SM.wrapLng(sub.lng + 180));
      assert.ok(sinAlt < -1 + 1e-9, `${name}: sinAlt ${sinAlt}`);
    }
  });

  test('matches SolarMath.getSolarSinAltitude across a grid at all four instants', () => {
    for (const [name, iso] of Object.entries(instants)) {
      const date = new Date(iso);
      const sub = SM.getSubsolarPoint(date);
      const dir = GlobeMath.sunDirection(sub.lat, sub.lng);
      for (let lat = -70; lat <= 70; lat += 35) {
        for (let lng = -180; lng < 180; lng += 60) {
          const expected = SM.getSolarSinAltitude(date, lat, lng);
          const actual = GlobeMath.sineSolarAltitude(dir, lat, lng);
          assert.ok(
            Math.abs(actual - expected) < 1e-9,
            `${name}: lat ${lat}, lng ${lng}: globe ${actual} vs solar.js ${expected}`
          );
        }
      }
    }
  });

  test('daylight boundary agrees with the −0.833° refraction threshold', () => {
    const date = new Date(instants['March equinox 2026']);
    const sub = SM.getSubsolarPoint(date);
    const dir = GlobeMath.sunDirection(sub.lat, sub.lng);
    const threshold = SM.TWILIGHT_THRESHOLDS.daylight;

    // At the equinox, the daylight circle is a meridian: find the longitude
    // where sin(altitude) crosses the daylight threshold at the equator.
    const probe = lng => GlobeMath.sineSolarAltitude(dir, 0, lng);
    let lo = -170;
    let hi = 170;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if ((probe(lo) - threshold) * (probe(mid) - threshold) <= 0) hi = mid;
      else lo = mid;
    }
    const boundary = (lo + hi) / 2;
    // The terminator at the equator must sit 90° of longitude from the
    // subsolar meridian, plus the 0.833° refraction shift.
    assert.ok(Math.abs(Math.abs(boundary - sub.lng) - (90 + SM.REFRACTION)) < 0.02,
      `terminator at ${boundary}, subsolar at ${sub.lng}`);
  });
});
