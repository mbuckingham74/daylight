const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const GlobeClouds = require('../html/globe-clouds.js');

// D-01 regression: the cloud fragment shader samples longitude at
// uv.x + uDrift, and uDrift grows without bound. Cloud sampling must stay
// horizontally periodic for drift values beyond one texture width (360° of
// longitude); the old ClampToEdge behavior progressively clamped an
// ever-wider longitude band to the texture's right-edge column.

const TOL = 1e-12;

describe('cloud texture wrapping — D-01', () => {
  test('cloud texture is configured with horizontal repeat wrapping (wrapS)', () => {
    const texture = {};
    const REPEAT = 'THREE.RepeatWrapping';
    GlobeClouds.configureCloudTexture(texture, REPEAT);
    assert.equal(texture.wrapS, REPEAT);
    // Only horizontal wrapping may change; wrapT must stay untouched.
    assert.equal(texture.wrapT, undefined);
  });

  test('drift stays inside [0, 1) at 0, 0.2, 1.0, and 4.0 texture widths', () => {
    for (const d of [0, 0.2, 1.0, 4.0]) {
      const w = GlobeClouds.wrapDrift(d);
      assert.ok(w >= 0 && w < 1, `wrapDrift(${d}) = ${w} must be in [0, 1)`);
    }
  });

  test('sampling at drift D equals sampling at D + 1 texture width', () => {
    for (const d of [0, 0.2, 1.0, 4.0]) {
      assert.ok(
        Math.abs(GlobeClouds.wrapDrift(d) - GlobeClouds.wrapDrift(d + 1)) < TOL,
        `drift ${d} not periodic by one texture width`
      );
    }
  });

  test('drift beyond one texture width no longer clamps to the right edge', () => {
    // Under ClampToEdge the coordinate sat at 1.0 (the right-edge column)
    // once the drift passed one width; wrapped drift returns to 0.
    assert.equal(GlobeClouds.wrapDrift(1.0), 0);
    assert.notEqual(GlobeClouds.wrapDrift(1.0), 1.0);
  });

  test('drift rate constant matches the corrected ~0.018°/s comment', () => {
    const degPerSec = GlobeClouds.CLOUD_DRIFT_PER_SECOND * 360;
    assert.ok(Math.abs(degPerSec - 0.018) < TOL, `rate ${degPerSec}°/s`);
    assert.ok(degPerSec > 0);
  });
});
