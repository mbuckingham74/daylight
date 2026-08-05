/**
 * globe-watchdog.js — Module-failure detection for the Daylight Globe page.
 *
 * UMD module: works in the browser (exposes window.GlobeWatchdog) and in Node
 * (exports the same function for unit testing), matching solar.js / view.js /
 * globe-math.js.
 *
 * The globe.html watchdog listens for window 'error' events to catch a failed
 * module import (Three.js or globe.js itself), which aborts the module before
 * it can show its own failure state. This module deliberately does NOT cover
 * texture or other subresource failures: globe.js reports those itself (with a
 * retry action and a link to the 2D map) so that a slow-but-successful texture
 * download never produces a persistent failure panel. Keeping the discrimination
 * here makes it testable: a texture error event must never trigger the
 * module-failure panel.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GlobeWatchdog = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Markers identifying the scripts whose load failure means the globe module
  // graph cannot run at all. Texture and other asset URLs never match these.
  var MODULE_FAILURE_MARKERS = ['globe.js', 'three.module'];

  /**
   * Decide whether a window 'error' event describes a failure of the globe
   * module itself (globe.js or its vendored Three.js dependency) rather than
   * a subresource such as a globe texture.
   *
   * @param {string|undefined} src — event.target.src or event.filename
   * @returns {boolean} true only for module-level load failures
   */
  function isGlobeModuleLoadFailure(src) {
    if (typeof src !== 'string' || src.length === 0) return false;
    return MODULE_FAILURE_MARKERS.some(function (marker) {
      return src.indexOf(marker) !== -1;
    });
  }

  return {
    isGlobeModuleLoadFailure: isGlobeModuleLoadFailure
  };
}));
