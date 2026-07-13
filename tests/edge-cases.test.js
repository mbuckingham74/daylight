const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../html/solar.js');

describe('Polar day/night — Arctic Circle (June solstice)', () => {
  test('Sun above horizon at midnight during polar day', () => {
    const june = SM.getSeasonEvents(2026)[1].date;
    // At 80°N during June solstice, the Sun should never set
    // Check at local "midnight" (lng=0, so midnight ≈ 00:00 UTC)
    const midnight = new Date(june.getTime());
    midnight.setUTCHours(0, 0, 0, 0);
    const sinAlt = SM.getSolarSinAltitude(midnight, 80, 0);
    assert.ok(sinAlt > SM.TWILIGHT_THRESHOLDS.daylight,
      `Expected Sun above horizon at 80°N midnight in June, sinAlt=${sinAlt}`);
  });

  test('Sun below horizon at noon during polar night (December)', () => {
    const dec = SM.getSeasonEvents(2026)[3].date;
    // At 85°N during December solstice, the Sun should never rise
    // Noon altitude ≈ 90 - |85 - (-23.44)| = -18.44° (below astronomical twilight)
    const noon = new Date(dec.getTime());
    noon.setUTCHours(12, 0, 0, 0);
    const sinAlt = SM.getSolarSinAltitude(noon, 85, 0);
    assert.ok(sinAlt < SM.TWILIGHT_THRESHOLDS.astronomical,
      `Expected Sun below astronomical twilight at 85°N noon in December, sinAlt=${sinAlt}`);
  });
});

describe('Polar day/night — Antarctic Circle (December solstice)', () => {
  test('Sun above horizon at midnight during polar day', () => {
    const dec = SM.getSeasonEvents(2026)[3].date;
    // At -80° during December solstice, the Sun should never set
    const midnight = new Date(dec.getTime());
    midnight.setUTCHours(0, 0, 0, 0);
    const sinAlt = SM.getSolarSinAltitude(midnight, -80, 0);
    assert.ok(sinAlt > SM.TWILIGHT_THRESHOLDS.daylight,
      `Expected Sun above horizon at 80°S midnight in December, sinAlt=${sinAlt}`);
  });

  test('Sun below horizon at noon during polar night (June)', () => {
    const june = SM.getSeasonEvents(2026)[1].date;
    // At 85°S during June solstice, noon altitude ≈ -18.44° (below astronomical twilight)
    const noon = new Date(june.getTime());
    noon.setUTCHours(12, 0, 0, 0);
    const sinAlt = SM.getSolarSinAltitude(noon, -85, 0);
    assert.ok(sinAlt < SM.TWILIGHT_THRESHOLDS.astronomical,
      `Expected Sun below astronomical twilight at 85°S noon in June, sinAlt=${sinAlt}`);
  });
});

describe('Polar day/night — getLightStateLabel at poles', () => {
  test('Returns Daylight during polar day', () => {
    const june = SM.getSeasonEvents(2026)[1].date;
    const midnight = new Date(june.getTime());
    midnight.setUTCHours(0, 0, 0, 0);
    assert.equal(SM.getLightStateLabel(midnight, 80, 0), 'Daylight');
  });

  test('Returns Night during polar night', () => {
    const dec = SM.getSeasonEvents(2026)[3].date;
    const noon = new Date(dec.getTime());
    noon.setUTCHours(12, 0, 0, 0);
    assert.equal(SM.getLightStateLabel(noon, 85, 0), 'Night');
  });
});

