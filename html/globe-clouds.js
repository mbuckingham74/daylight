/**
 * globe-clouds.js — Cloud-layer drift and texture configuration for the
 * Daylight globe.
 *
 * UMD module: works in the browser (exposes window.GlobeClouds) and in Node
 * (exports the same functions for unit testing), matching globe-math.js.
 *
 * ── Why the cloud texture must wrap horizontally (D-01) ────────────────────
 *
 * The cloud fragment shader samples the cloud texture at
 *
 *   U = uv.x + uDrift
 *
 * and uDrift advances by CLOUD_DRIFT_PER_SECOND every second, so longitude
 * sampling drifts continuously. One texture width is 360° of longitude, so
 * the texture must repeat horizontally (wrapS = RepeatWrapping): a sample at
 * U = x + D + k must hit the same texel as U = x + D for any integer k.
 * Under Three.js's default ClampToEdgeWrapping, every sample with U > 1.0
 * is clamped to the texture's right-edge column, so as uDrift grows past
 * one width an increasingly large longitude band smears that single column
 * across the globe — a growing seam and eventually frozen, wrong cloud
 * motion. RepeatWrapping keeps sampling periodic across the antimeridian.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GlobeClouds = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Drift in texture widths per second. One width = 360° of longitude, so
  // the visual rate is 0.00005 × 360 = 0.018°/s — a full revolution about
  // every 5.6 hours. Subtle, continuous cloud motion.
  var CLOUD_DRIFT_PER_SECOND = 0.00005;

  // Configure the cloud texture's horizontal wrapping. Callers pass
  // THREE.RepeatWrapping; the mode is passed through so the texture wraps
  // across the antimeridian instead of clamping to its right edge. Vertical
  // wrapping (wrapT) is intentionally left at the default.
  function configureCloudTexture(texture, repeatWrapping) {
    texture.wrapS = repeatWrapping;
  }

  // Keep uDrift inside [0, 1) so the GPU uniform never loses float32
  // precision of the per-frame increment: an unbounded accumulator would
  // quantize and eventually freeze drift after days of continuous uptime.
  // Because the texture wraps horizontally, wrapping the drift by integer
  // texture widths changes nothing visually. Sign-safe for completeness,
  // mirroring wrapLng in globe-math.js.
  function wrapDrift(drift) {
    return ((drift % 1) + 1) % 1;
  }

  return {
    CLOUD_DRIFT_PER_SECOND: CLOUD_DRIFT_PER_SECOND,
    configureCloudTexture: configureCloudTexture,
    wrapDrift: wrapDrift
  };
}));
