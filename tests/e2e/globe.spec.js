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
