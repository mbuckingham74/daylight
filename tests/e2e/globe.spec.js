/**
 * T-01 E2E smoke suite — 3D globe application (E2E-11..E2E-13).
 *
 * The globe module exposes a read-only verification handle
 * (window.__daylightGlobe.getState()) that is already part of the production
 * page; tests use it only to observe startup/pinning state. Failure paths are
 * induced deterministically by blocking a required module over the network
 * (request interception), exercising the existing watchdog/failure card.
 */
const { test, expect } = require('@playwright/test');

const PINNED_ISO = '2026-06-21T08:24:00.000Z';
const PINNED_CLOCK = '2026-06-21 08:24:00 UTC';

const globeState = (page) =>
  page.evaluate(() => {
    const h = window.__daylightGlobe;
    return h ? h.getState() : null;
  });

async function expectGlobeStarted(page) {
  await expect
    .poll(() => globeState(page), { timeout: 15000 })
    .toEqual({ started: true, live: false, date: PINNED_ISO });
  await expect(page.locator('#globe-loading')).toBeHidden();
  await expect(page.locator('#globe-error')).toBeHidden();
  await expect(page.locator('#globe-canvas')).toBeVisible();
}

test.describe('E2E-11 — globe boots at a fixed time', () => {
  test('globe initializes with the pinned instant and populated readouts', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await expect(page.locator('#utc-time')).toHaveText(PINNED_CLOCK);
    await expect(page.locator('#sun-position')).not.toHaveText('--');
    await expect(page.locator('#live-status')).toHaveText('Paused');
  });
});

test.describe('E2E-12 — globe fixed time remains pinned', () => {
  test('pinned globe time does not advance to real time', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await expect(page.locator('#utc-time')).toHaveText(PINNED_CLOCK);

    // Span more than one 1 s clock-update interval.
    await page.waitForTimeout(3500);

    await expect(page.locator('#utc-time')).toHaveText(PINNED_CLOCK);
    const state = await globeState(page);
    expect(state).toEqual({ started: true, live: false, date: PINNED_ISO });
    await expect(page.locator('#globe-error')).toBeHidden();
  });
});

test.describe('E2E-13 — globe failure state', () => {
  test('blocked Three.js module shows the failure card with recovery actions', async ({ page }) => {
    await page.route('**/vendor/three.module.min.js*', (route) => route.abort());
    await page.goto('/globe.html');

    const errorCard = page.locator('#globe-error');
    await expect(errorCard).toBeVisible();
    await expect(page.locator('#globe-error-title')).toContainText('could not be loaded');
    await expect(page.locator('#globe-retry-btn')).toBeVisible();
    await expect(page.locator('#globe-error-map-link')).toBeVisible();
    await expect(page.locator('#globe-loading')).toBeHidden();
  });
});

