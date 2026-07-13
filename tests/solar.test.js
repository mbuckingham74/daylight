const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../html/solar.js');

describe('normalizeDegrees', () => {
  test('wraps positive values', () => {
    assert.equal(SM.normalizeDegrees(370), 10);
    assert.equal(SM.normalizeDegrees(360), 0);
    assert.equal(SM.normalizeDegrees(720), 0);
  });

  test('wraps negative values', () => {
    assert.equal(SM.normalizeDegrees(-10), 350);
    assert.equal(SM.normalizeDegrees(-370), 350);
  });

  test('handles zero', () => {
    assert.equal(SM.normalizeDegrees(0), 0);
  });
});

describe('wrapLng', () => {
  test('wraps to [-180, 180)', () => {
    assert.equal(SM.wrapLng(180), -180);
    assert.equal(SM.wrapLng(360), 0);
    assert.equal(SM.wrapLng(540), -180);
    assert.equal(SM.wrapLng(-180), -180);
    assert.equal(SM.wrapLng(0), 0);
    assert.equal(SM.wrapLng(170), 170);
    assert.equal(SM.wrapLng(-170), -170);
  });

  test('wraps large values', () => {
    assert.equal(SM.wrapLng(720), 0);
    assert.equal(SM.wrapLng(-720), 0);
    assert.equal(SM.wrapLng(1080), 0);
  });

  test('wraps fractional values', () => {
    assert.equal(SM.wrapLng(190).toFixed(2), '-170.00');
    assert.equal(SM.wrapLng(-190).toFixed(2), '170.00');
  });
});

describe('clamp', () => {
  test('clamps to range', () => {
    assert.equal(SM.clamp(5, 0, 10), 5);
    assert.equal(SM.clamp(-5, 0, 10), 0);
    assert.equal(SM.clamp(15, 0, 10), 10);
  });
});

describe('clampZoom', () => {
  test('clamps to [2, 12]', () => {
    assert.equal(SM.clampZoom(1), 2);
    assert.equal(SM.clampZoom(2), 2);
    assert.equal(SM.clampZoom(6), 6);
    assert.equal(SM.clampZoom(12), 12);
    assert.equal(SM.clampZoom(13), 12);
  });

  test('rounds to integer', () => {
    assert.equal(SM.clampZoom(5.4), 5);
    assert.equal(SM.clampZoom(5.6), 6);
  });
});

describe('smoothstep', () => {
  test('is 0 below edge0', () => {
    assert.equal(SM.smoothstep(0, 1, -1), 0);
    assert.equal(SM.smoothstep(0, 1, 0), 0);
  });

  test('is 1 above edge1', () => {
    assert.equal(SM.smoothstep(0, 1, 1), 1);
    assert.equal(SM.smoothstep(0, 1, 2), 1);
  });

  test('is 0.5 at midpoint', () => {
    assert.equal(SM.smoothstep(0, 1, 0.5), 0.5);
  });
});

describe('getSunEquatorial — declination bounds and reference values', () => {
  test('declination is within ±23.44° for any date', () => {
    for (let year = 2020; year <= 2030; year++) {
      for (let month = 0; month < 12; month++) {
        const sun = SM.getSunEquatorial(new Date(Date.UTC(year, month, 15)));
        assert.ok(Math.abs(sun.delta) <= 23.44 + 0.01,
          `delta ${sun.delta} out of range for ${year}-${month + 1}`);
      }
    }
  });

  test('June solstice declination is near +23.44°', () => {
    const sun = SM.getSunEquatorial(new Date('2026-06-21T08:24:00Z'));
    assert.ok(Math.abs(sun.delta - 23.44) < 0.02,
      `expected ~23.44, got ${sun.delta}`);
  });

  test('December solstice declination is near -23.44°', () => {
    const sun = SM.getSunEquatorial(new Date('2026-12-21T20:54:00Z'));
    assert.ok(Math.abs(sun.delta + 23.44) < 0.02,
      `expected ~-23.44, got ${sun.delta}`);
  });

  test('March equinox declination is near 0°', () => {
    const sun = SM.getSunEquatorial(new Date('2026-03-20T14:38:00Z'));
    assert.ok(Math.abs(sun.delta) < 0.02,
      `expected ~0, got ${sun.delta}`);
  });

  test('September equinox declination is near 0°', () => {
    const sun = SM.getSunEquatorial(new Date('2026-09-23T00:16:00Z'));
    assert.ok(Math.abs(sun.delta) < 0.02,
      `expected ~0, got ${sun.delta}`);
  });

  test('right ascension is in [0, 360)', () => {
    const sun = SM.getSunEquatorial(new Date('2026-06-21'));
    assert.ok(sun.alpha >= 0 && sun.alpha < 360);
  });

  test('GMST is in [0, 360)', () => {
    const sun = SM.getSunEquatorial(new Date('2026-06-21'));
    assert.ok(sun.gmstDeg >= 0 && sun.gmstDeg < 360);
  });

  test('obliquity is near 23.44°', () => {
    const sun = SM.getSunEquatorial(new Date('2026-06-21'));
    assert.ok(Math.abs(sun.obliquity - 23.436) < 0.005,
      `expected ~23.436, got ${sun.obliquity}`);
  });
});

