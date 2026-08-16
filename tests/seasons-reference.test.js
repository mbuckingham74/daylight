const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../html/solar.js');

// D-04: seasonal-event accuracy contract.
//
// Reference instants: U.S. Naval Observatory, Astronomical Applications
// Department — "Earth's Seasons" data service
//   https://aa.usno.navy.mil/api/seasons
// retrieved 2026-08-15 for the years 1900, 1925, 1950, 1975, 2000, 2025,
// 2026, 2050, 2075, 2100 (40 events). The USNO values derive from the
// Astronomical Almanac ephemeris and are published to whole-minute precision
// in UTC.
//
// Daylight uses the low-precision Meeus solar model (~0.01° in ecliptic
// longitude), which the reference comparison shows to produce event times
// typically within ~7 minutes of the published instants, worst case
// ~15 minutes across this sample. The documented contract is "typically
// within ~10 minutes, up to ~15 minutes". The tolerances below are the
// regression guard: a 20-minute per-event bound (25% headroom over the
// observed worst case, plus the ±30 s rounding of the minute-published
// references) and a 10-minute median bound matching the documented
// typical envelope. Both are fixed deterministically by these fixtures.

const USNO_EVENTS = [
  [1900, 3, 21, '01:39', 'March equinox'], [1900, 6, 21, '21:40', 'June solstice'],
  [1900, 9, 23, '12:20', 'September equinox'], [1900, 12, 22, '06:41', 'December solstice'],
  [1925, 3, 21, '03:12', 'March equinox'], [1925, 6, 21, '22:50', 'June solstice'],
  [1925, 9, 23, '13:43', 'September equinox'], [1925, 12, 22, '08:37', 'December solstice'],
  [1950, 3, 21, '04:35', 'March equinox'], [1950, 6, 21, '23:36', 'June solstice'],
  [1950, 9, 23, '14:43', 'September equinox'], [1950, 12, 22, '10:13', 'December solstice'],
  [1975, 3, 21, '05:57', 'March equinox'], [1975, 6, 22, '00:26', 'June solstice'],
  [1975, 9, 23, '15:55', 'September equinox'], [1975, 12, 22, '11:46', 'December solstice'],
  [2000, 3, 20, '07:35', 'March equinox'], [2000, 6, 21, '01:48', 'June solstice'],
  [2000, 9, 22, '17:28', 'September equinox'], [2000, 12, 21, '13:37', 'December solstice'],
  [2025, 3, 20, '09:01', 'March equinox'], [2025, 6, 21, '02:42', 'June solstice'],
  [2025, 9, 22, '18:19', 'September equinox'], [2025, 12, 21, '15:03', 'December solstice'],
  [2026, 3, 20, '14:46', 'March equinox'], [2026, 6, 21, '08:24', 'June solstice'],
  [2026, 9, 23, '00:05', 'September equinox'], [2026, 12, 21, '20:50', 'December solstice'],
  [2050, 3, 20, '10:19', 'March equinox'], [2050, 6, 21, '03:33', 'June solstice'],
  [2050, 9, 22, '19:28', 'September equinox'], [2050, 12, 21, '16:38', 'December solstice'],
  [2075, 3, 20, '11:47', 'March equinox'], [2075, 6, 21, '04:41', 'June solstice'],
  [2075, 9, 22, '20:59', 'September equinox'], [2075, 12, 21, '18:27', 'December solstice'],
  [2100, 3, 20, '13:05', 'March equinox'], [2100, 6, 21, '05:33', 'June solstice'],
  [2100, 9, 22, '22:02', 'September equinox'], [2100, 12, 21, '19:52', 'December solstice']
];

const PER_EVENT_BOUND_MIN = 20;
const MEDIAN_BOUND_MIN = 10;

function errorMinutes(daylightMs, [year, month, day, time]) {
  const [hh, mm] = time.split(':').map(Number);
  const refMs = Date.UTC(year, month - 1, day, hh, mm);
  return (daylightMs - refMs) / 60000;
}

function daylightEvent(year, eventName) {
  SM.clearSeasonEventCache();
  return SM.getSeasonEvents(year).find((e) => e.name === eventName);
}

describe('seasonal-event accuracy vs USNO references (D-04)', () => {
  test('every event in the 1900–2100 sample is within 20 minutes of its USNO instant', () => {
    for (const [year, , , , eventName] of USNO_EVENTS) {
      const event = daylightEvent(year, eventName);
      const err = errorMinutes(event.date.getTime(), USNO_EVENTS.find((r) => r[0] === year && r[4] === eventName));
      assert.ok(
        Math.abs(err) < PER_EVENT_BOUND_MIN,
        `${year} ${eventName}: Daylight ${event.date.toISOString()} vs USNO ${USNO_EVENTS.find((r) => r[0] === year && r[4] === eventName).slice(1, 4).join('-')} ${USNO_EVENTS.find((r) => r[0] === year && r[4] === eventName)[3]} UTC, error ${err.toFixed(1)} min`
      );
    }
  });

  test('the typical (median) error stays within the documented ~10-minute envelope', () => {
    const errors = USNO_EVENTS.map(([year, , , , eventName]) => {
      const event = daylightEvent(year, eventName);
      return Math.abs(errorMinutes(event.date.getTime(), USNO_EVENTS.find((r) => r[0] === year && r[4] === eventName)));
    }).sort((a, b) => a - b);
    const median = errors[Math.floor(errors.length / 2)];
    assert.ok(median <= MEDIAN_BOUND_MIN, `median |error| ${median.toFixed(1)} min exceeds the ${MEDIAN_BOUND_MIN}-minute envelope`);
  });
});