test.describe('E2E-18 — X-04 globe canvas accessibility', () => {
  const cameraPosition = (page) =>
    page.evaluate(() => {
      const p = window.__daylightGlobe.getCamera().position;
      return { x: p.x, y: p.y, z: p.z };
    });

  const cameraRadius = async (page) => {
    const p = await cameraPosition(page);
    return Math.hypot(p.x, p.y, p.z);
  };

  const stopAutoRotate = (page) =>
    page.evaluate(() => {
      window.__daylightGlobe.getControls().autoRotate = false;
    });

  test('X04-1 — globe canvas has meaningful semantics with no redundant wrapper ARIA', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);

    const canvas = page.locator('#globe-canvas');
    await expect(canvas).toHaveAttribute('aria-label', 'Interactive 3D Earth globe');
    await expect(canvas).toHaveAttribute('aria-describedby', 'globe-canvas-desc');
    await expect(page.locator('#globe-canvas-desc')).toContainText('arrow keys');
    await expect(page.locator('#globe-canvas-desc')).toContainText('plus or minus');
    // The decorative wrapper must not carry ignored/overlapping ARIA.
    await expect(page.locator('#globe-scene')).not.toHaveAttribute('aria-label', /.+/);
  });

  test('X04-2 — keyboard Tab reaches the canvas only once interactive, with visible focus', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);

    // The canvas is the first element in the document: real sequential Tab
    // from the fresh page lands on it once the globe is ready.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => ({
      id: document.activeElement && document.activeElement.id,
      tabindex: document.activeElement && document.activeElement.getAttribute('tabindex')
    }));
    expect(focused).toEqual({ id: 'globe-canvas', tabindex: '0' });

    // Visible focus indication on the interactive surface.
    const focusStyle = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = window.getComputedStyle(el);
      return { focusVisible: el.matches(':focus-visible'), boxShadow: cs.boxShadow };
    });
    expect(focusStyle.focusVisible).toBe(true);
    expect(focusStyle.boxShadow).toContain('rgba(255, 216, 92');
  });

  test('X04-3 — arrow keys rotate the globe deterministically', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await stopAutoRotate(page);

    await page.locator('#globe-canvas').focus();
    const initial = await cameraPosition(page);

    await page.keyboard.press('ArrowLeft');
    const left = await cameraPosition(page);
    // 15° azimuth step at radius ~2.55 moves x by ~0.6: far beyond float noise.
    expect(Math.abs(left.x - initial.x)).toBeGreaterThan(0.1);

    await page.keyboard.press('ArrowRight');
    const right = await cameraPosition(page);
    expect(Math.abs(right.x - initial.x)).toBeLessThan(0.05);

    await page.keyboard.press('ArrowUp');
    const up = await cameraPosition(page);
    expect(initial.y - up.y).toBeGreaterThan(0.1);

    await page.keyboard.press('ArrowDown');
    const down = await cameraPosition(page);
    expect(Math.abs(down.y - initial.y)).toBeLessThan(0.05);
  });

  test('X04-4 — plus/minus zoom with deterministic steps, bounds, and no page scroll', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await stopAutoRotate(page);

    await page.locator('#globe-canvas').focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const r0 = await cameraRadius(page);

    await page.keyboard.press('+');
    const rPlus = await cameraRadius(page);
    expect(rPlus).toBeCloseTo(r0 * 0.85, 2);

    await page.keyboard.press('-');
    expect(await cameraRadius(page)).toBeCloseTo(r0, 2);

    // Bounds: repeated zoom-out clamps at MAX_CAMERA_DISTANCE (7), zoom-in
    // clamps at MIN_CAMERA_DISTANCE (1.32).
    for (let i = 0; i < 15; i++) await page.keyboard.press('-');
    expect(await cameraRadius(page)).toBeCloseTo(7, 2);
    for (let i = 0; i < 20; i++) await page.keyboard.press('+');
    expect(await cameraRadius(page)).toBeCloseTo(1.32, 2);

    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test('X04-5 — pointer drag and wheel zoom still manipulate the globe', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await stopAutoRotate(page);

    const box = await page.locator('#globe-canvas').boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const beforeDrag = await cameraPosition(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY + 60, { steps: 8 });
    await page.mouse.up();
    const afterDrag = await cameraPosition(page);
    expect(Math.abs(afterDrag.x - beforeDrag.x) + Math.abs(afterDrag.y - beforeDrag.y)).toBeGreaterThan(0.1);

    const beforeWheel = await cameraRadius(page);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(200);
    const afterWheel = await cameraRadius(page);
    expect(Math.abs(afterWheel - beforeWheel)).toBeGreaterThan(0.05);
  });

  test('X04-6 — failure removes the dead canvas from the tab order and keeps navigation usable', async ({ page }) => {
    await page.route('**/vendor/three.module.min.js*', (route) => route.abort());
    await page.goto('/globe.html');

    const errorCard = page.locator('#globe-error');
    await expect(errorCard).toBeVisible();
    await expect(page.locator('#globe-canvas')).toHaveAttribute('tabindex', '-1');

    // Real Tab navigation never lands on the failed canvas.
    let canvasReached = false;
    for (let i = 0; i < 12 && !canvasReached; i++) {
      await page.keyboard.press('Tab');
      canvasReached = await page.evaluate(() =>
        document.activeElement && document.activeElement.id === 'globe-canvas');
    }
    expect(canvasReached).toBe(false);
    expect(await page.evaluate(() => document.activeElement.id)).not.toBe('globe-canvas');

    // Recovery navigation to the 2D map remains usable.
    await page.locator('#globe-error-map-link').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.locator('#info-panel')).toBeVisible();
  });

  test('X04-6b — runtime failure (globe.js ran) also drops the dead canvas from focus', async ({ page }) => {
    // Block a classic dependency so the module imports fine but globe.js
    // detects the missing script and shows its own failure state (the
    // watchdog only matches globe.js/three.module).
    await page.route('**/solar.js*', (route) => route.abort());
    await page.goto('/globe.html');

    await expect(page.locator('#globe-error')).toBeVisible();
    await expect(page.locator('#globe-error-title')).toContainText('could not be started');
    await expect(page.locator('#globe-canvas')).toHaveAttribute('tabindex', '-1');

    let canvasReached = false;
    for (let i = 0; i < 12 && !canvasReached; i++) {
      await page.keyboard.press('Tab');
      canvasReached = await page.evaluate(() =>
        document.activeElement && document.activeElement.id === 'globe-canvas');
    }
    expect(canvasReached).toBe(false);

    await page.locator('#globe-error-map-link').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.locator('#info-panel')).toBeVisible();
  });

  test('X04-7 — canvas is not focusable while textures are still loading', async ({ page }) => {
    // Delay every globe texture so the loading state is observable. Do not
    // wait for the load event: it would wait for the delayed images too, by
    // which time the globe has already booted and hidden the loader.
    await page.route('**/assets/globe/*', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 2500));
      route.continue();
    });
    await page.goto(`/globe.html?time=${PINNED_ISO}`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#globe-loading')).toBeVisible();
    await expect(page.locator('#globe-canvas')).toHaveAttribute('tabindex', '-1');

    await expectGlobeStarted(page);
    await expect(page.locator('#globe-canvas')).toHaveAttribute('tabindex', '0');
  });
});

