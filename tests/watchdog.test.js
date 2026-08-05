const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const GlobeWatchdog = require('../html/globe-watchdog.js');

describe('isGlobeModuleLoadFailure — watchdog module-failure detection', () => {
  test('flags a failed globe.js module load', () => {
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/globe.js?v=20260805a'), true);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('https://host/path/to/globe.js'), true);
  });

  test('flags a failed Three.js vendor module load', () => {
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/vendor/three.module.min.js?v=20260805a'), true);
  });

  test('does NOT flag texture or asset loads (slow downloads are not failures)', () => {
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/assets/globe/day.jpg?v=20260804a'), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/assets/globe/night.png?v=20260804a'), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/assets/globe/clouds.png?v=20260804a'), false);
  });

  test('does NOT flag other script or stylesheet failures', () => {
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/app.js?v=20260713b'), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/globe.css?v=20260804a'), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure('http://localhost/solar.js?v=20260722a'), false);
  });

  test('rejects non-string and empty sources', () => {
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure(undefined), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure(null), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure(''), false);
    assert.equal(GlobeWatchdog.isGlobeModuleLoadFailure(42), false);
  });
});
