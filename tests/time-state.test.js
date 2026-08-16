const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../html/time-state.js');

// A-04: focused transition characterization for the time/live/pinned state
// extracted from app.js into TimeState. These tests lock the externally
// meaningful transition semantics (live/pinned, slider, preset, datetime
// picker, goLive) and the effective-instant contract — never private field
// layout. Wall-clock reads are avoided by injecting an explicit `now` into
// every pure decision.

const PINNED = new Date('2026-06-21T08:24:05.289Z'); // 2026 June solstice
const PINNED_KEY = 'jun-solstice';
const OTHER = new Date('2025-03-20T14:38:17.849Z'); // 2025 March equinox
const OTHER_KEY = 'mar-equinox';
const NOW = new Date('2099-01-01T00:00:00.000Z');

// Only the exact PINNED instant resolves to its seasonal-preset key — the
// way app.js's findPresetKeyForDate behaves (within 1h of a seasonal event).
const resolvePresetKey = (date) => {
  if (Math.abs(date.getTime() - PINNED.getTime()) < 3600000) return PINNED_KEY;
  return null;
};

describe('time state — initial state', () => {
  test('no URL time: live, zero offset, no selected preset', () => {
    const ts = create({});
    assert.equal(ts.isLive(), true);
    assert.equal(ts.getCurrentTime(NOW).getTime(), NOW.getTime());
    assert.equal(ts.getSliderOffset(), 0);
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), false);
  });

  test('URL time: pinned at that instant with the resolved preset key', () => {
    const ts = create({ initialTime: PINNED, resolvePresetKey });
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getCurrentTime(NOW).getTime(), PINNED.getTime());
    assert.equal(ts.getPinTime().getTime(), PINNED.getTime());
    assert.equal(ts.getSliderOffset(), 0);
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), true);
  });

  test('URL time away from any seasonal event: pinned with no preset', () => {
    const ts = create({ initialTime: NOW, resolvePresetKey });
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getCurrentTime().getTime(), NOW.getTime());
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), false);
  });

  test('missing or malformed initial time coalesces to live (URL parsing upstream)', () => {
    assert.equal(create({}).isLive(), true);
    assert.equal(create({ initialTime: null }).isLive(), true);
    assert.equal(create({ initialTime: new Date('bogus') }).isLive(), true);
  });
});

describe('time state — pin (datetime picker)', () => {
  test('pin() pins the instant and clears offset and preset identity', () => {
    const ts = create({ initialTime: PINNED, resolvePresetKey });
    ts.pin(NOW);
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getCurrentTime().getTime(), NOW.getTime());
    assert.equal(ts.getPinTime().getTime(), NOW.getTime());
    assert.equal(ts.getSliderOffset(), 0);
    // The picker clears preset intent even if the instant sits near an event.
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), false);
  });

  test('pin() with a presetKey selects that preset and pins the event instant', () => {
    const ts = create({});
    assert.equal(ts.pin(OTHER, { presetKey: OTHER_KEY }), true);
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getCurrentTime().getTime(), OTHER.getTime());
    assert.equal(ts.isSelectedPresetKey(OTHER_KEY), true);
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), false);
    assert.equal(ts.getSliderOffset(), 0);
  });

  test('pin() with an invalid date is rejected without changing state', () => {
    const ts = create({});
    assert.equal(ts.pin(new Date('bogus')), false);
    assert.equal(ts.isLive(), true);
    assert.equal(ts.getSliderOffset(), 0);
  });
});