/**
 * UI-02 — globe default camera framing and auto-rotation.
 *
 * Tests exercise the existing read-only verification handle to observe the
 * actual scene/camera/controls state rather than screenshot pixels or
 * numeric constants. UI02-1..UI02-5 follow the UI-02 brief.
 */

async function stopAutoRotate(page) {
  await page.evaluate(() => {
    window.__daylightGlobe.getControls().autoRotate = false;
  });
}

async function cameraAzimuthRad(page) {
  return page.evaluate(() => {
    const p = window.__daylightGlobe.getCamera().position;
    return Math.atan2(p.x, p.z);
  });
}

async function projectedSphereBounds(page, radius) {
  return page.evaluate((r) => {
    const h = window.__daylightGlobe;
    const camera = h.getCamera();
    // Update the camera's projection matrix before projecting: aspect may
    // have just been updated by a resize.
    camera.updateMatrixWorld();
    return h.projectSphereNdcBounds(r);
  }, radius);
}

test.describe('UI02 — globe default camera framing and auto-rotation', () => {
  test('UI02-1 — fresh wide-desktop load shows the full Earth and atmosphere inside the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);

    const atmosphere = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getAtmosphereRadius()));
    const earth = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getEarthRadius()));

    // Full atmosphere must be inside the visible canvas (NDC bounds in [-1, 1]).
    expect(atmosphere.minX).toBeGreaterThan(-1);
    expect(atmosphere.maxX).toBeLessThan(1);
    expect(atmosphere.minY).toBeGreaterThan(-1);
    expect(atmosphere.maxY).toBeLessThan(1);

    // The atmosphere must not fill the entire viewport — preserve some
    // breathing room around the outer edge. Allow up to ~10% margin per side.
    expect(atmosphere.minX).toBeGreaterThan(-0.95);
    expect(atmosphere.maxX).toBeLessThan(0.95);
    expect(atmosphere.minY).toBeGreaterThan(-0.95);
    expect(atmosphere.maxY).toBeLessThan(0.95);

    // The full Earth must also be visible inside the canvas.
    expect(earth.minX).toBeGreaterThan(-1);
    expect(earth.maxX).toBeLessThan(1);
    expect(earth.minY).toBeGreaterThan(-1);
    expect(earth.maxY).toBeLessThan(1);
  });

  test('UI02-2 — Reset Camera restores the approved default framing after manipulation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await stopAutoRotate(page);

    // Capture the approved default framing on a fresh load.
    const defaultBounds = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getAtmosphereRadius()));

    // Move the camera via real user input: zoom in and rotate.
    await page.locator('#globe-canvas').focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('+');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');

    // Confirm the manipulation actually changed the framing, so the reset
    // assertion below is meaningful.
    const manipulated = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getAtmosphereRadius()));
    const manipulatedDifferent = ['minX', 'maxX', 'minY', 'maxY'].some(
      (k) => Math.abs(manipulated[k] - defaultBounds[k]) > 0.02
    );
    expect(manipulatedDifferent).toBe(true);

    // Reset Camera must return the atmosphere to the fresh-load framing
    // (within a small tolerance for accumulated float drift).
    await page.locator('#reset-camera-btn').click();
    await page.waitForTimeout(100);

    const afterReset = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getAtmosphereRadius()));

    for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
      expect(Math.abs(afterReset[key] - defaultBounds[key])).toBeLessThan(0.02);
    }

    // And the atmosphere must still fit inside the canvas after reset.
    expect(afterReset.minX).toBeGreaterThan(-1);
    expect(afterReset.maxX).toBeLessThan(1);
    expect(afterReset.minY).toBeGreaterThan(-1);
    expect(afterReset.maxY).toBeLessThan(1);
  });

  test('UI02-3 — auto-rotation period is in the approved ambient range', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);

    // Drive OrbitControls' auto-rotation deterministically. With the
    // deltaTime-aware update path, auto-rotation rate equals
    // (2π/60 × autoRotateSpeed) per second of simulated dt. The damping
    // (factor 0.08) means the first few update() calls under-rotate; a
    // short warmup reaches the steady-state where every call applies the
    // full auto-rotation increment, so the measured rate matches the
    // intended design constant exactly.
    const rateRadPerSec = await page.evaluate(() => {
      const h = window.__daylightGlobe;
      const controls = h.getControls();
      const camera = h.getCamera();
      controls.autoRotate = true;
      const az = () => Math.atan2(camera.position.x, camera.position.z);
      for (let i = 0; i < 60; i += 1) controls.update(0.1); // warm up damping
      const a0 = az();
      const STEPS = 30;
      for (let i = 0; i < STEPS; i += 1) controls.update(0.1);
      const a1 = az();
      let d = a1 - a0;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      return Math.abs(d) / (STEPS * 0.1);
    });
    const periodSec = (2 * Math.PI) / rateRadPerSec;

    // UI-02: ~1 revolution every 2–3 minutes (120–180 s). The rate is set
    // by autoRotateSpeed × a constant dt, so the measurement is exact and
    // the test only needs a small margin for accumulated float drift.
    expect(periodSec).toBeGreaterThanOrEqual(110);
    expect(periodSec).toBeLessThanOrEqual(190);
  });

  test('UI02-4 — keyboard interaction stops auto-rotation as before (X-04 preserved)', async ({ page }) => {
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);

    // Capture two azimuth samples while auto-rotation is on, separated by an
    // interval short enough to show the rotation is still happening.
    const moving1 = await cameraAzimuthRad(page);
    await page.waitForTimeout(500);
    const moving2 = await cameraAzimuthRad(page);
    let autoDelta = moving2 - moving1;
    if (autoDelta > Math.PI) autoDelta -= 2 * Math.PI;
    if (autoDelta < -Math.PI) autoDelta += 2 * Math.PI;
    expect(Math.abs(autoDelta)).toBeGreaterThan(0.001);

    // One representative X-04 keyboard interaction must stop auto-rotation.
    await page.locator('#globe-canvas').focus();
    await page.keyboard.press('ArrowLeft');

    const after1 = await cameraAzimuthRad(page);
    await page.waitForTimeout(1500);
    const after2 = await cameraAzimuthRad(page);
    let stoppedDelta = after2 - after1;
    if (stoppedDelta > Math.PI) stoppedDelta -= 2 * Math.PI;
    if (stoppedDelta < -Math.PI) stoppedDelta += 2 * Math.PI;
    // After a single ArrowLeft press with damping, the camera moves only a
    // fraction of the 15° step, then settles. Across 1.5 s of waiting, the
    // settled position should be stable to within a small fraction of a
    // degree. Auto-rotation (≥0.04 rad/s in the 120–180 s band) would move
    // the camera by ≥0.06 rad in 1.5 s, which we treat as a clean signal.
    expect(Math.abs(stoppedDelta)).toBeLessThan(0.05);

    // controls.autoRotate must be off after the keyboard interaction
    // (this is the same contract the X-04 handlers preserve).
    const autoRotate = await page.evaluate(() => window.__daylightGlobe.getControls().autoRotate);
    expect(autoRotate).toBe(false);
  });

  test('UI02-5 — mobile framing keeps the full atmosphere inside the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 896 });
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);

    const atmosphere = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getAtmosphereRadius()));
    const earth = await projectedSphereBounds(page, await page.evaluate(() => window.__daylightGlobe.getEarthRadius()));

    // Full atmosphere fits the narrower viewport: portrait mode is the
    // binding constraint, but the responsive default keeps it inside.
    expect(atmosphere.minX).toBeGreaterThan(-1);
    expect(atmosphere.maxX).toBeLessThan(1);
    expect(atmosphere.minY).toBeGreaterThan(-1);
    expect(atmosphere.maxY).toBeLessThan(1);

    // Full Earth fits inside the canvas on mobile too.
    expect(earth.minX).toBeGreaterThan(-1);
    expect(earth.maxX).toBeLessThan(1);
    expect(earth.minY).toBeGreaterThan(-1);
    expect(earth.maxY).toBeLessThan(1);
  });

  test('UI02-6 — user zoom (any modality) survives an ordinary resize; rotation-only does not lock the default', async ({ browser }) => {
    // Touch/pinch on the real page uses OrbitControls' pointer-event flow,
    // which synthetic PointerEvents don't drive in headless Chromium (the
    // internal setPointerCapture + pointerType path requires real browser
    // touch points). The contract under test is the one real touch zoom
    // hits: an OrbitControls-driven distance change must mark the user's
    // chosen distance as preserved across resize. This test fires the
    // same 'change' event with a real distance change so the contract is
    // exercised end-to-end without a touch-emulation dependency.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expectGlobeStarted(page);
    await stopAutoRotate(page);

    const cameraDistance = () =>
      page.evaluate(() => {
        const p = window.__daylightGlobe.getCamera().position;
        return Math.hypot(p.x, p.y, p.z);
      });

    // 1. Rotation-only pointer drag must not lock the responsive default.
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(820, 460, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(150);
    const afterResize1 = await cameraDistance();
    // The new default for the wider viewport must be applied since the
    // user never zoomed: distance should match the responsive formula
    // (not be locked to the smaller-viewport default).
    const defaultAt1600x900 = await page.evaluate(() => {
      const h = window.__daylightGlobe;
      const c = h.getCamera();
      const fovRad = c.fov * Math.PI / 180;
      const tanV = Math.tan(fovRad / 2);
      const tanH = tanV * c.aspect;
      const tanBinding = Math.min(tanV, tanH);
      return 1.09 / Math.sin(0.93 * Math.atan(tanBinding));
    });
    expect(Math.abs(afterResize1 - defaultAt1600x900)).toBeLessThan(0.05);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);

    // 2. A non-wheel, non-keyboard OrbitControls-driven distance change
    //    (the path real touch/pinch takes) must mark the user's distance
    //    so a subsequent resize preserves it instead of reverting.
    await page.evaluate(() => {
      const h = window.__daylightGlobe;
      const c = h.getCamera();
      const controls = h.getControls();
      const dir = c.position.clone().normalize();
      // Move the camera along its current direction; controls.update()
      // makes OrbitControls process the change and fire 'change'.
      c.position.copy(dir.multiplyScalar(2.0));
      controls.update();
    });
    const afterUserZoom = await cameraDistance();

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(150);
    const afterResize2 = await cameraDistance();

    // The user's 2.0 must survive the resize — without the touch/change
    // listener, the wider-viewport default (~3.5) would overwrite it.
    expect(afterUserZoom).toBeLessThan(defaultAt1600x900 - 0.5);
    expect(Math.abs(afterResize2 - afterUserZoom)).toBeLessThan(0.05);
    await ctx.close();
  });
});