describe('Antimeridian — subsolar point near ±180°', () => {
  test('subsolar longitude wraps correctly near antimeridian', () => {
    // Find a time when subsolar longitude is near 180°
    // At ~12:00 UTC, subsolar longitude is near 0°. At ~00:00 UTC, it's near -180°.
    for (let h = 0; h < 24; h++) {
      const date = new Date(`2026-06-21T${String(h).padStart(2, '0')}:00:00Z`);
      const subsolar = SM.getSubsolarPoint(date);
      assert.ok(subsolar.lng >= -180 && subsolar.lng < 180,
        `hour ${h}: lng ${subsolar.lng} out of range`);
    }
  });

  test('getSolarPosition works at antimeridian', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    // Test at +179 and -179 (same place, different sign)
    const pos1 = SM.getSolarPosition(date, 0, 179);
    const pos2 = SM.getSolarPosition(date, 0, -179);
    // At the antimeridian, both should give similar altitudes
    assert.ok(Math.abs(pos1.altitude - pos2.altitude) < 1,
      `altitude mismatch: ${pos1.altitude} vs ${pos2.altitude}`);
  });

  test('getSolarSinAltitude is consistent across antimeridian', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const sin1 = SM.getSolarSinAltitude(date, 45, 179.5);
    const sin2 = SM.getSolarSinAltitude(date, 45, -179.5);
    // These are nearly the same point
    assert.ok(Math.abs(sin1 - sin2) < 0.01,
      `sinAlt mismatch: ${sin1} vs ${sin2}`);
  });

  test('getSolarPosition at exact antimeridian (±180)', () => {
    const date = new Date('2026-03-21T06:00:00Z');
    const pos = SM.getSolarPosition(date, 30, 180);
    assert.ok(pos.altitude >= -90 && pos.altitude <= 90);
    assert.ok(pos.azimuth >= 0 && pos.azimuth < 360);
  });
});

describe('Leap day — Feb 29', () => {
  test('getSunEquatorial works on Feb 29 2024', () => {
    const sun = SM.getSunEquatorial(new Date('2024-02-29T12:00:00Z'));
    assert.ok(Math.abs(sun.delta) < 23.44 + 0.01);
    assert.ok(sun.alpha >= 0 && sun.alpha < 360);
  });

  test('getSubsolarPoint works on Feb 29 2024', () => {
    const subsolar = SM.getSubsolarPoint(new Date('2024-02-29T12:00:00Z'));
    assert.ok(subsolar.lng >= -180 && subsolar.lng < 180);
  });

  test('getSolarPosition works on Feb 29 2024', () => {
    const pos = SM.getSolarPosition(new Date('2024-02-29T12:00:00Z'), 45, 0);
    assert.ok(pos.altitude >= -90 && pos.altitude <= 90);
  });

  test('Feb 29 declination is between equinox values', () => {
    // Feb 29 is after December solstice (delta ≈ -23.44) and before March equinox (delta ≈ 0)
    // So delta should be negative but greater than -23.44
    const sun = SM.getSunEquatorial(new Date('2024-02-29T12:00:00Z'));
    assert.ok(sun.delta < 0 && sun.delta > -23.44,
      `Expected negative delta between -23.44 and 0, got ${sun.delta}`);
  });
});

describe('getDayLengthSeconds — with mocked SunCalc', () => {
  function mockSunCalc(sunrise, sunset, solarNoon) {
    return {
      getTimes: () => ({
        sunrise: sunrise ? new Date(sunrise) : new Date('invalid'),
        sunset: sunset ? new Date(sunset) : new Date('invalid'),
        solarNoon: solarNoon ? new Date(solarNoon) : new Date('invalid')
      })
    };
  };

  test('normal day: returns difference between sunset and sunrise', () => {
    const sc = mockSunCalc('2026-06-21T05:00:00Z', '2026-06-21T21:00:00Z', '2026-06-21T13:00:00Z');
    const seconds = SM.getDayLengthSeconds(new Date('2026-06-21T12:00:00Z'), 45, 0, sc);
    assert.equal(seconds, 16 * 3600);
  });

  test('polar day: returns 86400 when Sun is up at noon', () => {
    // Mock SunCalc returning invalid sunrise/sunset (polar day)
    const sc = mockSunCalc(null, null, '2026-06-21T12:00:00Z');
    // At 80°N in June, the Sun is up at noon
    const seconds = SM.getDayLengthSeconds(new Date('2026-06-21T12:00:00Z'), 80, 0, sc);
    assert.equal(seconds, 86400);
  });

  test('polar night: returns 0 when Sun is down at noon', () => {
    const sc = mockSunCalc(null, null, '2026-12-21T12:00:00Z');
    // At 80°N in December, the Sun is down at noon
    const seconds = SM.getDayLengthSeconds(new Date('2026-12-21T12:00:00Z'), 80, 0, sc);
    assert.equal(seconds, 0);
  });

  test('sunset before sunrise: falls back to altitude check', () => {
    const sc = mockSunCalc('2026-06-21T21:00:00Z', '2026-06-21T05:00:00Z', '2026-06-21T13:00:00Z');
    const seconds = SM.getDayLengthSeconds(new Date('2026-06-21T12:00:00Z'), 45, 0, sc);
    // At 45°N in June, Sun is up at noon, so should return 86400
    assert.equal(seconds, 86400);
  });
});

