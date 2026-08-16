/**
 * format.js — Shared presentation formatting primitives for Daylight.
 *
 * UMD module: works in the browser (exposes window.DaylightFormat) and in
 * Node (exports the same functions for unit testing), matching solar.js /
 * view.js / app-scheduler.js.
 *
 * A-03: canonical home for the formatting contracts that are duplicated
 * across Daylight's pages (2D map + 3D globe) or shared through the
 * composition root into controllers (SolarDetails, BrowserLocation).
 * Pure functions only: no state, no DOM access, no Leaflet, no astronomy,
 * no URL handling, no application callbacks. Precision, sign handling,
 * fallback text, and negative-zero behavior are preserved exactly from the
 * previous app.js / globe.js implementations (see tests/format.test.js for
 * the characterization evidence).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DaylightFormat = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS_PER_DAY = 86400000;

  /** Wrap an angle to [0, 360). Mirrors SolarMath.normalizeDegrees. */
  function normalizeDegrees(deg) {
    return ((deg % 360) + 360) % 360;
  }

  /**
   * UTC date stamp, e.g. "2026-06-21". Previously defined in app.js and
   * inlined in globe.js (identical expression).
   */
  function formatUtcDate(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Clock time via Intl 'en-US', e.g. "08:24" / "8:24 AM" (seconds ->
   * "08:24:00"). Canonical form of the previous app.js formatTime /
   * formatTimeTz / formatClockTz trio: same invalid-value fallback
   * ('--:--' or '--:--:--' when seconds are requested) and same fallback
   * to UTC when a timeZone is invalid. hour12 is an explicit parameter
   * (no module state).
   */
  function formatTime(date, options) {
    const { timeZone = 'UTC', seconds = false, hour12 = false } = options || {};
    if (!date || isNaN(date.getTime())) return seconds ? '--:--:--' : '--:--';
    const base = {
      hour: hour12 ? 'numeric' : '2-digit',
      minute: '2-digit',
      hour12
    };
    if (seconds) base.second = '2-digit';
    try {
      return date.toLocaleTimeString('en-US', Object.assign({}, base, { timeZone }));
    } catch (e) {
      return date.toLocaleTimeString('en-US', Object.assign({}, base, { timeZone: 'UTC' }));
    }
  }

  /**
   * Coordinate readout "51.51°N, 0.13°W": 2-decimal absolute values with
   * hemisphere letters. Previously defined identically in app.js and
   * globe.js.
   */
  function formatCoord(lat, lng) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
  }

  /** Day length "14h 32m". Invalid or negative input -> "--". */
  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  /** Compact duration "1h 30m" / "45m 20s" / "45s". Invalid -> "--". */
  function formatCompactDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const rounded = Math.round(seconds);
    const h = Math.floor(rounded / 3600);
    const m = Math.floor((rounded % 3600) / 60);
    const s = rounded % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /** Signed compact duration "+1m 5s" / "-1m 5s" / "0s". Invalid -> "--". */
  function formatSignedDuration(seconds) {
    if (!isFinite(seconds)) return '--';
    const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : '';
    return sign + formatCompactDuration(Math.abs(seconds));
  }

  /** Degrees "23.44°" with configurable precision. Invalid -> "--". */
  function formatDegrees(value, decimals = 2) {
    if (!isFinite(value)) return '--';
    return `${value.toFixed(decimals)}°`;
  }

  /** Signed degrees "+23.44°" / "-23.44°" / "0.00°". Invalid -> "--". */
  function formatSignedDegrees(value, decimals = 2) {
    if (!isFinite(value)) return '--';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${Math.abs(value).toFixed(decimals)}°`;
  }

  /** Right ascension "14h 30m" from degrees (wrapped to [0, 360)). Invalid -> "--". */
  function formatRightAscension(degrees) {
    if (!isFinite(degrees)) return '--';
    const totalMinutes = Math.round(normalizeDegrees(degrees) / 15 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  /** Fraction as a percentage "12.3%" with configurable precision. Invalid -> "--". */
  function formatPercent(value, decimals = 1) {
    if (!isFinite(value)) return '--';
    return `${(value * 100).toFixed(decimals)}%`;
  }

  /** Number as millions "149.60M". Invalid -> "--". */
  function formatMillions(value) {
    if (!isFinite(value)) return '--';
    return `${(value / 1000000).toFixed(2)}M`;
  }

  /** Light travel time "8m 19s" (minutes, padded seconds). Invalid -> "--". */
  function formatLightTime(seconds) {
    if (!isFinite(seconds)) return '--';
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
  }

  /** Seasonal event countdown "Jun Sol in 2h" / "Jun Sol in 4d". No event -> "--". */
  function formatSeasonCountdown(event, date) {
    if (!event) return '--';
    const remaining = event.date - date;
    if (remaining <= 0) return event.name;
    const hours = Math.round(remaining / 3600000);
    if (hours < 48) return `${event.name} in ${hours}h`;
    return `${event.name} in ${Math.round(remaining / MS_PER_DAY)}d`;
  }

  /** Polar day length "24h 0m" / "0h 0m". */
  function formatPolarDayLength(isDaylight) {
    return isDaylight ? '24h 0m' : '0h 0m';
  }

  /** Short timezone abbreviation "EDT" / "BST", or "" when unavailable. */
  function getTimeZoneAbbr(timeZone, date = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : '';
    } catch (e) {
      return '';
    }
  }

  return {
    formatUtcDate,
    formatTime,
    formatCoord,
    formatDuration,
    formatCompactDuration,
    formatSignedDuration,
    formatDegrees,
    formatSignedDegrees,
    formatRightAscension,
    formatPercent,
    formatMillions,
    formatLightTime,
    formatSeasonCountdown,
    formatPolarDayLength,
    getTimeZoneAbbr
  };
}));