describe('getSunEquatorial — multi-year reference values', () => {
  // Independent reference values from USNO / standard almanac sources.
  // Tolerance: 0.05° for declination (low-precision algorithm).
  const referenceCases = [
    { date: '2020-06-21T00:00:00Z', deltaExpected: 23.44, label: 'Jun sol 2020' },
    { date: '2020-12-21T00:00:00Z', deltaExpected: -23.43, label: 'Dec sol 2020' },
    { date: '2024-06-21T00:00:00Z', deltaExpected: 23.44, label: 'Jun sol 2024 (leap)' },
    { date: '2024-12-21T00:00:00Z', deltaExpected: -23.43, label: 'Dec sol 2024 (leap)' },
    { date: '2030-06-21T00:00:00Z', deltaExpected: 23.44, label: 'Jun sol 2030' },
    { date: '2000-06-21T00:00:00Z', deltaExpected: 23.44, label: 'Jun sol 2000' },
  ];

  referenceCases.forEach(({ date, deltaExpected, label }) => {
    test(`${label}: declination ≈ ${deltaExpected}`, () => {
      const sun = SM.getSunEquatorial(new Date(date));
      assert.ok(Math.abs(sun.delta - deltaExpected) < 0.05,
        `${label}: expected ${deltaExpected}±0.05, got ${sun.delta}`);
    });
  });
});

describe('getSubsolarPoint', () => {
  test('latitude equals declination', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const subsolar = SM.getSubsolarPoint(date);
    const sun = SM.getSunEquatorial(date);
    assert.equal(subsolar.lat.toFixed(4), sun.delta.toFixed(4));
  });

  test('longitude is in [-180, 180)', () => {
    for (let h = 0; h < 24; h++) {
      const subsolar = SM.getSubsolarPoint(new Date(`2026-06-21T${String(h).padStart(2, '0')}:00:00Z`));
      assert.ok(subsolar.lng >= -180 && subsolar.lng < 180,
        `lng ${subsolar.lng} out of range at hour ${h}`);
    }
  });

  test('subsolar longitude advances ~15°/hour', () => {
    const t1 = new Date('2026-06-21T12:00:00Z');
    const t2 = new Date('2026-06-21T13:00:00Z');
    const s1 = SM.getSubsolarPoint(t1);
    const s2 = SM.getSubsolarPoint(t2);
    let diff = Math.abs(s2.lng - s1.lng);
    if (diff > 180) diff = 360 - diff;
    assert.ok(Math.abs(diff - 15) < 0.5,
      `expected ~15°/hr, got ${diff}`);
  });
});

describe('getEarthSunDistanceAu', () => {
  test('distance is within [0.983, 1.017] AU', () => {
    for (let month = 0; month < 12; month++) {
      const d = SM.getEarthSunDistanceAu(new Date(2026, month, 15));
      assert.ok(d >= 0.983 && d <= 1.017,
        `distance ${d} out of range for month ${month + 1}`);
    }
  });

  test('perihelion (early January) is near minimum', () => {
    const d = SM.getEarthSunDistanceAu(new Date('2026-01-04T00:00:00Z'));
    assert.ok(d < 0.984, `expected near min, got ${d}`);
  });

  test('aphelion (early July) is near maximum', () => {
    const d = SM.getEarthSunDistanceAu(new Date('2026-07-04T00:00:00Z'));
    assert.ok(d > 1.016, `expected near max, got ${d}`);
  });
});

