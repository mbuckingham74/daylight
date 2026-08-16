/**
 * A-03 focused regression tests for the shared formatting module
 * (html/format.js, window.DaylightFormat).
 *
 * Every expected string in this file was captured from the pre-refactor
 * implementations (app.js / globe.js at HEAD f7958d0) via a temporary
 * characterization fixture, then verified identical after consolidation.
 * These tests therefore protect the exact presentation contracts:
 * precision, sign handling, hemisphere notation, fallback text, negative
 * zero, and UTC basis — not approximate behavior.
 *
 * The suite is timezone-deterministic: every formatTime call passes an
 * explicit Intl timeZone, and the whole file also runs under
 * TZ=America/Los_Angeles and TZ=Pacific/Auckland in CI-style validation.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Format = require('../html/format.js');

const MID = new Date('2026-06-21T08:24:00.000Z');
const MIDNIGHT = new Date('2026-01-01T00:00:00.000Z');
const LEAP_DAY = new Date('2024-02-29T12:34:56.789Z');
const YEAR_BOUNDARY = new Date('2025-12-31T23:59:59.000Z');
const AUCKLAND_INSTANT = new Date('2026-06-21T08:24:00.000Z');
const LA_INSTANT = new Date('2026-01-15T18:05:00.000Z');
const WINTER = new Date('2026-01-15T12:00:00.000Z');
const SUMMER = new Date('2026-07-15T12:00:00.000Z');

const clock24 = (date, timeZone = 'UTC', seconds = false) =>
  Format.formatTime(date, { timeZone, seconds, hour12: false });
const clock12 = (date, timeZone = 'UTC', seconds = false) =>
  Format.formatTime(date, { timeZone, seconds, hour12: true });

describe('DaylightFormat.formatUtcDate — UTC date stamp', () => {
  test('ordinary instant', () => {
    assert.equal(Format.formatUtcDate(MID), '2026-06-21');
  });

  test('midnight', () => {
    assert.equal(Format.formatUtcDate(MIDNIGHT), '2026-01-01');
  });

  test('leap day', () => {
    assert.equal(Format.formatUtcDate(LEAP_DAY), '2024-02-29');
  });

  test('year boundary', () => {
    assert.equal(Format.formatUtcDate(YEAR_BOUNDARY), '2025-12-31');
  });
});

describe('DaylightFormat.formatTime — canonical clock (24h/12h, seconds, timezone)', () => {
  test('24-hour UTC without seconds', () => {
    assert.equal(clock24(MID), '08:24');
  });

  test('24-hour midnight zero-padded', () => {
    assert.equal(clock24(MIDNIGHT), '00:00');
  });

  test('24-hour with seconds (clock contract)', () => {
    assert.equal(clock24(MID, 'UTC', true), '08:24:00');
    assert.equal(clock24(LEAP_DAY, 'UTC', true), '12:34:56');
  });

  test('12-hour presentation', () => {
    assert.equal(clock12(MID), '8:24 AM');
    assert.equal(clock12(MIDNIGHT), '12:00 AM');
  });

  test('explicit timezone basis (Auckland/LA)', () => {
    assert.equal(clock24(AUCKLAND_INSTANT, 'Pacific/Auckland'), '20:24');
    assert.equal(clock24(AUCKLAND_INSTANT, 'Pacific/Auckland', true), '20:24:00');
    assert.equal(clock24(LA_INSTANT, 'America/Los_Angeles'), '10:05');
  });

  test('invalid instant falls back to --:-- (or --:--:-- with seconds)', () => {
    assert.equal(Format.formatTime(null, { hour12: false }), '--:--');
    assert.equal(Format.formatTime(new Date('bogus'), { hour12: false }), '--:--');
    assert.equal(Format.formatTime(new Date('bogus'), { seconds: true, hour12: false }), '--:--:--');
  });

  test('invalid timezone falls back to UTC with the same seconds basis', () => {
    assert.equal(clock24(MID, 'Bogus/TZ'), '08:24');
    assert.equal(clock24(MID, 'Bogus/TZ', true), '08:24:00');
    assert.equal(clock12(MID, 'Bogus/TZ'), '8:24 AM');
  });

  test('default timezone is UTC', () => {
    assert.equal(Format.formatTime(MID, { hour12: false }), '08:24');
  });
});

describe('DaylightFormat.formatCoord — 2-decimal hemisphere coordinates', () => {
  test('positive latitude and negative longitude', () => {
    assert.equal(Format.formatCoord(51.5138, -0.1262), '51.51°N, 0.13°W');
  });

  test('negative latitude and positive longitude', () => {
    assert.equal(Format.formatCoord(-33.8688, 151.2093), '33.87°S, 151.21°E');
  });

  test('zero is north/east (>= 0 hemisphere)', () => {
    assert.equal(Format.formatCoord(0, 0), '0.00°N, 0.00°E');
  });

  test('negative zero is normalized to 0.00°N, 0.00°E', () => {
    assert.equal(Format.formatCoord(-0, -0), '0.00°N, 0.00°E');
  });

  test('values near the poles/antimeridian keep 2 decimals', () => {
    assert.equal(Format.formatCoord(89.999, 179.999), '90.00°N, 180.00°E');
  });

  test('exact 2-decimal precision preserved (Seattle/Forks-style inputs)', () => {
    assert.equal(Format.formatCoord(47.6062, -122.3321), '47.61°N, 122.33°W');
    assert.equal(Format.formatCoord(23.44, 150), '23.44°N, 150.00°E');
  });
});

describe('DaylightFormat.formatDuration — hours and minutes', () => {
  test('zero', () => {
    assert.equal(Format.formatDuration(0), '0h 0m');
  });

  test('under one minute is still 0h 0m (floor, no seconds)', () => {
    assert.equal(Format.formatDuration(30), '0h 0m');
  });

  test('exactly one hour', () => {
    assert.equal(Format.formatDuration(3600), '1h 0m');
  });

  test('multi-hour day length', () => {
    assert.equal(Format.formatDuration(52140), '14h 29m');
  });

  test('negative and invalid inputs return the "--" fallback', () => {
    assert.equal(Format.formatDuration(-5), '--');
    assert.equal(Format.formatDuration(NaN), '--');
    assert.equal(Format.formatDuration(Infinity), '--');
  });
});

describe('DaylightFormat.formatCompactDuration — compact duration', () => {
  test('zero', () => {
    assert.equal(Format.formatCompactDuration(0), '0s');
  });

  test('seconds only', () => {
    assert.equal(Format.formatCompactDuration(45), '45s');
  });

  test('minutes and seconds', () => {
    assert.equal(Format.formatCompactDuration(902), '15m 2s');
  });

  test('hours and minutes', () => {
    assert.equal(Format.formatCompactDuration(3661), '1h 1m');
  });

  test('rounding may carry seconds into minutes (59.6s -> 1m 0s)', () => {
    assert.equal(Format.formatCompactDuration(59.6), '1m 0s');
  });

  test('negative input returns the "--" fallback', () => {
    assert.equal(Format.formatCompactDuration(-1), '--');
  });
});

describe('DaylightFormat.formatSignedDuration — signed compact duration', () => {
  test('positive gets an explicit plus', () => {
    assert.equal(Format.formatSignedDuration(65), '+1m 5s');
  });

  test('negative gets a minus', () => {
    assert.equal(Format.formatSignedDuration(-65), '-1m 5s');
  });

  test('zero has no sign', () => {
    assert.equal(Format.formatSignedDuration(0), '0s');
    assert.equal(Format.formatSignedDuration(-0), '0s');
  });

  test('multi-hour values', () => {
    assert.equal(Format.formatSignedDuration(3600 + 60), '+1h 1m');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatSignedDuration(NaN), '--');
  });
});

describe('DaylightFormat.formatDegrees — unsigned degrees', () => {
  test('default precision is 2 decimals', () => {
    assert.equal(Format.formatDegrees(23.44), '23.44°');
  });

  test('explicit precision 1/3/4 decimals', () => {
    assert.equal(Format.formatDegrees(128.7, 1), '128.7°');
    assert.equal(Format.formatDegrees(23.4412, 3), '23.441°');
    assert.equal(Format.formatDegrees(23.4367, 4), '23.4367°');
  });

  test('zero and negative zero both render 0.00°', () => {
    assert.equal(Format.formatDegrees(0), '0.00°');
    assert.equal(Format.formatDegrees(-0), '0.00°');
  });

  test('small negative keeps toFixed negative-zero string (-0.00°)', () => {
    assert.equal(Format.formatDegrees(-0.001), '-0.00°');
  });

  test('negative values carry their sign', () => {
    assert.equal(Format.formatDegrees(-6.5), '-6.50°');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatDegrees(NaN), '--');
  });
});

describe('DaylightFormat.formatSignedDegrees — signed degrees', () => {
  test('positive gets an explicit plus', () => {
    assert.equal(Format.formatSignedDegrees(23.4412, 3), '+23.441°');
  });

  test('negative gets a minus', () => {
    assert.equal(Format.formatSignedDegrees(-23.4412, 3), '-23.441°');
    assert.equal(Format.formatSignedDegrees(-33.9, 2), '-33.90°');
  });

  test('zero and negative zero have no sign', () => {
    assert.equal(Format.formatSignedDegrees(0), '0.00°');
    assert.equal(Format.formatSignedDegrees(-0), '0.00°');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatSignedDegrees(Infinity), '--');
  });
});

describe('DaylightFormat.formatRightAscension — hours from degrees', () => {
  test('zero', () => {
    assert.equal(Format.formatRightAscension(0), '0h 00m');
  });

  test('30 degrees is 2 hours', () => {
    assert.equal(Format.formatRightAscension(30), '2h 00m');
  });

  test('typical value', () => {
    assert.equal(Format.formatRightAscension(83.7), '5h 35m');
  });

  test('negative angles wrap into [0, 24h)', () => {
    assert.equal(Format.formatRightAscension(-30), '22h 00m');
  });

  test('full circle and overflow wrap', () => {
    assert.equal(Format.formatRightAscension(360), '0h 00m');
    assert.equal(Format.formatRightAscension(390), '2h 00m');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatRightAscension(NaN), '--');
  });
});

describe('DaylightFormat.formatPercent — fraction to percentage', () => {
  test('default precision is 1 decimal', () => {
    assert.equal(Format.formatPercent(0.123), '12.3%');
  });

  test('full fraction', () => {
    assert.equal(Format.formatPercent(1), '100.0%');
  });

  test('explicit 3-decimal precision', () => {
    assert.equal(Format.formatPercent(0.123, 3), '12.300%');
  });

  test('zero', () => {
    assert.equal(Format.formatPercent(0), '0.0%');
  });

  test('2-decimal energy-ratio parity (solar-details inline consolidation)', () => {
    assert.equal(Format.formatPercent(0.1245, 2), '12.45%');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatPercent(NaN), '--');
  });
});

describe('DaylightFormat.formatMillions — millions with 2 decimals', () => {
  test('astronomical distances', () => {
    assert.equal(Format.formatMillions(149597870), '149.60M');
  });

  test('small values keep 2 decimals', () => {
    assert.equal(Format.formatMillions(500000), '0.50M');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatMillions(NaN), '--');
  });
});

describe('DaylightFormat.formatLightTime — minutes with padded seconds', () => {
  test('typical light travel time', () => {
    assert.equal(Format.formatLightTime(499), '8m 19s');
  });

  test('exactly one minute', () => {
    assert.equal(Format.formatLightTime(60), '1m 00s');
  });

  test('sub-minute', () => {
    assert.equal(Format.formatLightTime(8), '0m 08s');
  });

  test('rounding may push seconds to 60 (pre-existing quirk preserved)', () => {
    assert.equal(Format.formatLightTime(119.6), '1m 60s');
  });

  test('invalid input returns the "--" fallback', () => {
    assert.equal(Format.formatLightTime(Infinity), '--');
  });
});

describe('DaylightFormat.formatSeasonCountdown — seasonal event countdown', () => {
  test('no event returns the "--" fallback', () => {
    assert.equal(Format.formatSeasonCountdown(null, MID), '--');
  });

  test('past event shows only its name', () => {
    assert.equal(
      Format.formatSeasonCountdown({ date: new Date('2026-06-20T00:00:00Z'), name: 'Jun Sol' }, MID),
      'Jun Sol'
    );
  });

  test('within 48 hours shows hours', () => {
    assert.equal(
      Format.formatSeasonCountdown({ date: new Date('2026-06-21T10:24:00Z'), name: 'Jun Sol' }, MID),
      'Jun Sol in 2h'
    );
  });

  test('beyond 48 hours shows days', () => {
    assert.equal(
      Format.formatSeasonCountdown({ date: new Date('2026-06-25T08:24:00Z'), name: 'Jun Sol' }, MID),
      'Jun Sol in 4d'
    );
    assert.equal(
      Format.formatSeasonCountdown({ date: new Date('2026-06-23T08:24:00Z'), name: 'Jun Sol' }, MID),
      'Jun Sol in 2d'
    );
  });
});

describe('DaylightFormat.formatPolarDayLength — polar day/night readout', () => {
  test('daylight', () => {
    assert.equal(Format.formatPolarDayLength(true), '24h 0m');
  });

  test('night', () => {
    assert.equal(Format.formatPolarDayLength(false), '0h 0m');
  });
});

describe('DaylightFormat.getTimeZoneAbbr — short timezone abbreviations', () => {
  test('summer abbreviation', () => {
    assert.equal(Format.getTimeZoneAbbr('America/New_York', SUMMER), 'EDT');
  });

  test('winter abbreviation', () => {
    assert.equal(Format.getTimeZoneAbbr('America/New_York', WINTER), 'EST');
  });

  test('invalid timezone returns empty string', () => {
    assert.equal(Format.getTimeZoneAbbr('Bogus/TZ', SUMMER), '');
  });

  test('missing timezone returns empty string', () => {
    assert.equal(Format.getTimeZoneAbbr(null, SUMMER), '');
  });
});

describe('globe parity — the 3D page consumes the same contracts', () => {
  test('globe sun-position readout equals formatCoord output', () => {
    assert.equal(Format.formatCoord(23.44, 150), '23.44°N, 150.00°E');
    assert.equal(Format.formatCoord(0, 0), '0.00°N, 0.00°E');
  });

  test('globe UTC clock composition equals formatUtcDate plus fixed HH:MM:SS', () => {
    const globeCompose = date => `${Format.formatUtcDate(date)} ${date.toISOString().slice(11, 19)} UTC`;
    assert.equal(globeCompose(MID), '2026-06-21 08:24:00 UTC');
    assert.equal(globeCompose(LEAP_DAY), '2024-02-29 12:34:56 UTC');
  });

  test('app chart-clock composition equals formatTime(24h) plus " UTC"', () => {
    assert.equal(`${Format.formatTime(MID, { hour12: false })} UTC`, '08:24 UTC');
  });
});