describe('URL parameter validation', () => {
  test('empty search returns all NaN/null', () => {
    const r = SM.parsePermalinkParams('');
    assert.equal(r.time, null);
    assert.ok(isNaN(r.lat));
    assert.ok(isNaN(r.lng));
    assert.ok(isNaN(r.zoom));
    assert.equal(r.hasView, false);
    assert.equal(r.invalid.length, 0);
  });

  test('valid params parsed correctly', () => {
    const r = SM.parsePermalinkParams('?time=2026-06-21T12:00:00.000Z&lat=47.6&lon=-122.3&zoom=4');
    assert.ok(r.time);
    assert.equal(r.time.toISOString(), '2026-06-21T12:00:00.000Z');
    assert.ok(Math.abs(r.lat - 47.6) < 0.001);
    assert.ok(Math.abs(r.lng - (-122.3)) < 0.001);
    assert.equal(r.zoom, 4);
    assert.equal(r.hasView, true);
    assert.equal(r.invalid.length, 0);
  });

  test('lat=0 and lon=0 are honored (not treated as missing)', () => {
    const r = SM.parsePermalinkParams('?lat=0&lon=0&zoom=3');
    assert.equal(r.lat, 0);
    assert.equal(r.lng, 0);
    assert.equal(r.zoom, 3);
    assert.equal(r.hasView, true);
  });

  test('invalid time is rejected', () => {
    const r = SM.parsePermalinkParams('?time=garbage');
    assert.equal(r.time, null);
    assert.deepEqual(r.invalid, ['time']);
  });

  test('invalid lat (out of range) is rejected', () => {
    const r = SM.parsePermalinkParams('?lat=999');
    assert.ok(isNaN(r.lat));
    assert.deepEqual(r.invalid, ['lat']);
  });

  test('invalid lat (non-numeric) is rejected', () => {
    const r = SM.parsePermalinkParams('?lat=abc');
    assert.ok(isNaN(r.lat));
    assert.deepEqual(r.invalid, ['lat']);
  });

  test('invalid zoom is rejected', () => {
    const r = SM.parsePermalinkParams('?zoom=abc');
    assert.ok(isNaN(r.zoom));
    assert.deepEqual(r.invalid, ['zoom']);
  });

  test('zoom out of range is clamped, not rejected', () => {
    const r1 = SM.parsePermalinkParams('?zoom=1');
    assert.equal(r1.zoom, 2); // clamped to min
    assert.equal(r1.invalid.length, 0);

    const r2 = SM.parsePermalinkParams('?zoom=99');
    assert.equal(r2.zoom, 12); // clamped to max
    assert.equal(r2.invalid.length, 0);
  });

  test('longitude is wrapped to [-180, 180)', () => {
    const r = SM.parsePermalinkParams('?lon=370');
    assert.equal(r.lng, 10);
  });

  test('extreme longitude is wrapped', () => {
    const r = SM.parsePermalinkParams('?lon=720');
    assert.equal(r.lng, 0);
  });

  test('empty param values are rejected', () => {
    const r = SM.parsePermalinkParams('?lat=&lon=&zoom=');
    assert.ok(isNaN(r.lat));
    assert.ok(isNaN(r.lng));
    assert.ok(isNaN(r.zoom));
    assert.equal(r.invalid.length, 3);
  });

  test('mixed valid and invalid params', () => {
    const r = SM.parsePermalinkParams('?time=garbage&lat=47.6&lon=abc&zoom=4');
    assert.equal(r.time, null);
    assert.equal(r.lat, 47.6);
    assert.ok(isNaN(r.lng));
    assert.equal(r.zoom, 4);
    assert.deepEqual(r.invalid.sort(), ['lon', 'time']);
  });

  test('duplicated params: first value wins (URLSearchParams behavior)', () => {
    const r = SM.parsePermalinkParams('?lat=10&lat=20');
    assert.equal(r.lat, 10);
  });

  test('lat at boundary (-85) is accepted', () => {
    const r = SM.parsePermalinkParams('?lat=-85');
    assert.equal(r.lat, -85);
  });

  test('lat beyond boundary (-86) is rejected', () => {
    const r = SM.parsePermalinkParams('?lat=-86');
    assert.ok(isNaN(r.lat));
    assert.deepEqual(r.invalid, ['lat']);
  });
});
