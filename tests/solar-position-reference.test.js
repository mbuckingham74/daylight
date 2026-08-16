const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../html/solar.js');

// T-03: solar-position accuracy contract.
//
// Daylight's solar position (html/solar.js, getSunEquatorial /
// getSubsolarPoint) is a low-precision Meeus ch. 25 model producing
// GEOMETRIC, MEAN-EQUATOR-AND-EQUINOX-OF-DATE coordinates (no nutation,
// aberration, or light-time corrections). The references below are:
//
//   - US Naval Observatory, Astronomical Applications "Celestial
//     Navigation" data service (https://aa.usno.navy.mil/api/celnav):
//     apparent geocentric solar declination and Greenwich hour angle,
//     Nautical Almanac convention (aberration + nutation included),
//     retrieved 2026-08-15 for 27 instants spanning 1900-2050 at 12:00 UT.
//     Also the "Sidereal Time" service
//     (https://aa.usno.navy.mil/api/siderealtime) for Greenwich mean
//     sidereal time at the same instants. Both services cover 1800-2050.
//   - JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api, DE441,
//     observer = geocenter 500@399): apparent geocentric solar RA/Dec at
//     the 2080/2100 range edge (service range beyond USNO), retrieved
//     2026-08-15; and Sun-Earth distance (delta) in AU at 15 instants
//     spanning 1900-2100.
//
// The apparent-vs-geometric convention difference (aberration ~20",
// nutation ~17" in longitude) contributes a bounded systematic offset of
// order 0.005-0.008 deg and is INCLUDED in the observed envelopes below;
// it is not treated as Daylight error. References are computed in UT1
// while Daylight instants are UTC; the <= 1 s difference contributes at
// most ~0.004 deg of subsolar longitude and is likewise included.
//
// Observed maxima in the samples (daylight - reference):
//   declination        27 USNO + 6 JPL instants : max |err| 0.0043 deg
//   subsolar longitude 27 USNO instants          : max |err| 0.0079 deg
//   GMST               27 USNO instants          : max |err| 0.0005 deg
//   right ascension     6 JPL instants (2100)    : max |err| 0.0056 deg
//   Earth-Sun distance 15 JPL instants           : max |err| 8.4e-5 AU
//   equation of time   27 USNO-derived           : max |err| 0.049 min
//
// Regression bounds: the documented envelope where the claim holds with
// >= ~2x headroom over the observed max (declination, subsolar longitude,
// GMST, RA, equation of time), otherwise the observed max rounded up with
// ~20% headroom (Earth-Sun distance: 1e-4 AU). These are regression
// guards for the 1900-2100 supported range, not global guarantees.

const DEC_BOUND_DEG = 0.01;
const LNG_BOUND_DEG = 0.01;
const GMST_BOUND_DEG = 0.01;
const RA_BOUND_DEG = 0.01;
const DISTANCE_BOUND_AU = 1e-4;
const EOT_BOUND_MIN = 0.1;

