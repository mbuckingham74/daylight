/**
 * solstice-twin.js — UI-04: closest-daylight-duration twin on the opposite
 * side of the source's nearest solstice.
 *
 * UMD module: works in the browser (exposes window.SolsticeTwin) and in Node
 * (exports the same functions for unit testing), matching solar.js /
 * season-year.js / time-state.js.
 *
 * Owns only the twin-date calculation. No DOM access, no Leaflet, no
 * application state, no caching, no scheduler. Reads solar-season-event
 * primitives through the injected `getSeasonEvents` parameter; computes
 * daylight duration through the injected `sunCalc` (SunCalc is the same
 * dependency that powers the rest of Daylight, so the matching criterion
 * agrees with the production sunrise/sunset readouts).
 *
 * Algorithm:
 *   1. Compute the source's daylight duration at (lat, lng). Polar source
 *      (24h daylight or 24h darkness) returns unavailable — a long polar
 *      plateau offers no unique meaningful twin and the UI must not
 *      invent precision.
 *   2. Find the nearest June or December solstice to the source date.
 *      Equinoxes are quarter boundaries only; the relevant bridge is
 *      always a solstice so the search interval lies on the opposite
 *      side of that bridge.
 *   3. The candidate search interval is the quarter immediately across
 *      the relevant solstice from the source:
 *        - source < solstice: search AFTER the solstice up to the next
 *          boundary event (equinox)
 *        - source > solstice: search BEFORE the solstice down to the
 *          previous boundary event (equinox)
 *      The interval is exclusive on both ends, so the source calendar
 *      day itself is never returned. Year boundaries are handled by
 *      spanning the three UTC-year event sets (previous, current,
 *      next) when the source sits near 1 Jan.
 *   4. Enumerate every calendar day in that interval at the same noon-UTC
 *      anchor convention the rest of Daylight uses for daily readings,
 *      evaluate daylight duration at (lat, lng), and choose the candidate
 *      minimizing the absolute daylight-duration difference.
 *   5. Deterministic tie-break (the existing solar primitives don't make
 *      ties common, but if two candidates match within the precision of
 *      the day-length calculation):
 *        a. smallest absolute daylight-duration difference (primary)
 *        b. smallest combined absolute sunrise+sunset time difference
 *           when both sides are normal rise/set days (UTC milliseconds,
 *           independent of timezone)
 *        c. earlier calendar date (final deterministic tie-break)
 *   6. Equidistant solstice tie: when the source sits roughly at the
 *      temporal midpoint between the upcoming June and December solstices
 *      (i.e. near one of the equinox instants — the exact midpoint in
 *      time drifts by several days from the equinox because Earth's
 *      orbital speed is non-uniform), the earlier solstice is preferred
 *      — documented deterministic rule that the equinox itself is
 *      treated as belonging to the half-year ENDING at the just-passed
 *      solstice.
 *   7. Polar-plateau detection: when the entire search interval is also
 *      polar (every candidate's daylight is 86400 or 0), there is no
 *      unique match — return unavailable with reason 'polar-plateau'.
 *
 * The result is a small plain object suitable for direct rendering. The
 * `available` boolean makes the unavailable state explicit so the UI
 * cannot silently invent precision.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SolsticeTwin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS_PER_DAY = 86400000;

  // The solar primitives that this module needs are taken as injected
  // parameters (getSeasonEvents, getDayLengthSeconds, MS_PER_DAY,
  // isValidDate) so the module stays decoupled from window.SolarMath in
  // tests and from any future reorganization of solar.js. The browser
  // composition root passes the production functions through; tests can
  // substitute equivalents when validating the algorithm in isolation.
  function create(deps) {
    const {
      getSeasonEvents,
      getDayLengthSeconds,
      MS_PER_DAY: DEP_MS_PER_DAY,
      isValidDate
    } = deps || {};

    if (typeof getSeasonEvents !== 'function') throw new Error('SolsticeTwin: getSeasonEvents required');
    if (typeof getDayLengthSeconds !== 'function') throw new Error('SolsticeTwin: getDayLengthSeconds required');
    if (typeof isValidDate !== 'function') throw new Error('SolsticeTwin: isValidDate required');
    const DAY_MS = DEP_MS_PER_DAY || MS_PER_DAY;

    // The four seasonal events are listed in calendar order inside their
    // year. The solstices are indices 1 (June) and 3 (December). This
    // helper exposes a stable lookup that returns null for an unknown
    // event so callers can fail closed.
    function getEventForYear(year, name) {
      const events = getSeasonEvents(year);
      return events.find(event => event.name === name) || null;
    }

    // Given a source date, return the nearest June or December solstice
    // event (with date). The four equinoxes/solstices of the source's
    // UTC year plus the previous and next years are considered so that
    // sources near 1 Jan still resolve to the correct solstice. Solstice
    // ties are broken by preferring the EARLIER solstice — this makes
    // the equinox instants (which sit roughly between two solstices
    // but not exactly halfway in time, because Earth's orbital speed is
    // non-uniform) belong to the half-year ENDING at the just-passed
    // solstice, matching the existing seasonal-event architecture.
    function findNearestSolstice(sourceDate) {
      const year = sourceDate.getUTCFullYear();
      const events = [
        ...getSeasonEvents(year - 1),
        ...getSeasonEvents(year),
        ...getSeasonEvents(year + 1)
      ];
      const SOLSTICE_NAMES = ['June solstice', 'December solstice'];
      const solstices = events.filter(event => SOLSTICE_NAMES.includes(event.name));
      if (solstices.length === 0) return null;
      let nearest = null;
      let nearestAbs = Infinity;
      for (const event of solstices) {
        const diff = Math.abs(event.date.getTime() - sourceDate.getTime());
        if (diff < nearestAbs) {
          nearestAbs = diff;
          nearest = event;
        } else if (diff === nearestAbs && event.date < nearest.date) {
          nearest = event;
        }
      }
      return nearest;
    }

    // Given the source date and the relevant solstice, return the two
    // events that bound the candidate search interval (the quarter
    // immediately across the solstice from the source). The solstice
    // itself is one endpoint of the interval; the opposite boundary
    // event (equinox) is the other. The result names the endpoints so
    // the UI and tests can identify which half-year is being searched.
    //
    // Convention: source < solstice means the search goes FORWARD from
    // the solstice to the next boundary (next quarter); source >=
    // solstice means the search goes BACKWARD from the solstice to the
    // previous boundary (previous quarter). The solstice instant itself
    // is excluded from the candidate set by the day-by-day enumeration
    // (which uses calendar days starting at the solstice's UTC calendar
    // day + 1 for forward searches and ending at the solstice's UTC
    // calendar day for backward searches).
    function findCandidateInterval(sourceDate, solstice) {
      const SEQUENCE = [
        'March equinox',
        'June solstice',
        'September equinox',
        'December solstice'
      ];
      const idx = SEQUENCE.indexOf(solstice.name);
      if (idx < 0) return null;
      const sourceBeforeSolstice = sourceDate.getTime() < solstice.date.getTime();
      const year = solstice.date.getUTCFullYear();
      if (sourceBeforeSolstice) {
        const nextName = SEQUENCE[(idx + 1) % SEQUENCE.length];
        // The next event is in the same year for June-solstice sources
        // (Sep equinox of the same year) and crosses the year boundary
        // for December-solstice sources (March equinox of the next year).
        let next = getEventForYear(year, nextName);
        if (!next || next.date.getTime() <= solstice.date.getTime()) {
          next = getEventForYear(year + 1, nextName);
        }
        if (!next) return null;
        return { from: solstice, to: next, fromName: solstice.name, toName: next.name };
      }
      const prevName = SEQUENCE[(idx + SEQUENCE.length - 1) % SEQUENCE.length];
      // The previous event is in the same year for December-solstice
      // sources (September equinox of the same year) and crosses the
      // year boundary for June-solstice sources (March equinox of the
      // same year, since March is BEFORE June).
      let prev = getEventForYear(year, prevName);
      if (!prev || prev.date.getTime() >= solstice.date.getTime()) {
        prev = getEventForYear(year - 1, prevName);
      }
      if (!prev) return null;
      return { from: prev, to: solstice, fromName: prev.name, toName: solstice.name };
    }

    // The "noon-UTC" anchor for a calendar day: the UTC instant that sits
    // 12h after the start of the calendar day. Used for both the source
    // daylight-duration evaluation and each candidate so the comparison
    // is independent of the underlying solstice instants (which fall at
    // varying UTC times of day).
    function noonUtcOfCalendarDay(date) {
      return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        12, 0, 0, 0
      ));
    }

    // Build the list of candidate calendar days in the quarter strictly
    // between the two interval endpoints returned by findCandidateInterval.
    // The interval is exclusive on both ends (the solstice itself and the
    // opposite equinox are excluded), so the source calendar day is
    // never returned regardless of the source's UTC clock time. Each
    // candidate is anchored at noon UTC of its calendar day so it is
    // comparable to the source's noon-UTC anchor regardless of the
    // boundary instants' UTC clock times.
    function enumerateCandidateDates(interval) {
      const startCalDay = Date.UTC(
        interval.from.date.getUTCFullYear(),
        interval.from.date.getUTCMonth(),
        interval.from.date.getUTCDate() + 1
      );
      const endCalDay = Date.UTC(
        interval.to.date.getUTCFullYear(),
        interval.to.date.getUTCMonth(),
        interval.to.date.getUTCDate()
      );
      const dates = [];
      for (let ms = startCalDay; ms < endCalDay; ms += DAY_MS) {
        dates.push(new Date(ms));
      }
      return dates.map(noonUtcOfCalendarDay);
    }

    // Calendar-day equality (UTC). Excludes the source's calendar day
    // from the candidate set so the source itself is never returned,
    // even when the source instant lies exactly at noon UTC.
    function sameUtcCalendarDay(a, b) {
      return a.getUTCFullYear() === b.getUTCFullYear()
        && a.getUTCMonth() === b.getUTCMonth()
        && a.getUTCDate() === b.getUTCDate();
    }

    // SunCalc returns invalid Date objects for rise/set transitions that
    // don't occur at this latitude. The combined |Δsunrise| + |Δsunset|
    // tie-break is meaningful only when both source and candidate yield
    // valid rise/set times; otherwise the secondary tie-break is
    // considered undefined and we fall through to the date-order
    // tie-break.
    function clockDiffMs(sourceTimes, candidateTimes) {
      if (!isValidDate(sourceTimes.sunrise) || !isValidDate(sourceTimes.sunset)) return null;
      if (!isValidDate(candidateTimes.sunrise) || !isValidDate(candidateTimes.sunset)) return null;
      const riseDiff = Math.abs(sourceTimes.sunrise.getTime() - candidateTimes.sunrise.getTime());
      const setDiff = Math.abs(sourceTimes.sunset.getTime() - candidateTimes.sunset.getTime());
      return riseDiff + setDiff;
    }

    return {
      /**
       * Find the calendar date in the half-year interval on the opposite
       * side of the source's preceding solstice whose daylight duration
       * at the same latitude/longitude is closest to the source's
       * daylight duration.
       *
       * @param {Date} date — the source instant
       * @param {number} lat — latitude in degrees
       * @param {number} lng — longitude in degrees
       * @param {object} sunCalc — SunCalc-compatible module with getTimes
       * @returns {{
       *   available: boolean,
       *   date?: Date,
       *   dayLength?: number,
       *   difference?: number,
       *   sunrise?: Date,
       *   sunset?: Date,
       *   sourceDate: Date,
       *   sourceDayLength: number,
       *   sourceSunrise?: Date,
       *   sourceSunset?: Date,
       *   sourceSolsticeName?: string,
       *   priorSolsticeName?: string,
       *   reason?: string
       * }}
       */
      find: function find(date, lat, lng, sunCalc) {
        const sourceDate = new Date(date.getTime());
        const sourceNoon = noonUtcOfCalendarDay(sourceDate);
        const sourceDayLength = getDayLengthSeconds(sourceNoon, lat, lng, sunCalc);
        const sourceTimes = sunCalc.getTimes(sourceNoon, lat, lng);
        const result = {
          available: false,
          sourceDate: new Date(sourceDate.getTime()),
          sourceDayLength,
          sourceSunrise: isValidDate(sourceTimes.sunrise) ? new Date(sourceTimes.sunrise.getTime()) : null,
          sourceSunset: isValidDate(sourceTimes.sunset) ? new Date(sourceTimes.sunset.getTime()) : null
        };

        if (sourceDayLength === 0 || sourceDayLength === 86400) {
          result.reason = 'polar-source';
          return result;
        }

        const relevantSolstice = findNearestSolstice(sourceDate);
        if (!relevantSolstice) {
          result.reason = 'no-solstice';
          return result;
        }
        const interval = findCandidateInterval(sourceDate, relevantSolstice);
        if (!interval) {
          result.reason = 'no-solstice';
          return result;
        }

        result.sourceSolsticeName = relevantSolstice.name;
        result.preSolsticeName = interval.fromName;
        result.postSolsticeName = interval.toName;

        const candidateDates = enumerateCandidateDates(interval);
        if (candidateDates.length === 0) {
          result.reason = 'no-solstice';
          return result;
        }

        let best = null;
        let plateauMax = 0;
        let plateauMin = 86400;
        for (const candidateDate of candidateDates) {
          if (sameUtcCalendarDay(candidateDate, sourceDate)) continue;
          const candidateDayLength = getDayLengthSeconds(candidateDate, lat, lng, sunCalc);
          if (candidateDayLength > plateauMax) plateauMax = candidateDayLength;
          if (candidateDayLength < plateauMin) plateauMin = candidateDayLength;
          const diff = Math.abs(candidateDayLength - sourceDayLength);
          if (!best || diff < best.diff) {
            const candidateTimes = sunCalc.getTimes(candidateDate, lat, lng);
            best = {
              date: candidateDate,
              dayLength: candidateDayLength,
              diff,
              clockDiff: clockDiffMs(sourceTimes, candidateTimes),
              sunrise: isValidDate(candidateTimes.sunrise) ? new Date(candidateTimes.sunrise.getTime()) : null,
              sunset: isValidDate(candidateTimes.sunset) ? new Date(candidateTimes.sunset.getTime()) : null
            };
          } else if (diff === best.diff) {
            // Same |ΔdayLength| as the running best — apply the secondary
            // and tertiary tie-breaks before replacing.
            const candidateTimes = sunCalc.getTimes(candidateDate, lat, lng);
            const secondaryDiff = clockDiffMs(sourceTimes, candidateTimes);
            const secondaryBest = best.clockDiff;
            let preferCandidate = false;
            if (secondaryDiff !== null && secondaryBest !== null) {
              if (secondaryDiff < secondaryBest) preferCandidate = true;
              else if (secondaryDiff === secondaryBest && candidateDate.getTime() < best.date.getTime()) preferCandidate = true;
            } else if (secondaryDiff === null && secondaryBest === null) {
              if (candidateDate.getTime() < best.date.getTime()) preferCandidate = true;
            }
            if (preferCandidate) {
              best = {
                date: candidateDate,
                dayLength: candidateDayLength,
                diff,
                clockDiff: secondaryDiff,
                sunrise: isValidDate(candidateTimes.sunrise) ? new Date(candidateTimes.sunrise.getTime()) : null,
                sunset: isValidDate(candidateTimes.sunset) ? new Date(candidateTimes.sunset.getTime()) : null
              };
            }
          }
        }

        // If every candidate in the search interval is polar, there is no
        // unique meaningful twin — the source has a real daylight duration
        // but no candidate in the opposite quarter does.
        if (best && plateauMax === plateauMin && (plateauMax === 86400 || plateauMax === 0)) {
          result.reason = 'polar-plateau';
          return result;
        }

        if (!best) {
          result.reason = 'no-solstice';
          return result;
        }

        result.available = true;
        result.date = best.date;
        result.dayLength = best.dayLength;
        result.difference = best.diff;
        result.sunrise = best.sunrise;
        result.sunset = best.sunset;
        return result;
      }
    };
  }

  return {
    create
  };
}));
