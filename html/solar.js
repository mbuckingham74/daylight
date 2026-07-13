/**
 * solar.js — Pure solar/astronomy math for the Daylight Map.
 *
 * UMD module: works in the browser (exposes window.SolarMath) and in Node
 * (exports the same functions for unit testing).
 *
 * All functions are side-effect-free and depend only on the JavaScript Date
 * object and standard Math. No DOM, no Leaflet, no SunCalc.
 *
 * Supported date range: 1900-2100. The low-precision solar position algorithm
 * (mean longitude, mean anomaly, ecliptic longitude, obliquity) is accurate to
 * roughly 0.01 deg in ecliptic longitude and 1 arcminute in declination within
 * this range. Subsolar longitude (which depends on GMST) is accurate to about
 * 0.01 deg. Earth-Sun distance is accurate to roughly 1e-5 AU.
 *
 * Sources:
 *   - Meeus, *Astronomical Algorithms*, 2nd ed., chapters 25-28.
 *   - USNO Circular 179 / Explanatory Supplement to the Astronomical Almanac.
 *   - GMST formula from the IERS 1996 / USNO expression.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SolarMath = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Physical constants ──────────────────────────────────────────────
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const AU_KM = 149597870.7;
  const KM_TO_MILES = 0.621371;
  const LIGHT_SECONDS_PER_AU = 499.004783836;
  const SOLAR_CONSTANT = 1361;
  const SOLAR_ANGULAR_DIAMETER_AT_1_AU = 0.533128;
  const EARTH_ORBIT_ECCENTRICITY = 0.0167086;
  const SUN_GRAVITATIONAL_PARAMETER = 132712440018;
  const MS_PER_DAY = 86400000;

  // ── Twilight rendering constants ────────────────────────────────────
  /** Atmospheric refraction at the horizon, degrees (standard 0.833 including solar semi-diameter). */
  const REFRACTION = 0.833;

  const DAY_COLOR = [255, 205, 92];
  const CIVIL_TWILIGHT_COLOR = [52, 62, 96];
  const NAUTICAL_TWILIGHT_COLOR = [25, 39, 82];
  const ASTRONOMICAL_TWILIGHT_COLOR = [11, 19, 52];
  const TWILIGHT_EDGE_COLOR = [92, 120, 190];
  const NIGHT_COLOR = [1, 4, 16];

  /**
   * Sine of solar altitude at each twilight boundary.
   * Using sin(altitude) avoids repeated trig calls in the tile inner loop.
   */
  const TWILIGHT_THRESHOLDS = {
    daylight: Math.sin(-REFRACTION * D2R),
    daylightGlow: Math.sin(18 * D2R),
    civil: Math.sin(-6 * D2R),
    nautical: Math.sin(-12 * D2R),
    astronomical: Math.sin(-18 * D2R)
  };

  const seasonEventCache = {};

  // ── Utility ─────────────────────────────────────────────────────────

  /** Wrap an angle to [0, 360). */
  function normalizeDegrees(deg) {
    return ((deg % 360) + 360) % 360;
  }

  /** Wrap longitude to [-180, 180) using fully sign-safe modulo. */
  function wrapLng(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clampZoom(zoom) {
    return Math.max(2, Math.min(12, Math.round(zoom)));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mixColor(from, to, amount) {
    return [
      Math.round(from[0] + (to[0] - from[0]) * amount),
      Math.round(from[1] + (to[1] - from[1]) * amount),
      Math.round(from[2] + (to[2] - from[2]) * amount)
    ];
  }

  function isValidDate(date) {
    return date && !isNaN(date.getTime());
  }

  // ── Solar position (low-precision) ──────────────────────────────────

  /**
   * Compute the Sun's equatorial coordinates and Greenwich Mean Sidereal Time.
   *
   * @param {Date} date
   * @returns {{ alpha: number, delta: number, gmstDeg: number, julian: number, daysSinceJ2000: number, meanLongitude: number, meanAnomaly: number, eclipticLongitude: number, obliquity: number }}
   *   alpha — right ascension in degrees [0, 360)
   *   delta — declination in degrees [-23.44, +23.44]
   *   gmstDeg — Greenwich Mean Sidereal Time in degrees [0, 360)
   */
  function getSunEquatorial(date) {
    const julian = date.getTime() / 86400000.0 + 2440587.5;
    const d = julian - 2451545.0;

    const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
    const gmstDeg = gmst * 15;

    const L = normalizeDegrees(280.460 + 0.9856474 * d);
    const g = normalizeDegrees(357.528 + 0.9856003 * d);

    const lambda = normalizeDegrees(L + 1.915 * Math.sin(g * D2R) + 0.02 * Math.sin(2 * g * D2R));

    const T = d / 36525;
    const epsilon = 23.43929111 - T * (46.836769 / 3600
      - T * (0.0001831 / 3600
        + T * (0.00200340 / 3600
          - T * (0.576e-6 / 3600
            - T * 4.34e-8 / 3600))));

    const lambdaR = lambda * D2R;
    const epsilonR = epsilon * D2R;
    const alpha = normalizeDegrees(Math.atan2(Math.cos(epsilonR) * Math.sin(lambdaR), Math.cos(lambdaR)) * R2D);
    const delta = Math.asin(Math.sin(epsilonR) * Math.sin(lambdaR)) * R2D;

    return {
      alpha,
      delta,
      gmstDeg,
      julian,
      daysSinceJ2000: d,
      meanLongitude: L,
      meanAnomaly: g,
      eclipticLongitude: lambda,
      obliquity: epsilon
    };
  }

  /**
   * Subsolar point: the point on Earth where the Sun is directly overhead.
   * Latitude = declination, longitude = RA - GMST (east-positive, wrapped).
   *
   * @param {Date} date
   * @returns {{ lat: number, lng: number }} lat in [-23.44, +23.44], lng in [-180, 180)
   */
  function getSubsolarPoint(date) {
    const sun = getSunEquatorial(date);
    return { lat: sun.delta, lng: wrapLng(sun.alpha - sun.gmstDeg) };
  }

  /**
   * Compact solar render state (precomputed sin/cos of declination).
   * Used by the tile renderer and altitude calculations.
   *
   * @param {Date} date
   * @returns {{ lat: number, lng: number, sinDec: number, cosDec: number }}
   */
  function getSunRenderState(date) {
    const subsolar = getSubsolarPoint(date);
    const declination = subsolar.lat * D2R;
    return {
      lat: subsolar.lat,
      lng: subsolar.lng,
      sinDec: Math.sin(declination),
      cosDec: Math.cos(declination)
    };
  }

  /**
   * Sine of the Sun's altitude at a given geographic coordinate and instant.
   *
   * @param {Date} date
   * @param {number} lat — geographic latitude in degrees
   * @param {number} lng — geographic longitude in degrees (east-positive)
   * @returns {number} sin(altitude) in [-1, 1]
   */
  function getSolarSinAltitude(date, lat, lng) {
    const sun = getSunRenderState(date);
    const latR = lat * D2R;
    const hourAngle = wrapLng(lng - sun.lng) * D2R;
    return Math.sin(latR) * sun.sinDec + Math.cos(latR) * sun.cosDec * Math.cos(hourAngle);
  }

  // ── Earth-Sun distance and orbital stats ────────────────────────────

  /**
   * Earth-Sun distance in AU from the mean anomaly.
   *
   * @param {Date} date
   * @returns {number} distance in AU, roughly [0.983, 1.017]
   */
  function getEarthSunDistanceAu(date) {
    const sun = getSunEquatorial(date);
    const anomaly = sun.meanAnomaly * D2R;
    return 1.00014 - 0.01671 * Math.cos(anomaly) - 0.00014 * Math.cos(2 * anomaly);
  }

  /**
   * Orbital stats derived from Earth-Sun distance.
   *
   * @param {Date} date
   * @returns {{ distanceAu: number, distanceKm: number, distanceMiles: number, lightSeconds: number, orbitalSpeed: number, energyRatio: number, solarConstant: number, apparentDiameterDeg: number, dailyChangeKm: number, trend: string }}
   */
  function getSolarOrbitStats(date) {
    const distanceAu = getEarthSunDistanceAu(date);
    const distanceKm = distanceAu * AU_KM;
    const dailyChangeKm = (getEarthSunDistanceAu(new Date(date.getTime() + MS_PER_DAY))
      - getEarthSunDistanceAu(new Date(date.getTime() - MS_PER_DAY))) * AU_KM / 2;
    const orbitalSpeed = Math.sqrt(SUN_GRAVITATIONAL_PARAMETER * (2 / distanceKm - 1 / AU_KM));
    const energyRatio = 1 / (distanceAu * distanceAu);
    const trend = Math.abs(dailyChangeKm) < 250
      ? 'Near orbital turn'
      : dailyChangeKm < 0
        ? 'Closing toward perihelion'
        : 'Receding toward aphelion';

    return {
      distanceAu,
      distanceKm,
      distanceMiles: distanceKm * KM_TO_MILES,
      lightSeconds: distanceAu * LIGHT_SECONDS_PER_AU,
      orbitalSpeed,
      energyRatio,
      solarConstant: SOLAR_CONSTANT * energyRatio,
      apparentDiameterDeg: SOLAR_ANGULAR_DIAMETER_AT_1_AU / distanceAu,
      dailyChangeKm,
      trend
    };
  }

  /**
   * Equation of time in minutes. Positive means the apparent Sun is ahead of
   * the mean Sun (sundial reads fast). Range roughly [-14.2, +16.4] minutes.
   *
   * @param {Date} date
   * @returns {number} equation of time in minutes
   */
  function getEquationOfTimeMinutes(date) {
    const sun = getSunEquatorial(date);
    const T = sun.daysSinceJ2000 / 36525;
    const eccentricity = EARTH_ORBIT_ECCENTRICITY - T * (0.000042037 + 0.0000001267 * T);
    const meanLongitude = sun.meanLongitude * D2R;
    const meanAnomaly = sun.meanAnomaly * D2R;
    const obliquity = sun.obliquity * D2R;
    const y = Math.tan(obliquity / 2) ** 2;
    const eot = y * Math.sin(2 * meanLongitude)
      - 2 * eccentricity * Math.sin(meanAnomaly)
      + 4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * meanLongitude)
      - 0.5 * y * y * Math.sin(4 * meanLongitude)
      - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly);
    return eot * R2D * 4;
  }

  /**
   * Solar altitude and azimuth at a given geographic coordinate and instant.
   *
   * @param {Date} date
   * @param {number} lat — geographic latitude in degrees
   * @param {number} lng — geographic longitude in degrees (east-positive)
   * @returns {{ altitude: number, azimuth: number, zenith: number, hourAngle: number }}
   *   altitude in degrees [-90, +90], azimuth in degrees [0, 360) measured clockwise from north
   */
  function getSolarPosition(date, lat, lng) {
    const sun = getSunEquatorial(date);
    const subsolarLng = wrapLng(sun.alpha - sun.gmstDeg);
    const latR = lat * D2R;
    const declination = sun.delta * D2R;
    const hourAngle = wrapLng(lng - subsolarLng) * D2R;
    const sinAltitude = Math.sin(latR) * Math.sin(declination)
      + Math.cos(latR) * Math.cos(declination) * Math.cos(hourAngle);
    const altitude = Math.asin(clamp(sinAltitude, -1, 1)) * R2D;
    const azimuth = normalizeDegrees(Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latR) - Math.tan(declination) * Math.cos(latR)
    ) * R2D + 180);

    return {
      altitude,
      azimuth,
      zenith: 90 - altitude,
      hourAngle: hourAngle * R2D
    };
  }

  // ── Global light fractions ──────────────────────────────────────────

  /**
   * Fraction of Earth's surface in each light band, assuming a spherical Earth
   * and the standard twilight altitude thresholds. Computed analytically from
   * the area of a spherical cap.
   *
   * @returns {{ daylight: number, civil: number, nautical: number, astronomical: number, night: number }}
   */
  function getGlobalLightFractions() {
    const fractionAbove = altitudeDeg => (1 - Math.sin(altitudeDeg * D2R)) / 2;
    const daylight = fractionAbove(-REFRACTION);
    const civilAndAbove = fractionAbove(-6);
    const nauticalAndAbove = fractionAbove(-12);
    const astroAndAbove = fractionAbove(-18);

    return {
      daylight,
      civil: civilAndAbove - daylight,
      nautical: nauticalAndAbove - civilAndAbove,
      astronomical: astroAndAbove - nauticalAndAbove,
      night: 1 - astroAndAbove
    };
  }

  // ── Twilight pixel rendering ────────────────────────────────────────

  function accentTwilightBoundary(pixel, sinAltitude) {
    const edgeWidth = Math.sin(1.15 * D2R);
    const boundaries = [
      TWILIGHT_THRESHOLDS.civil,
      TWILIGHT_THRESHOLDS.nautical,
      TWILIGHT_THRESHOLDS.astronomical
    ];
    const accent = boundaries.reduce((strongest, boundary) => {
      const distance = Math.abs(sinAltitude - boundary);
      return Math.max(strongest, 1 - smoothstep(0, edgeWidth, distance));
    }, 0);

    if (accent <= 0) return pixel;

    return {
      color: mixColor(pixel.color, TWILIGHT_EDGE_COLOR, 0.38 * accent),
      alpha: Math.min(190, Math.round(pixel.alpha + 30 * accent))
    };
  }

  /**
   * Get the { color, alpha } pixel for a given sin(solar altitude).
   * Returns null for fully transparent daylight glow pixels with zero alpha.
   *
   * @param {number} sinAltitude — sin of the Sun's altitude
   * @returns {{ color: number[], alpha: number } | null}
   */
  function getTwilightPixel(sinAltitude) {
    if (sinAltitude >= TWILIGHT_THRESHOLDS.daylight) {
      const glow = smoothstep(TWILIGHT_THRESHOLDS.daylight, TWILIGHT_THRESHOLDS.daylightGlow, sinAltitude);
      const alpha = Math.round(6 * glow);
      return alpha > 0 ? { color: DAY_COLOR, alpha } : null;
    }

    if (sinAltitude >= TWILIGHT_THRESHOLDS.civil) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.daylight, TWILIGHT_THRESHOLDS.civil, sinAltitude);
      const pixel = { color: CIVIL_TWILIGHT_COLOR, alpha: Math.round(42 + 30 * amount) };
      return accentTwilightBoundary(pixel, sinAltitude);
    }

    let pixel;
    if (sinAltitude >= TWILIGHT_THRESHOLDS.nautical) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.civil, TWILIGHT_THRESHOLDS.nautical, sinAltitude);
      pixel = { color: NAUTICAL_TWILIGHT_COLOR, alpha: Math.round(88 + 32 * amount) };
      return accentTwilightBoundary(pixel, sinAltitude);
    }

    if (sinAltitude >= TWILIGHT_THRESHOLDS.astronomical) {
      const amount = smoothstep(TWILIGHT_THRESHOLDS.nautical, TWILIGHT_THRESHOLDS.astronomical, sinAltitude);
      pixel = { color: ASTRONOMICAL_TWILIGHT_COLOR, alpha: Math.round(132 + 34 * amount) };
      return accentTwilightBoundary(pixel, sinAltitude);
    }

    return { color: NIGHT_COLOR, alpha: 178 };
  }

  // ── Seasonal events (equinoxes and solstices) ───────────────────────

  /**
   * Compute the four seasonal events for a given year by numerically
   * refining declination zero-crossings (equinoxes) and extrema (solstices).
   * Results are cached per year.
   *
   * @param {number} year — UTC year
   * @returns {Array<{ name: string, date: Date }>} four events sorted by date
   */
  function getSeasonEvents(year) {
    if (seasonEventCache[year]) return seasonEventCache[year];

    const events = [
      {
        name: 'March equinox',
        date: refineDeclinationRoot(Date.UTC(year, 2, 18), Date.UTC(year, 2, 22))
      },
      {
        name: 'June solstice',
        date: refineDeclinationExtremum(Date.UTC(year, 5, 18), Date.UTC(year, 5, 23), true)
      },
      {
        name: 'September equinox',
        date: refineDeclinationRoot(Date.UTC(year, 8, 20), Date.UTC(year, 8, 25))
      },
      {
        name: 'December solstice',
        date: refineDeclinationExtremum(Date.UTC(year, 11, 18), Date.UTC(year, 11, 23), false)
      }
    ];

    seasonEventCache[year] = events;
    return events;
  }

  /** Clear the season event cache (useful when testing). */
  function clearSeasonEventCache() {
    for (const key in seasonEventCache) delete seasonEventCache[key];
  }

  /** Bisection refinement for declination zero-crossings (equinoxes). */
  function refineDeclinationRoot(startMs, endMs) {
    let low = startMs;
    let high = endMs;
    let lowValue = getSunEquatorial(new Date(low)).delta;
    const highValue = getSunEquatorial(new Date(high)).delta;

    if (lowValue === 0) return new Date(low);
    if (highValue === 0) return new Date(high);
    if (Math.sign(lowValue) === Math.sign(highValue)) return new Date((low + high) / 2);

    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      const midValue = getSunEquatorial(new Date(mid)).delta;
      if (Math.sign(lowValue) === Math.sign(midValue)) {
        low = mid;
        lowValue = midValue;
      } else {
        high = mid;
      }
    }

    return new Date((low + high) / 2);
  }

  /** Ternary-search refinement for declination extrema (solstices). */
  function refineDeclinationExtremum(startMs, endMs, findMaximum) {
    let low = startMs;
    let high = endMs;

    for (let i = 0; i < 50; i++) {
      const m1 = low + (high - low) / 3;
      const m2 = high - (high - low) / 3;
      const d1 = getSunEquatorial(new Date(m1)).delta;
      const d2 = getSunEquatorial(new Date(m2)).delta;
      if (findMaximum ? d1 < d2 : d1 > d2) {
        low = m1;
      } else {
        high = m2;
      }
    }

    return new Date((low + high) / 2);
  }

  /**
   * Find the next seasonal event after the given date.
   * Searches the current year and ±2 years to handle year boundaries.
   *
   * @param {Date} date
   * @returns {{ name: string, date: Date } | null}
   */
  function getNextSeasonEvent(date) {
    const year = date.getUTCFullYear();
    const events = [];
    for (let y = year - 1; y <= year + 2; y++) {
      events.push(...getSeasonEvents(y));
    }

    return events
      .filter(event => event.date > date)
      .sort((a, b) => a.date - b.date)[0] || null;
  }

  /**
   * Get the day length in seconds for a given date and location.
   * Requires SunCalc to be provided via the dependency injection parameter.
   *
   * @param {Date} date
   * @param {number} lat
   * @param {number} lng
   * @param {object} sunCalc — SunCalc module (must have getTimes)
   * @returns {number} day length in seconds [0, 86400]
   */
  function getDayLengthSeconds(date, lat, lng, sunCalc) {
    const times = sunCalc.getTimes(date, lat, lng);
    if (isValidDate(times.sunrise) && isValidDate(times.sunset) && times.sunset > times.sunrise) {
      return (times.sunset - times.sunrise) / 1000;
    }

    const noon = isValidDate(times.solarNoon) ? times.solarNoon : date;
    return getSolarPosition(noon, lat, lng).altitude >= -REFRACTION ? 86400 : 0;
  }

  /**
   * Get a human-readable label for the current light state at a location.
   *
   * @param {Date} date
   * @param {number} lat
   * @param {number} lng
   * @returns {string} one of: Daylight, Civil twilight, Nautical twilight, Astronomical twilight, Night
   */
  function getLightStateLabel(date, lat, lng) {
    const sinAltitude = getSolarSinAltitude(date, lat, lng);
    if (sinAltitude >= TWILIGHT_THRESHOLDS.daylight) return 'Daylight';
    if (sinAltitude >= TWILIGHT_THRESHOLDS.civil) return 'Civil twilight';
    if (sinAltitude >= TWILIGHT_THRESHOLDS.nautical) return 'Nautical twilight';
    if (sinAltitude >= TWILIGHT_THRESHOLDS.astronomical) return 'Astronomical twilight';
    return 'Night';
  }

  // ── Permalink parameter parsing ─────────────────────────────────────

  /**
   * Parse and validate permalink URL parameters. Invalid fields are ignored
   * individually so a single bad value doesn't break the whole page.
   *
   * @param {string} search — the URL search string (e.g. "?time=...&lat=...")
   * @returns {{ time: Date|null, lat: number, lng: number, zoom: number, hasView: boolean, invalid: string[] }}
   *   lat/lng/zoom are NaN when absent or invalid. hasView is true if any view param is valid.
   *   invalid lists the names of params that were present but could not be parsed.
   */
  function parsePermalinkParams(search) {
    const params = new URLSearchParams(search);
    const invalid = [];

    const parsedTime = params.has('time') ? new Date(params.get('time')) : null;
    const time = parsedTime && !isNaN(parsedTime.getTime()) ? parsedTime : null;
    if (params.has('time') && !time) invalid.push('time');

    const rawLat = parseFloat(params.get('lat'));
    const rawLng = parseFloat(params.get('lon'));
    const rawZoom = parseInt(params.get('zoom'), 10);

    const lat = isFinite(rawLat) && rawLat >= -85 && rawLat <= 85 ? rawLat : NaN;
    const lng = isFinite(rawLng) ? wrapLng(rawLng) : NaN;
    const zoom = isFinite(rawZoom) ? clampZoom(rawZoom) : NaN;
    if (params.has('lat') && isNaN(lat)) invalid.push('lat');
    if (params.has('lon') && isNaN(lng)) invalid.push('lon');
    if (params.has('zoom') && isNaN(rawZoom)) invalid.push('zoom');

    const hasView = !isNaN(lat) || !isNaN(lng) || !isNaN(zoom);

    return { time, lat, lng, zoom, hasView, invalid };
  }

  // ── Public API ──────────────────────────────────────────────────────

  return {
    // Constants
    D2R,
    R2D,
    AU_KM,
    KM_TO_MILES,
    LIGHT_SECONDS_PER_AU,
    SOLAR_CONSTANT,
    SOLAR_ANGULAR_DIAMETER_AT_1_AU,
    EARTH_ORBIT_ECCENTRICITY,
    SUN_GRAVITATIONAL_PARAMETER,
    MS_PER_DAY,
    REFRACTION,
    DAY_COLOR,
    CIVIL_TWILIGHT_COLOR,
    NAUTICAL_TWILIGHT_COLOR,
    ASTRONOMICAL_TWILIGHT_COLOR,
    TWILIGHT_EDGE_COLOR,
    NIGHT_COLOR,
    TWILIGHT_THRESHOLDS,
    // Utility
    normalizeDegrees,
    wrapLng,
    clamp,
    clampZoom,
    smoothstep,
    mixColor,
    isValidDate,
    // Solar position
    getSunEquatorial,
    getSubsolarPoint,
    getSunRenderState,
    getSolarSinAltitude,
    // Orbital
    getEarthSunDistanceAu,
    getSolarOrbitStats,
    getEquationOfTimeMinutes,
    getSolarPosition,
    // Global light
    getGlobalLightFractions,
    // Twilight rendering
    getTwilightPixel,
    accentTwilightBoundary,
    // Seasonal events
    getSeasonEvents,
    getNextSeasonEvent,
    clearSeasonEventCache,
    // SunCalc-dependent (dependency injection)
    getDayLengthSeconds,
    // Labels
    getLightStateLabel,
    // Permalink
    parsePermalinkParams
  };
}));
