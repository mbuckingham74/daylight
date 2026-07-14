const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const View = require('../html/view.js');

describe('Map safe-area positioning', () => {
  test('uses the map center without an obstruction', () => {
    assert.deepEqual(View.getSafeAreaCenter({ x: 1200, y: 800 }, null), { x: 600, y: 400 });
  });

  test('centers within the area to the right of a desktop panel', () => {
    const center = View.getSafeAreaCenter(
      { x: 1200, y: 800 },
      { left: 16, top: 16, right: 336, bottom: 784, width: 320, height: 768 }
    );
    assert.deepEqual(center, { x: 776, y: 400 });
  });

  test('centers above a mobile bottom sheet', () => {
    const center = View.getSafeAreaCenter(
      { x: 390, y: 844 },
      { left: 0, top: 422, right: 390, bottom: 844, width: 390, height: 422 }
    );
    assert.deepEqual(center, { x: 195, y: 203 });
  });

  test('centers in the narrow safe area above a full mobile sheet', () => {
    const center = View.getSafeAreaCenter(
      { x: 390, y: 844 },
      { left: 0, top: 126, right: 390, bottom: 844, width: 390, height: 718 }
    );
    assert.deepEqual(center, { x: 195, y: 55 });
  });

  test('computes the projected map-center offset for a safe point', () => {
    assert.deepEqual(
      View.getMapCenterOffset({ x: 1200, y: 800 }, { x: 776, y: 400 }),
      { x: -176, y: 0 }
    );
  });

  test('keeps a point on the nearest world copy across the antimeridian', () => {
    assert.equal(View.getNearestWorldLongitude(179, -241), -181);
    assert.equal(View.getNearestWorldLongitude(-179, 241), 181);
    assert.equal(View.getNearestWorldLongitude(120, 0), 120);
  });
});

describe('Sun label placement', () => {
  const size = { x: 1200, y: 800 };

  test('flips to the left near the right edge', () => {
    assert.deepEqual(View.getEdgeAwareLabelPlacement({ x: 1160, y: 400 }, size), {
      direction: 'left', offset: [-10, 0]
    });
  });

  test('stays to the right in the safe interior', () => {
    assert.deepEqual(View.getEdgeAwareLabelPlacement({ x: 600, y: 400 }, size), {
      direction: 'right', offset: [10, 0]
    });
  });
});
