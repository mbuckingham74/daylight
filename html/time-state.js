/**
 * time-state.js — Canonical time/live/pinned state model for the Daylight map.
 *
 * UMD module: works in the browser (exposes window.TimeState) and in Node
 * (exports the same functions for unit testing), matching solar.js / view.js /
 * app-scheduler.js / url-state.js / format.js.
 *
 * A-04: the live-vs-pinned display instant, its pinned anchor, the slider
 * offset, and the selected seasonal-preset identity are the highest-value
 * shared state in the 2D app. Previously they were ad-hoc outer-scope
 * variables in app.js that unrelated handlers wrote and read directly.
 * TimeState is the single owner of that domain. It is a composition-root
 * state model, not a framework:
 *
 *   - owns its canonical state (isLive, pinTime, sliderOffsetHours,
 *     selectedPresetKey)
 *   - exposes explicit reads and explicit mutations
 *   - enforces simple invariants (a valid pinned instant, a finite offset,
 *     goLive() clears every artifact of pinned state)
 *   - contains no DOM access, no Leaflet access, no astronomy, no
 *     URL/history manipulation, no scheduler loop, no formatting
 *
 * app.js remains the composition root: handlers call the explicit operations
 * below and then drive the existing UI- and URL-update flow. The initial
 * selected-preset identity is derived from the URL instant by app.js (it
 * needs the seasonal-event lookup from solar.js) and injected through
 * `resolvePresetKey`; the module never touches astronomy itself.
 *
 * The effective displayed instant contract ('currentTime'):
 *
 *   - live:   a fresh instant derived from the supplied `now` (or wall clock)
 *   - pinned: pinTime + sliderOffsetHours, i.e. deterministic and independent
 *             of the wall clock
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimeState = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOUR_MS = 3600000;

  function isValidInstant(value) {
    return value instanceof Date && !isNaN(value.getTime());
  }

  function create(options) {
    const { initialTime = null, resolvePresetKey = null } = options || {};

    const hasInitialTime = isValidInstant(initialTime);
    const state = {
      isLive: !hasInitialTime,
      // The pinned anchor (already a now-snapshot in live mode, so leaving
      // live via the slider keeps the anchor the user just saw).
      pinTime: hasInitialTime
        ? new Date(initialTime.getTime())
        : new Date(),
      sliderOffsetHours: 0,
      selectedPresetKey: hasInitialTime && typeof resolvePresetKey === 'function'
        ? resolvePresetKey(new Date(initialTime.getTime())) || null
        : null
    };

    function isLive() {
      return state.isLive;
    }

    function getPinTime() {
      return new Date(state.pinTime.getTime());
    }

    function getSliderOffset() {
      return state.sliderOffsetHours;
    }

    function isSelectedPresetKey(key) {
      return state.selectedPresetKey === key;
    }

    function getCurrentTime(now) {
      if (state.isLive) {
        return now === undefined ? new Date() : new Date(now);
      }
      return new Date(state.pinTime.getTime() + state.sliderOffsetHours * HOUR_MS);
    }

    // Pin the displayed instant at `date` (a datetime-picker selection, a
    // seasonal event, or the initial URL instant). Resets the offset. The
    // preset identity is explicit user intent and is not re-derived from
    // the instant: a datetime-picker selection clears it even if the chosen
    // time happens to sit near a seasonal event.
    function pin(date, options) {
      if (!isValidInstant(date)) return false;
      const { presetKey = null } = options || {};
      state.isLive = false;
      state.pinTime = new Date(date.getTime());
      state.sliderOffsetHours = 0;
      state.selectedPresetKey = presetKey;
      return true;
    }

    // Return to live. Clears every artifact of pinned state: the offset and
    // the selected-preset identity, and re-anchors pinTime at the current
    // instant (matching the previous "manualTime = new Date()" writes).
    function goLive(now) {
      state.isLive = true;
      state.pinTime = now === undefined ? new Date() : new Date(now);
      state.sliderOffsetHours = 0;
      state.selectedPresetKey = null;
    }

    // Apply a slider offset in hours. When the app is still live, the
    // current instant becomes the pinned anchor first (so the offset is
    // measured from the moment the user grabbed the slider); preset identity
    // is cleared on that live->pinned transition only. When already pinned,
    // only the offset changes and the preset identity survives.
    function moveSlider(hours, now) {
      const offset = Number(hours);
      if (!isFinite(offset)) return false;
      if (state.isLive) {
        state.isLive = false;
        state.pinTime = now === undefined ? new Date() : new Date(now);
        state.selectedPresetKey = null;
      }
      state.sliderOffsetHours = offset;
      return true;
    }

    return {
      isLive,
      getPinTime,
      getSliderOffset,
      isSelectedPresetKey,
      getCurrentTime,
      pin,
      goLive,
      moveSlider
    };
  }

  return {
    create
  };
}));