describe('getEquationOfTimeMinutes', () => {
  test('is within [-16.4, +16.4] minutes', () => {
    for (let month = 0; month < 12; month++) {
      const eot = SM.getEquationOfTimeMinutes(new Date(2026, month, 15));
      assert.ok(eot >= -16.5 && eot <= 16.5,
        `EOT ${eot} out of range for month ${month + 1}`);
    }
  });

  test('mid-February is near minimum (~-14)', () => {
    const eot = SM.getEquationOfTimeMinutes(new Date('2026-02-12T00:00:00Z'));
    assert.ok(eot < -13, `expected < -13, got ${eot}`);
  });

  test('early November is near maximum (~+16)', () => {
    const eot = SM.getEquationOfTimeMinutes(new Date('2026-11-03T00:00:00Z'));
    assert.ok(eot > 15, `expected > 15, got ${eot}`);
  });
});

describe('getSolarPosition', () => {
  test('altitude is within [-90, 90]', () => {
    const pos = SM.getSolarPosition(new Date('2026-06-21T12:00:00Z'), 40, 0);
    assert.ok(pos.altitude >= -90 && pos.altitude <= 90);
  });

  test('azimuth is in [0, 360)', () => {
    const pos = SM.getSolarPosition(new Date('2026-06-21T12:00:00Z'), 40, 0);
    assert.ok(pos.azimuth >= 0 && pos.azimuth < 360);
  });

  test('zenith = 90 - altitude', () => {
    const pos = SM.getSolarPosition(new Date('2026-06-21T12:00:00Z'), 40, 0);
    assert.equal(pos.zenith.toFixed(4), (90 - pos.altitude).toFixed(4));
  });

  test('Sun is overhead at subsolar point (altitude ~90)', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const subsolar = SM.getSubsolarPoint(date);
    const pos = SM.getSolarPosition(date, subsolar.lat, subsolar.lng);
    assert.ok(pos.altitude > 89, `expected ~90, got ${pos.altitude}`);
  });

  test('Antipode has altitude ~-90', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const subsolar = SM.getSubsolarPoint(date);
    const pos = SM.getSolarPosition(date, -subsolar.lat, SM.wrapLng(subsolar.lng + 180));
    assert.ok(pos.altitude < -89, `expected ~-90, got ${pos.altitude}`);
  });
});

describe('getSolarSinAltitude', () => {
  test('is within [-1, 1]', () => {
    const sinAlt = SM.getSolarSinAltitude(new Date('2026-06-21T12:00:00Z'), 40, -74);
    assert.ok(sinAlt >= -1 && sinAlt <= 1);
  });

  test('matches getSolarPosition at same point', () => {
    const date = new Date('2026-03-21T06:00:00Z');
    const lat = 35, lng = 139;
    const sinAlt = SM.getSolarSinAltitude(date, lat, lng);
    const pos = SM.getSolarPosition(date, lat, lng);
    assert.ok(Math.abs(sinAlt - Math.sin(pos.altitude * SM.D2R)) < 1e-10);
  });
});

describe('getGlobalLightFractions', () => {
  test('fractions sum to 1', () => {
    const fractions = SM.getGlobalLightFractions();
    const sum = fractions.daylight + fractions.civil + fractions.nautical +
      fractions.astronomical + fractions.night;
    assert.ok(Math.abs(sum - 1) < 1e-10, `sum = ${sum}`);
  });

  test('all fractions are in [0, 1]', () => {
    const fractions = SM.getGlobalLightFractions();
    for (const [key, val] of Object.entries(fractions)) {
      assert.ok(val >= 0 && val <= 1, `${key} = ${val} out of [0,1]`);
    }
  });
});

