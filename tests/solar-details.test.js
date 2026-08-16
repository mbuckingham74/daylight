const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SolarDetails = require('../html/solar-details.js');

describe('solar details — day-of-year and year sampling', () => {
  test('day of year starts at 0 on January 1', () => {
    assert.equal(SolarDetails.getDayOfYear(new Date('2026-01-01T12:00:00Z')), 0);
  });

  test('day of year counts through a common year', () => {
    assert.equal(SolarDetails.getDayOfYear(new Date('2026-12-31T12:00:00Z')), 364);
  });

  test('day of year counts through a leap year', () => {
    assert.equal(SolarDetails.getDayOfYear(new Date('2024-12-31T12:00:00Z')), 365);
    assert.equal(SolarDetails.getDayOfYear(new Date('2024-02-29T12:00:00Z')), 59);
    assert.equal(SolarDetails.getDayOfYear(new Date('2024-03-01T12:00:00Z')), 60);
  });

  test('year day count handles leap and common years', () => {
    assert.equal(SolarDetails.getYearDayCount(2024), 366);
    assert.equal(SolarDetails.getYearDayCount(2023), 365);
    assert.equal(SolarDetails.getYearDayCount(2000), 366);
    assert.equal(SolarDetails.getYearDayCount(1900), 365);
    assert.equal(SolarDetails.getYearDayCount(2100), 365);
  });

  test('year sampling preserves the clock time of the input instant', () => {
    const date = new Date('2026-06-21T08:24:00.123Z');
    const samples = SolarDetails.getYearSampleDates(date);
    assert.equal(samples.length, 365);
    assert.equal(samples[0].toISOString(), '2026-01-01T08:24:00.123Z');
    assert.equal(samples[samples.length - 1].toISOString(), '2026-12-31T08:24:00.123Z');
  });

  test('year sampling includes every day of a leap year', () => {
    const samples = SolarDetails.getYearSampleDates(new Date('2024-06-21T08:24:00Z'));
    assert.equal(samples.length, 366);
    assert.ok(samples.some(d => d.getUTCMonth() === 1 && d.getUTCDate() === 29), 'leap day included');
  });
});

describe('solar details — range mapping', () => {
  test('maps linearly within the input range', () => {
    assert.equal(SolarDetails.mapRange(0, 0, 100, 0, 10), 0);
    assert.equal(SolarDetails.mapRange(50, 0, 100, 0, 10), 5);
    assert.equal(SolarDetails.mapRange(100, 0, 100, 0, 10), 10);
  });

  test('clamps out-of-range values', () => {
    assert.equal(SolarDetails.mapRange(-100, 0, 100, 0, 10), 0);
    assert.equal(SolarDetails.mapRange(500, 0, 100, 0, 10), 10);
  });
});

describe('solar details — twilight durations from SunCalc transitions', () => {
  function sunCalcFor(times) {
    return { getTimes: () => times };
  }
  const isValid = d => !isNaN(d.getTime());
  const invalid = new Date('invalid');

  test('sums civil/nautical/astronomical transition gaps', () => {
    const fake = sunCalcFor({
      sunrise: new Date('2026-06-21T04:00:00Z'),
      dawn: new Date('2026-06-21T03:00:00Z'),
      dusk: new Date('2026-06-21T21:00:00Z'),
      sunset: new Date('2026-06-21T20:00:00Z'),
      nauticalDawn: new Date('2026-06-21T02:00:00Z'),
      nauticalDusk: new Date('2026-06-21T22:00:00Z'),
      nightEnd: new Date('2026-06-21T01:00:00Z'),
      night: new Date('2026-06-21T23:00:00Z')
    });
    const result = SolarDetails.getTwilightDurations(new Date(), 51.5, -0.1, fake, isValid);
    assert.equal(result.civil, 7200);
    assert.equal(result.nautical, 7200);
    assert.equal(result.astronomical, 7200);
    assert.equal(result.hasTransitions, true);
  });

  test('reports zero durations without valid transitions', () => {
    const fake = sunCalcFor({
      sunrise: invalid, dawn: invalid, dusk: invalid, sunset: invalid,
      nauticalDawn: invalid, nauticalDusk: invalid, nightEnd: invalid, night: invalid
    });
    const result = SolarDetails.getTwilightDurations(new Date(), 80, 0, fake, isValid);
    assert.deepEqual(result, { civil: 0, nautical: 0, astronomical: 0, hasTransitions: false });
  });

  test('ignores reversed or partial transition times', () => {
    const fake = sunCalcFor({
      sunrise: new Date('2026-06-21T03:00:00Z'),
      dawn: new Date('2026-06-21T04:00:00Z'),
      dusk: invalid,
      sunset: new Date('2026-06-21T20:00:00Z'),
      nauticalDawn: invalid,
      nauticalDusk: invalid,
      nightEnd: invalid,
      night: invalid
    });
    const result = SolarDetails.getTwilightDurations(new Date(), 60, 0, fake, isValid);
    assert.equal(result.civil, 0);
    assert.equal(result.hasTransitions, false);
  });
});
