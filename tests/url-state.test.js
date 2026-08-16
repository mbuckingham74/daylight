const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { serializeUrlParams } = require('../html/url-state.js');
const SM = require('../html/solar.js');

const PINNED = new Date('2026-06-21T08:24:00.000Z');

describe('url state — query serialization', () => {
  test('live mode without a shared view produces an empty query', () => {
    assert.equal(serializeUrlParams({ isLive: true, includeView: false, wrapLng: SM.wrapLng }), '');
  });

  test('pinned time without a shared view serializes only the time', () => {
    assert.equal(
      serializeUrlParams({ isLive: false, time: PINNED, includeView: false, wrapLng: SM.wrapLng }),
      'time=2026-06-21T08%3A24%3A00.000Z'
    );
  });

  test('live mode with a shared view serializes only the view', () => {
    assert.equal(
      serializeUrlParams({ isLive: true, includeView: true, lat: 20, lng: 0, zoom: 2, wrapLng: SM.wrapLng }),
      'lat=20.0000&lon=0.0000&zoom=2'
    );
  });

  test('pinned time with a shared view serializes time and view', () => {
    const query = serializeUrlParams({
      isLive: false, time: PINNED, includeView: true,
      lat: 47.60623, lng: -122.33211, zoom: 4, wrapLng: SM.wrapLng
    });
    assert.equal(
      query,
      'time=2026-06-21T08%3A24%3A00.000Z&lat=47.6062&lon=-122.3321&zoom=4'
    );
  });

  test('view longitude is wrapped to [-180, 180)', () => {
    const query = serializeUrlParams({
      isLive: false, time: PINNED, includeView: true,
      lat: 20, lng: 190, zoom: 3, wrapLng: SM.wrapLng
    });
    assert.ok(query.includes('lon=-170.0000'), query);
  });

  test('zoom is serialized verbatim', () => {
    const query = serializeUrlParams({
      isLive: false, time: PINNED, includeView: true,
      lat: 0, lng: 0, zoom: 12, wrapLng: SM.wrapLng
    });
    assert.ok(query.endsWith('zoom=12'));
  });
});