// [instant, USNO apparent dec deg, USNO GHA deg (west-positive 0..360),
//  USNO GMST hours] — 27 instants, 12:00 UT, 1900-2050.
const USNO_SOLAR = [
  ['1900-01-15T12:00:00Z', -21.154941, 357.609078, 19.63171613888889],
  ['1900-03-20T12:00:00Z', -0.22459, 358.079092, 23.837144805555553],
  ['1900-06-21T12:00:00Z', 23.450831, 359.645036, 5.948158333333334],
  ['1900-09-23T12:00:00Z', 0.005243, 1.889742, 12.124881694444445],
  ['1900-12-22T12:00:00Z', -23.450483, 0.339501, 18.038765750000003],
  ['1950-01-15T12:00:00Z', -21.179047, 357.65547, 19.624507805555556],
  ['1950-03-21T12:00:00Z', 0.122127, 358.152553, 23.89564633333333],
  ['1950-06-21T12:00:00Z', 23.447452, 359.616728, 5.940950111111111],
  ['1950-09-23T12:00:00Z', 0.044207, 1.867236, 12.117673527777779],
  ['1950-12-22T12:00:00Z', -23.447878, 0.39155, 18.031557666666664],
  ['2000-01-15T12:00:00Z', -21.194734, 357.694998, 19.61731236111111],
  ['2000-02-29T12:00:00Z', -7.741088, 356.88415, 22.574254472222222],
  ['2000-03-20T12:00:00Z', 0.072673, 358.155551, 23.888450944444443],
  ['2000-06-21T12:00:00Z', 23.437213, 359.545964, 5.999464611111111],
  ['2000-09-22T12:00:00Z', 0.088605, 1.857329, 12.110478277777778],
  ['2000-12-21T12:00:00Z', -23.438129, 0.4363, 18.024362444444442],
  ['2024-02-29T12:00:00Z', -7.672672, 356.901246, 22.58657561111111],
  ['2026-01-15T12:00:00Z', -21.068475, 357.651721, 19.663515305555553],
  ['2026-03-20T12:00:00Z', -0.045442, 358.140786, 23.868944083333332],
  ['2026-06-21T12:00:00Z', 23.437851, 359.545561, 5.979957777777778],
  ['2026-09-23T12:00:00Z', -0.193181, 1.906845, 12.156681277777778],
  ['2026-12-21T12:00:00Z', -23.436888, 0.483716, 18.004855666666668],
  ['2050-01-15T12:00:00Z', -21.029694, 357.652116, 19.67583963888889],
  ['2050-03-20T12:00:00Z', 0.027766, 358.158985, 23.881268444444444],
  ['2050-06-21T12:00:00Z', 23.430336, 359.521121, 5.992282166666667],
  ['2050-09-22T12:00:00Z', 0.121207, 1.831819, 12.103295888888889],
  ['2050-12-21T12:00:00Z', -23.430218, 0.47509, 18.01718013888889]
];

// [instant, JPL apparent RA deg, JPL apparent dec deg] — 2080/2100 edge,
// 12:00 UT. JPL and USNO agree to ~0.03 arcsec at the shared 2026-06-21
// instant, so the two sources are consistent to far below the bounds.
const JPL_EDGE = [
  ['2080-06-20T12:00:00Z', 90.104625, 23.431361],
  ['2100-01-15T12:00:00Z', 297.344292, -21.052361],
  ['2100-03-20T12:00:00Z', 359.958417, -0.017917],
  ['2100-06-21T12:00:00Z', 90.278667, 23.427917],
  ['2100-09-22T12:00:00Z', 179.624875, 0.162722],
  ['2100-12-21T12:00:00Z', 269.635792, -23.427722]
];

// [instant, JPL Sun-Earth distance AU] — 15 instants, 1900-2100.
const JPL_DISTANCE = [
  ['1900-01-15T12:00:00Z', 0.98366668996783],
  ['1900-07-05T12:00:00Z', 1.01676771019098],
  ['1950-01-15T12:00:00Z', 0.98367801106214],
  ['1950-07-04T12:00:00Z', 1.01671086874705],
  ['2000-01-03T12:00:00Z', 0.98332153122491],
  ['2000-07-04T12:00:00Z', 1.01674034389361],
  ['2026-01-04T12:00:00Z', 0.983304077168],
  ['2026-01-15T12:00:00Z', 0.98370779833868],
  ['2026-06-21T12:00:00Z', 1.01620274452142],
  ['2026-07-04T12:00:00Z', 1.01663345573931],
  ['2050-01-15T12:00:00Z', 0.98366029277489],
  ['2050-06-21T12:00:00Z', 1.01621470118475],
  ['2050-07-04T12:00:00Z', 1.01662441719734],
  ['2100-01-15T12:00:00Z', 0.98363674659492],
  ['2100-07-04T12:00:00Z', 1.01668855214435]
];

// Reference equation of time (minutes, apparent solar time minus mean
// solar time) derived from the published USNO GHA:
//   EOT = GHA/15 + 12h - UT,  with UT = ((d + 0.5) mod 1) * 24h,
//   d = JD(instant) - 2451545.0. This is the defining identity
//   (AST - MST): UT is the mean solar time scale, so the USNO-published
//   apparent GHA compared against it yields the equation of time directly.
function referenceEotMinutes(instant, ghaDeg) {
  const jd = Date.parse(instant) / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const ut = ((d + 0.5) % 1 + 1) % 1 * 24;
  const ast = (ghaDeg / 15 + 12) % 24;
  let eot = (ast - ut) % 24;
  if (eot > 12) eot -= 24;
  if (eot < -12) eot += 24;
  return eot * 60;
}

