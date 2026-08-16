const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SY = require('../html/season-year.js');
const SM = require('../html/solar.js');

// D-05: seasonal-event year selection and the 1900-2100 supported-range
// classification must use the displayed instant's UTC year, never the
// browser-local calendar year. All assertions express UTC semantics, so they
// hold under any process timezone (verified by running the suite under
// TZ=UTC, TZ=America/Los_Angeles, and TZ=Pacific/Auckland).
describe('D-05 — astronomical year selection (UTC basis)', () => {
  test('scenario 1: an ordinary date uses its UTC year', () => {
    assert.equal(SY.getSeasonEventYear(new Date('2026-08-15T12:00:00Z')), 2026);
  });

  test('scenario 2: UTC Jan 1 instant uses 2027 even in a behind-UTC timezone', () => {
    // 2027-01-01T00:30:00Z is still Dec 31, 2026 locally in America/Los_Angeles.
    assert.equal(SY.getSeasonEventYear(new Date('2027-01-01T00:30:00Z')), 2027);
  });

  test('scenario 3: UTC Dec 31 instant keeps 2026 even in an ahead-of-UTC timezone', () => {
    // 2026-12-31T23:30:00Z is already Jan 1, 2027 locally in Pacific/Auckland.
    assert.equal(SY.getSeasonEventYear(new Date('2026-12-31T23:30:00Z')), 2026);
  });
});

describe('D-05 — supported range warning (1900-2100 UTC envelope)', () => {
  test('scenario 4a: 1900-01-01T00:00:00Z is inside the supported range', () => {
    assert.equal(SY.isWithinSupportedRange(new Date('1900-01-01T00:00:00Z')), true);
  });

  test('scenario 4b: the instant just before 1900 is out of range', () => {
    // 1899-12-31T23:59:59Z is still in 1899 in the UTC calendar, so it warns.
    assert.equal(SY.isWithinSupportedRange(new Date('1899-12-31T23:59:59Z')), false);
  });

  test('scenario 5a: 2100-12-31T23:59:59Z is inside the supported range', () => {
    assert.equal(SY.isWithinSupportedRange(new Date('2100-12-31T23:59:59Z')), true);
  });

  test('scenario 5b: 2101-01-01T00:00:00Z is out of range', () => {
    assert.equal(SY.isWithinSupportedRange(new Date('2101-01-01T00:00:00Z')), false);
  });
});

describe('D-05 — preset selection at the UTC New Year boundary', () => {
  test('scenario 6: preset event lookup receives the UTC year of the instant', () => {
    // Mirrors the app wiring: getActiveYear() feeds getPresetEventDate(key, year),
    // which calls SolarMath.getSeasonEvents(year). At a New Year boundary the
    // active year must be the instant's UTC year, not the local calendar year.
    const instant = new Date('2027-01-01T00:30:00Z');
    const year = SY.getSeasonEventYear(instant);
    assert.equal(year, 2027);
    SM.clearSeasonEventCache();
    const march = SM.getSeasonEvents(year)[0];
    assert.equal(march.name, 'March equinox');
    assert.equal(march.date.getUTCFullYear(), 2027);
  });
});
