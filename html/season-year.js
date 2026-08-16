/**
 * season-year.js — UTC-year decisions for the 2D Daylight map (D-05).
 *
 * UMD module: works in the browser (exposes window.SeasonYear) and in Node
 * (exports the same functions for unit testing), matching solar.js / view.js /
 * app-scheduler.js.
 *
 * Seasonal events (equinoxes and solstices) are computed per UTC year in
 * solar.js (getSeasonEvents builds every instant from Date.UTC(year, ...)),
 * and the documented 1900-2100 accuracy envelope is likewise a UTC-year
 * contract. The 2D UI must therefore select the active astronomical year and
 * classify supported-range membership from the displayed instant's UTC year,
 * never the browser-local calendar year: near the UTC New Year boundary a
 * viewer in a timezone behind or ahead of UTC can be in a different local
 * calendar year than the astronomical one (D-05).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SeasonYear = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Supported accuracy envelope, in UTC years (see solar.js header contract).
  const SUPPORTED_MIN_YEAR = 1900;
  const SUPPORTED_MAX_YEAR = 2100;

  /**
   * The astronomical (UTC) year of the given instant — the year whose
   * seasonal events are the active presets for that displayed instant.
   *
   * @param {Date} date
   * @returns {number} UTC year
   */
  function getSeasonEventYear(date) {
    return date.getUTCFullYear();
  }

  /**
   * Whether the instant lies inside the documented 1900-2100 UTC accuracy
   * envelope, classified by its UTC year.
   *
   * @param {Date} date
   * @returns {boolean}
   */
  function isWithinSupportedRange(date) {
    const year = date.getUTCFullYear();
    return year >= SUPPORTED_MIN_YEAR && year <= SUPPORTED_MAX_YEAR;
  }

  return { getSeasonEventYear, isWithinSupportedRange };
}));