describe('time state — slider', () => {
  test('moveSlider from live freezes the anchor at now, then applies the offset', () => {
    const ts = create({});
    ts.moveSlider(3, NOW);
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getPinTime().getTime(), NOW.getTime());
    assert.equal(ts.getSliderOffset(), 3);
    assert.equal(ts.getCurrentTime(NOW).getTime(), NOW.getTime() + 3 * 3600000);
  });

  test('moveSlider while already pinned changes only the offset; preset identity survives', () => {
    const ts = create({ initialTime: PINNED, resolvePresetKey });
    ts.moveSlider(1.5);
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getPinTime().getTime(), PINNED.getTime());
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), true);
    assert.equal(ts.getCurrentTime().getTime(), PINNED.getTime() + 1.5 * 3600000);
  });

  test('sliding back to 0 restores the exact anchor instant and re-activates the preset', () => {
    const ts = create({ initialTime: PINNED, resolvePresetKey });
    ts.moveSlider(-2);
    assert.equal(ts.getCurrentTime().getTime(), PINNED.getTime() - 2 * 3600000);
    ts.moveSlider(0);
    assert.equal(ts.getCurrentTime().getTime(), PINNED.getTime());
    assert.equal(ts.getSliderOffset(), 0);
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), true);
  });

  test('moveSlider from live enters pinned mode without auto-selecting a preset', () => {
    // The frozen anchor happens to land exactly on a seasonal event instant;
    // preset identity is user intent (app-side), never derived from the time,
    // so no preset becomes active.
    const ts = create({});
    ts.moveSlider(0.5, PINNED);
    assert.equal(ts.isLive(), false);
    assert.equal(ts.getPinTime().getTime(), PINNED.getTime());
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), false);
  });

  test('moveSlider rejects non-finite offsets', () => {
    const ts = create({});
    assert.equal(ts.moveSlider(NaN), false);
    assert.equal(ts.moveSlider(Infinity), false);
    assert.equal(ts.getSliderOffset(), 0);
    assert.equal(ts.isLive(), true);
  });
});

describe('time state — return to Live', () => {
  test('goLive clears pin time, offset, and both preset identities', () => {
    const ts = create({ initialTime: PINNED, resolvePresetKey });
    ts.moveSlider(3);
    ts.pin(OTHER, { presetKey: OTHER_KEY });
    ts.goLive(NOW);
    assert.equal(ts.isLive(), true);
    assert.equal(ts.getSliderOffset(), 0);
    assert.equal(ts.isSelectedPresetKey(PINNED_KEY), false);
    assert.equal(ts.isSelectedPresetKey(OTHER_KEY), false);
    assert.equal(ts.getCurrentTime(NOW).getTime(), NOW.getTime());
  });

  test('goLive re-anchors pinTime at the current instant', () => {
    const ts = create({ initialTime: PINNED, resolvePresetKey });
    const anchored = new Date('2026-06-21T08:24:05.289Z');
    ts.goLive(anchored);
    // The anchored pinTime is what a later slider-from-live uses as its base.
    ts.moveSlider(2, anchored);
    assert.equal(ts.getCurrentTime().getTime(), anchored.getTime() + 2 * 3600000);
  });
});

describe('time state — effective current time', () => {
  test('live effective time derives from the supplied now, deterministically', () => {
    const ts = create({});
    assert.equal(ts.getCurrentTime(new Date('2026-01-01T00:00:00.000Z')).getTime(), Date.UTC(2026, 0, 1));
    assert.equal(ts.getCurrentTime(NOW).getTime(), NOW.getTime());
  });

  test('pinned effective time is deterministic and ignores the wall clock', () => {
    const ts = create({ initialTime: PINNED });
    assert.equal(ts.getCurrentTime(NOW).getTime(), PINNED.getTime());
    assert.equal(ts.getCurrentTime(new Date('1999-12-31T23:59:59.000Z')).getTime(), PINNED.getTime());
  });

  test('getCurrentTime returns fresh Date instances, not a shared reference', () => {
    const ts = create({ initialTime: PINNED });
    const a = ts.getCurrentTime(NOW);
    const b = ts.getCurrentTime(NOW);
    assert.notEqual(a, b);
    assert.equal(a.getTime(), b.getTime());
    assert.equal(a.getTime(), PINNED.getTime());
  });
});
