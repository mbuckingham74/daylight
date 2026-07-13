const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../html/solar.js');

describe('Dynamic seasonal presets — year independence', () => {
  test('March equinox falls on Mar 19-21 for various years', () => {
    for (let year = 2000; year <= 2030; year++) {
      SM.clearSeasonEventCache();
      const events = SM.getSeasonEvents(year);
      const march = events[0];
      assert.equal(march.name, 'March equinox');
      assert.equal(march.date.getUTCMonth(), 2);
      assert.ok(march.date.getUTCDate() >= 19 && march.date.getUTCDate() <= 21,
        `${year}: March equinox on day ${march.date.getUTCDate()}`);
    }
  });

  test('June solstice falls on Jun 20-21 for various years', () => {
    for (let year = 2000; year <= 2030; year++) {
      SM.clearSeasonEventCache();
      const events = SM.getSeasonEvents(year);
      const june = events[1];
      assert.equal(june.name, 'June solstice');
      assert.equal(june.date.getUTCMonth(), 5);
      assert.ok(june.date.getUTCDate() === 20 || june.date.getUTCDate() === 21,
        `${year}: June solstice on day ${june.date.getUTCDate()}`);
    }
  });

  test('September equinox falls on Sep 22-23 for various years', () => {
    for (let year = 2000; year <= 2030; year++) {
      SM.clearSeasonEventCache();
      const events = SM.getSeasonEvents(year);
      const sept = events[2];
      assert.equal(sept.name, 'September equinox');
      assert.equal(sept.date.getUTCMonth(), 8);
      assert.ok(sept.date.getUTCDate() === 22 || sept.date.getUTCDate() === 23,
        `${year}: Sep equinox on day ${sept.date.getUTCDate()}`);
    }
  });

  test('December solstice falls on Dec 21-22 for various years', () => {
    for (let year = 2000; year <= 2030; year++) {
      SM.clearSeasonEventCache();
      const events = SM.getSeasonEvents(year);
      const dec = events[3];
      assert.equal(dec.name, 'December solstice');
      assert.equal(dec.date.getUTCMonth(), 11);
      assert.ok(dec.date.getUTCDate() === 21 || dec.date.getUTCDate() === 22,
        `${year}: Dec solstice on day ${dec.date.getUTCDate()}`);
    }
  });
});

describe('Seasonal presets — hemisphere correctness', () => {
  test('June solstice: Northern Hemisphere has longest day', () => {
    SM.clearSeasonEventCache();
    const june = SM.getSeasonEvents(2026)[1].date;
    const dec = SM.getSeasonEvents(2026)[3].date;

    // At June solstice, declination should be positive (Sun over northern hemisphere)
    // At December solstice, declination should be negative (Sun over southern hemisphere)
    const juneDec = SM.getSunEquatorial(june).delta;
    const decDec = SM.getSunEquatorial(dec).delta;
    assert.ok(juneDec > 23, `June declination should be ~+23.44, got ${juneDec}`);
    assert.ok(decDec < -23, `Dec declination should be ~-23.44, got ${decDec}`);
  });

  test('Southern Hemisphere summer at December solstice', () => {
    SM.clearSeasonEventCache();
    const dec = SM.getSeasonEvents(2026)[3].date;
    const decDec = SM.getSunEquatorial(dec).delta;
    // Sydney (lat -33.87) should have Sun high at noon near Dec solstice
    // Declination is negative, so Sun is over southern hemisphere
    assert.ok(decDec < -23, `Dec declination should be ~-23.44, got ${decDec}`);
  });
});

describe('Seasonal presets — leap year edge cases', () => {
  test('2024 (leap year) events are correct', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2024);
    assert.equal(events.length, 4);
    // Leap year doesn't change the equinox/solstice dates significantly
    assert.equal(events[0].date.getUTCMonth(), 2);
    assert.equal(events[0].date.getUTCDate(), 20);
    assert.equal(events[1].date.getUTCMonth(), 5);
    assert.equal(events[1].date.getUTCDate(), 20 || 21);
  });

  test('2000 (leap century) events are correct', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2000);
    assert.equal(events.length, 4);
    assert.equal(events[0].date.getUTCMonth(), 2);
    assert.equal(events[0].date.getUTCDate(), 20);
  });

  test('1900 (non-leap century) events are correct', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(1900);
    assert.equal(events.length, 4);
    assert.equal(events[0].date.getUTCMonth(), 2);
  });

  test('2100 (non-leap century) events are correct', () => {
    SM.clearSeasonEventCache();
    const events = SM.getSeasonEvents(2100);
    assert.equal(events.length, 4);
    assert.equal(events[0].date.getUTCMonth(), 2);
  });
});

describe('Seasonal presets — year rollover', () => {
  test('getNextSeasonEvent wraps from Dec to next year March', () => {
    SM.clearSeasonEventCache();
    const next = SM.getNextSeasonEvent(new Date('2026-12-31T23:59:00Z'));
    assert.ok(next);
    assert.equal(next.name, 'March equinox');
    assert.equal(next.date.getUTCFullYear(), 2027);
  });

  test('getNextSeasonEvent wraps from Jan to current year March', () => {
    SM.clearSeasonEventCache();
    const next = SM.getNextSeasonEvent(new Date('2026-01-01T00:00:00Z'));
    assert.ok(next);
    assert.equal(next.name, 'March equinox');
    assert.equal(next.date.getUTCFullYear(), 2026);
  });

  test('Events for consecutive years are ordered correctly', () => {
    SM.clearSeasonEventCache();
    const e2026 = SM.getSeasonEvents(2026);
    const e2027 = SM.getSeasonEvents(2027);
    assert.ok(e2027[0].date > e2026[3].date);
  });
});
