const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sunCalc = require('suncalc');
const suncalcVersion = require('suncalc/package.json').version;

// T-02: sunrise/sunset regression contract.
//
// Reference values: U.S. Naval Observatory, Astronomical Applications
// Department — "Sunrise/Sunset/Moonrise/Moonset Times" data service
//   https://aa.usno.navy.mil/api/rstt/oneday
// retrieved 2026-08-15 for three locations (Seattle, Sydney, Singapore) on
// the four 2026 seasonal-event dates (12 cases). The USNO values derive
// from the Astronomical Almanac ephemeris and are published to whole-minute
// precision in UTC.
//
// Production path under test: Daylight's sunrise/sunset readouts call
// SunCalc.getTimes(date, lat, lng) directly (html/app.js) with the SunCalc
// 1.9.0 distribution loaded from cdnjs (html/index.html). This test drives
// the identical release pinned as an exact devDependency; the CDN build and
// the npm package produce identical times for these cases.
//
// The reference is genuinely independent: USNO computes rise/set from the
// full Astronomical Almanac ephemeris, while SunCalc uses a low-precision
// Meeus-based model (aa.quae.nl). Observed agreement across this sample is
// 0.6-2.3 minutes (median ~1.2 minutes). The 3-minute regression bound is
// the observed worst deviation (~2.3 minutes) plus the reference's full
// ±30 s whole-minute rounding, rounded up to the next whole minute — the
// same fixed-bound-over-observed-envelope approach as the D-04
// seasons-reference test. It is a regression guard, not the product's
// "±1 minute (mid-latitudes)" accuracy statement, which this sample
// supports as a typical envelope but exceeds at its worst case (reported
// separately as an accuracy-contract observation, not widened here).
//
// SunCalc.getTimes picks the rise/set pair of the local solar day nearest
// the given instant, so the date is passed as 12:00 UTC of the intended
// local calendar date, which lies inside that local day for every longitude.

const SUNRISE_SUNSET_BOUND_MIN = 3;
const PRODUCTION_SUNCALC_VERSION = '1.9.0';

// [location, lat, lng, local date, USNO sunrise UTC, USNO sunset UTC]
const USNO_CASES = [
  ['Seattle', 47.6062, -122.3321, '2026-03-20', '2026-03-20T14:12:00Z', '2026-03-21T02:22:00Z'],
  ['Seattle', 47.6062, -122.3321, '2026-06-21', '2026-06-21T12:12:00Z', '2026-06-22T04:11:00Z'],
  ['Seattle', 47.6062, -122.3321, '2026-09-23', '2026-09-23T13:58:00Z', '2026-09-24T02:05:00Z'],
  ['Seattle', 47.6062, -122.3321, '2026-12-21', '2026-12-21T15:55:00Z', '2026-12-22T00:20:00Z'],
  ['Sydney', -33.8688, 151.2093, '2026-03-20', '2026-03-19T19:58:00Z', '2026-03-20T08:07:00Z'],
  ['Sydney', -33.8688, 151.2093, '2026-06-21', '2026-06-20T21:00:00Z', '2026-06-21T06:54:00Z'],
  ['Sydney', -33.8688, 151.2093, '2026-09-23', '2026-09-22T19:44:00Z', '2026-09-23T07:52:00Z'],
  ['Sydney', -33.8688, 151.2093, '2026-12-21', '2026-12-20T18:41:00Z', '2026-12-21T09:05:00Z'],
  ['Singapore', 1.3521, 103.8198, '2026-03-20', '2026-03-19T23:09:00Z', '2026-03-20T11:15:00Z'],
  ['Singapore', 1.3521, 103.8198, '2026-06-21', '2026-06-20T23:00:00Z', '2026-06-21T11:12:00Z'],
  ['Singapore', 1.3521, 103.8198, '2026-09-23', '2026-09-22T22:54:00Z', '2026-09-23T11:00:00Z'],
  ['Singapore', 1.3521, 103.8198, '2026-12-21', '2026-12-20T23:01:00Z', '2026-12-21T11:04:00Z']
];

function daylightTimes(localDate, lat, lng) {
  const [y, m, d] = localDate.split('-').map(Number);
  return sunCalc.getTimes(new Date(Date.UTC(y, m - 1, d, 12)), lat, lng);
}

function errorMinutes(actualMs, refIso) {
  return (actualMs - Date.parse(refIso)) / 60000;
}

describe('sunrise/sunset accuracy vs USNO references (T-02)', () => {
  test('the test SunCalc version matches the production CDN version', () => {
    assert.equal(suncalcVersion, PRODUCTION_SUNCALC_VERSION,
      `devDependency suncalc@${suncalcVersion} must stay in lockstep with the ` +
      `cdnjs version ${PRODUCTION_SUNCALC_VERSION} loaded by html/index.html`);
  });

  test('every sunrise and sunset is within 3 minutes of its USNO published time', () => {
    for (const [location, lat, lng, localDate, refRise, refSet] of USNO_CASES) {
      const times = daylightTimes(localDate, lat, lng);
      assert.ok(!isNaN(times.sunrise.getTime()), `${location} ${localDate}: no sunrise returned`);
      assert.ok(!isNaN(times.sunset.getTime()), `${location} ${localDate}: no sunset returned`);

      const riseErr = errorMinutes(times.sunrise.getTime(), refRise);
      assert.ok(Math.abs(riseErr) < SUNRISE_SUNSET_BOUND_MIN,
        `${location} ${localDate} sunrise: Daylight ${times.sunrise.toISOString()} vs ` +
        `USNO ${refRise}, difference ${riseErr.toFixed(1)} min (bound ±${SUNRISE_SUNSET_BOUND_MIN})`);

      const setErr = errorMinutes(times.sunset.getTime(), refSet);
      assert.ok(Math.abs(setErr) < SUNRISE_SUNSET_BOUND_MIN,
        `${location} ${localDate} sunset: Daylight ${times.sunset.toISOString()} vs ` +
        `USNO ${refSet}, difference ${setErr.toFixed(1)} min (bound ±${SUNRISE_SUNSET_BOUND_MIN})`);
    }
  });
});
