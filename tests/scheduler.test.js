const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { shouldRunHeavyUpdate } = require('../html/app-scheduler.js');

// D-02: the 1 Hz tick must not run the expensive heavy update (twilight
// tiles, SunCalc work, charts) for a static pinned instant. Live mode keeps
// its rate-limited cadence; pinned mode relies on immediate interaction
// renders and schedules no periodic heavy refresh from the tick.

const HEAVY_INTERVAL_MS = 20000;

function state(overrides = {}) {
  return Object.assign({
    isLive: false,
    nowMs: 0,
    lastHeavyUpdateMs: 0,
    heavyIntervalMs: HEAVY_INTERVAL_MS
  }, overrides);
}

describe('app scheduler — D-02 heavy-update gating', () => {
  test('live mode before the heavy interval: no heavy update', () => {
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 1000, lastHeavyUpdateMs: 0 })), false);
  });

  test('live mode at or after the heavy interval: heavy update', () => {
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 20000, lastHeavyUpdateMs: 0 })), true);
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 25000, lastHeavyUpdateMs: 1000 })), true);
  });

  test('pinned mode one second later with unchanged displayed time: no heavy update', () => {
    // The critical D-02 regression case. Under the old
    // `!isLive || elapsed >= interval` predicate this returned true.
    assert.equal(shouldRunHeavyUpdate(state({ isLive: false, nowMs: 1000, lastHeavyUpdateMs: 0 })), false);
  });

  test('pinned mode performs no periodic heavy refresh, even past the interval', () => {
    // The displayed instant is static and every explicit time change runs
    // the heavy path immediately, so tick-time recomputation is never
    // needed in pinned mode — not even at the live heavy cadence.
    assert.equal(shouldRunHeavyUpdate(state({ isLive: false, nowMs: 20000, lastHeavyUpdateMs: 0 })), false);
    assert.equal(shouldRunHeavyUpdate(state({ isLive: false, nowMs: 600000, lastHeavyUpdateMs: 0 })), false);
  });

  test('interaction-driven updates render immediately; later ticks do not repeat them', () => {
    // app.js runs updateHeavy() directly on slider/preset/picker input, so
    // the interaction renders immediately. The scheduler only gates
    // tick-time work: a pinned tick one second after the interaction must
    // not redo the static instant, and the interaction's work rate-limits
    // the live cadence afterward.
    let lastHeavyUpdateMs = 0;
    const interact = (ms) => { lastHeavyUpdateMs = ms; };

    interact(1000); // slider input -> update(currentTime()) -> heavy render
    assert.equal(shouldRunHeavyUpdate(state({ isLive: false, nowMs: 2000, lastHeavyUpdateMs })), false);

    interact(3000); // user returns to Live -> immediate heavy render
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 4000, lastHeavyUpdateMs })), false);
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 23000, lastHeavyUpdateMs })), true);
  });

  test('returning from hidden renders once; subsequent ticks stay gated', () => {
    // visibilitychange catch-up calls update() (the heavy path) once; the
    // scheduler then resumes normal gating for both modes.
    const lastHeavyUpdateMs = 5000;
    assert.equal(shouldRunHeavyUpdate(state({ isLive: false, nowMs: 6000, lastHeavyUpdateMs })), false);
    assert.equal(shouldRunHeavyUpdate(state({ isLive: false, nowMs: 7000, lastHeavyUpdateMs })), false);
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 6000, lastHeavyUpdateMs })), false);
    assert.equal(shouldRunHeavyUpdate(state({ isLive: true, nowMs: 25000, lastHeavyUpdateMs })), true);
  });
});