describe('getSeasonEvents', () => {
  test('returns 4 events sorted by date', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2026);
    assert.equal(events.length, 4);
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].date > events[i - 1].date);
    }
  });

  test('March equinox 2026 is on March 20', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2026);
    const march = events[0];
    assert.equal(march.name, 'March equinox');
    assert.equal(march.date.getUTCMonth(), 2);
    assert.equal(march.date.getUTCDate(), 20);
  });

  test('June solstice 2026 is on June 21', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2026);
    const june = events[1];
    assert.equal(june.name, 'June solstice');
    assert.equal(june.date.getUTCMonth(), 5);
    assert.equal(june.date.getUTCDate(), 21);
  });

  test('September equinox 2026 is on September 23', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2026);
    const sept = events[2];
    assert.equal(sept.name, 'September equinox');
    assert.equal(sept.date.getUTCMonth(), 8);
    assert.equal(sept.date.getUTCDate(), 23);
  });

  test('December solstice 2026 is on December 21', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2026);
    const dec = events[3];
    assert.equal(dec.name, 'December solstice');
    assert.equal(dec.date.getUTCMonth(), 11);
    assert.equal(dec.date.getUTCDate(), 21);
  });

  test('works for leap years (2024)', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2024);
    assert.equal(events.length, 4);
    assert.equal(events[0].date.getUTCMonth(), 2);
    assert.equal(events[0].date.getUTCDate(), 20);
  });

  test('works for year 2000', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2000);
    assert.equal(events.length, 4);
    assert.equal(events[0].date.getUTCMonth(), 2);
  });

  test('works for year 2100 (non-leap century)', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2100);
    assert.equal(events.length, 4);
  });

  test('caches results', () => {
    SM.clearSeasonEventCache();
    const e1 = SM.getSeasonEvents(2026);
    const e2 = SM.getSeasonEvents(2026);
    assert.equal(e1, e2);
  });
});

describe('getNextSeasonEvent', () => {
  test('finds next event after a given date', () => {
    SM.clearSeasonEventCache();
    const next = SM.getNextSeasonEvent(new Date('2026-01-01T00:00:00Z'));
    assert.ok(next);
    assert.equal(next.name, 'March equinox');
  });

  test('wraps to next year after December solstice', () => {
    SM.clearSeasonEventCache();
    const next = SM.getNextSeasonEvent(new Date('2026-12-25T00:00:00Z'));
    assert.ok(next);
    assert.equal(next.name, 'March equinox');
    assert.equal(next.date.getUTCFullYear(), 2027);
  });
});

describe('getLightStateLabel', () => {
  test('returns Daylight when Sun is overhead', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const subsolar = SM.getSubsolarPoint(date);
    const label = SM.getLightStateLabel(date, subsolar.lat, subsolar.lng);
    assert.equal(label, 'Daylight');
  });

  test('returns Night at antipode', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const subsolar = SM.getSubsolarPoint(date);
    const label = SM.getLightStateLabel(date, -subsolar.lat, SM.wrapLng(subsolar.lng + 180));
    assert.equal(label, 'Night');
  });
});

describe('getTwilightPixel', () => {
  test('returns null at daylight threshold (no glow)', () => {
    const pixel = SM.getTwilightPixel(SM.TWILIGHT_THRESHOLDS.daylight);
    assert.equal(pixel, null);
  });

  test('returns glow pixel at high altitude', () => {
    const pixel = SM.getTwilightPixel(1);
    assert.ok(pixel);
    assert.ok(pixel.alpha > 0);
  });

  test('returns non-null for civil twilight', () => {
    const pixel = SM.getTwilightPixel(SM.TWILIGHT_THRESHOLDS.civil);
    assert.ok(pixel);
    assert.ok(pixel.alpha > 0);
  });

  test('returns non-null for night', () => {
    const pixel = SM.getTwilightPixel(-1);
    assert.ok(pixel);
    assert.ok(pixel.alpha > 0);
  });

  test('color is a 3-element array', () => {
    const pixel = SM.getTwilightPixel(SM.TWILIGHT_THRESHOLDS.civil);
    assert.ok(Array.isArray(pixel.color));
    assert.equal(pixel.color.length, 3);
  });
});

describe('isValidDate', () => {
  test('valid Date', () => {
    assert.ok(SM.isValidDate(new Date()));
  });

  test('invalid Date', () => {
    assert.ok(!SM.isValidDate(new Date('invalid')));
  });

  test('null', () => {
    assert.ok(!SM.isValidDate(null));
  });
});