describe('declination (subsolar latitude) vs USNO/JPL references (T-03)', () => {
  test('every sampled declination is within 0.01 deg of the published value', () => {
    for (const [instant, refDec] of [...USNO_SOLAR.map((r) => [r[0], r[1]]), ...JPL_EDGE.map((r) => [r[0], r[2]])]) {
      const daylight = SM.getSunEquatorial(new Date(instant)).delta;
      const err = daylight - refDec;
      assert.ok(Math.abs(err) < DEC_BOUND_DEG,
        `${instant} declination: Daylight ${daylight.toFixed(5)} deg vs reference ` +
        `${refDec.toFixed(5)} deg, error ${err.toFixed(5)} deg (bound ±${DEC_BOUND_DEG})`);
    }
  });
});

describe('subsolar longitude vs USNO references (T-03)', () => {
  test('every sampled subsolar longitude is within 0.01 deg of GHA-derived value', () => {
    for (const [instant, , ghaDeg] of USNO_SOLAR) {
      const refLng = SM.wrapLng(-ghaDeg); // GHA is west-positive; subsolar lng is east-positive
      const daylight = SM.getSubsolarPoint(new Date(instant)).lng;
      const err = SM.wrapLng(daylight - refLng);
      assert.ok(Math.abs(err) < LNG_BOUND_DEG,
        `${instant} subsolar longitude: Daylight ${daylight.toFixed(5)} deg vs ` +
        `reference ${refLng.toFixed(5)} deg, error ${err.toFixed(5)} deg (bound ±${LNG_BOUND_DEG})`);
    }
  });
});

describe('GMST vs USNO references (T-03)', () => {
  test('every sampled Greenwich mean sidereal time is within 0.01 deg of the published value', () => {
    for (const [instant, , , gmstHours] of USNO_SOLAR) {
      const refGmst = (gmstHours * 15) % 360;
      const daylight = SM.getSunEquatorial(new Date(instant)).gmstDeg;
      const err = SM.wrapLng(daylight - refGmst);
      assert.ok(Math.abs(err) < GMST_BOUND_DEG,
        `${instant} GMST: Daylight ${daylight.toFixed(5)} deg vs reference ` +
        `${refGmst.toFixed(5)} deg, error ${err.toFixed(5)} deg (bound ±${GMST_BOUND_DEG})`);
    }
  });
});

describe('right ascension at the 2100 range edge vs JPL references (T-03)', () => {
  test('every sampled right ascension is within 0.01 deg of the published value', () => {
    for (const [instant, refRa] of JPL_EDGE.map((r) => [r[0], r[1]])) {
      const daylight = SM.getSunEquatorial(new Date(instant)).alpha;
      const err = SM.wrapLng(daylight - refRa);
      assert.ok(Math.abs(err) < RA_BOUND_DEG,
        `${instant} right ascension: Daylight ${daylight.toFixed(5)} deg vs reference ` +
        `${refRa.toFixed(5)} deg, error ${err.toFixed(5)} deg (bound ±${RA_BOUND_DEG})`);
    }
  });
});

describe('Earth-Sun distance vs JPL references (T-03)', () => {
  test('every sampled distance is within 1e-4 AU of the published value', () => {
    for (const [instant, refAu] of JPL_DISTANCE) {
      const daylight = SM.getEarthSunDistanceAu(new Date(instant));
      const err = daylight - refAu;
      assert.ok(Math.abs(err) < DISTANCE_BOUND_AU,
        `${instant} distance: Daylight ${daylight.toExponential(8)} AU vs reference ` +
        `${refAu.toExponential(8)} AU, error ${err.toExponential(3)} AU (bound ±${DISTANCE_BOUND_AU})`);
    }
  });
});

describe('equation of time vs USNO-derived references (T-03)', () => {
  test('every sampled equation of time is within 0.1 minutes of the published-derived value', () => {
    for (const [instant, , ghaDeg] of USNO_SOLAR) {
      const refEot = referenceEotMinutes(instant, ghaDeg);
      const daylight = SM.getEquationOfTimeMinutes(new Date(instant));
      const err = daylight - refEot;
      assert.ok(Math.abs(err) < EOT_BOUND_MIN,
        `${instant} equation of time: Daylight ${daylight.toFixed(3)} min vs reference ` +
        `${refEot.toFixed(3)} min, error ${err.toFixed(3)} min (bound ±${EOT_BOUND_MIN})`);
    }
  });
});
