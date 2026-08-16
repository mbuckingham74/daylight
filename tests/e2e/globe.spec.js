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
