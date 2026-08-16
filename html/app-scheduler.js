/**
 * app-scheduler.js — Tick-time scheduling decisions for the Daylight map.
 *
 * UMD module: works in the browser (exposes window.AppScheduler) and in Node
 * (exports the same functions for unit testing), matching solar.js /
 * globe-math.js / globe-clouds.js.
 *
 * ── Heavy-update scheduling (D-02) ────────────────────────────────────────
 *
 * The 1 Hz tick loop runs cheap clock display work every second, but the
 * expensive path (twilight tile redraw, SunCalc work, charts) must not run
 * for a static instant. In live mode the displayed instant changes every
 * second, so heavy work is rate-limited to heavyIntervalMs. In pinned /
 * time-travel mode the displayed instant is static, and every explicit time
 * change (slider, preset, datetime picker, Live button) already runs the
 * heavy path immediately, so the tick never schedules heavy work at all —
 * recomputing identical output would be pure waste. This is the D-02
 * defect: the old `!isLive || elapsed >= interval` predicate ran the heavy
 * path on every tick in pinned mode.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AppScheduler = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Decide whether the 1 Hz tick should run the expensive update path.
  //
  //   state.isLive            — live clock vs pinned/time-travel instant
  //   state.nowMs             — current wall-clock time (ms)
  //   state.lastHeavyUpdateMs — when the heavy path last ran (ms)
  //   state.heavyIntervalMs   — live-mode rate limit (e.g. 20000)
  //
  // Returns true only in live mode once the rate limit has elapsed.
  // Pinned mode never schedules heavy work from the tick: the displayed
  // instant is static, and explicit interactions already rendered it.
  function shouldRunHeavyUpdate(state) {
    if (!state.isLive) return false;
    return state.nowMs - state.lastHeavyUpdateMs >= state.heavyIntervalMs;
  }

  return {
    shouldRunHeavyUpdate: shouldRunHeavyUpdate
  };
}));
