/**
 * T-01 E2E smoke suite — 2D map application (E2E-01..E2E-10).
 *
 * These tests exercise the real browser application wiring (DOM, Leaflet,
 * SunCalc, application state, URL/history, geolocation, share, dependency
 * failure) against the actual html/ origin served by tests/e2e/static-server.js.
 *
 * External runtime dependencies (Leaflet, SunCalc, tz-lookup CDNs and Esri
 * tile traffic) are fetched by the real browser exactly as in production;
 * no test waits on tile requests. Readiness is detected through stable DOM
 * state (populated UTC readout, missing failure banner), never through
 * fixed sleeps.
 */
const { test, expect } = require('@playwright/test');
const SM = require('../../html/solar.js');

// Deterministic pinned instant used across the suite (near the June solstice).
const PINNED_ISO = '2026-06-21T08:24:00.000Z';
const PINNED_CLOCK = '2026-06-21 08:24:00 UTC';

const utcClock = (page) => page.locator('#utc-time');
const sunPosition = (page) => page.locator('#sun-position');
const liveBtn = (page) => page.locator('#live-btn');
const sliderValue = (page) => page.locator('#time-slider-value');

async function expectBooted(page) {
  await expect(utcClock(page)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
  await expect(sunPosition(page)).not.toHaveText('--');
  await expect(page.locator('.loading-error')).toHaveCount(0);
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
}

test.describe('E2E-01 — 2D application boots', () => {
  test('loads the map with populated readouts and no failure banner', async ({ page }) => {
    await page.goto('/');
    await expectBooted(page);
    await expect(liveBtn(page)).toHaveClass(/active/);
    await expect(sliderValue(page)).toHaveText('Live');
  });
});

test.describe('E2E-02 — deterministic pinned permalink', () => {
  test('shows the pinned instant and does not advance it', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(utcClock(page)).toHaveText(PINNED_CLOCK);
    await expect(liveBtn(page)).not.toHaveClass(/active/);
    await expect(sliderValue(page)).not.toHaveText('Live');
    // More than one clock-update interval later the pinned time must not
    // drift to real time.
    await page.waitForTimeout(3000);
    await expect(utcClock(page)).toHaveText(PINNED_CLOCK);
  });
});

test.describe('E2E-03 — time interaction and return to Live', () => {
  test('slider shifts the pinned instant, Live returns to real time', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(utcClock(page)).toHaveText(PINNED_CLOCK);

    await page.locator('#time-slider').fill('3');
    await expect(utcClock(page)).toHaveText('2026-06-21 11:24:00 UTC');
    await expect(page.locator('#time-slider')).toHaveAttribute('aria-valuetext', /\+3\.0 hours from anchor/);

    await liveBtn(page).click();
    await expect(liveBtn(page)).toHaveClass(/active/);
    await expect(sliderValue(page)).toHaveText('Live');
    // The live clock leaves the pinned instant within a tick or two.
    await expect
      .poll(() => utcClock(page).textContent(), { timeout: 5000 })
      .not.toBe(PINNED_CLOCK);
  });
});

test.describe('E2E-04 — seasonal preset interaction', () => {
  test('preset click selects the event of the active year and pins it', async ({ page }) => {
    const juneSolstice = SM.getSeasonEvents(2026)[1].date.toISOString();
    const expectedClock = `${juneSolstice.slice(0, 10)} ${juneSolstice.slice(11, 19)} UTC`;

    await page.goto(`/?time=${PINNED_ISO}`);
    await page.locator('[data-preset="jun-solstice"]').click();

    await expect(page.locator('[data-preset="jun-solstice"]')).toHaveClass(/active/);
    await expect(utcClock(page)).toHaveText(expectedClock);
    await expect(liveBtn(page)).not.toHaveClass(/active/);
    await expect(page).toHaveURL(/time=2026-06-2/);
  });
});

test.describe('E2E-05 — permalink state round-trip', () => {
  test('view/time state survives a fresh load of the app-written URL', async ({ page, browser }) => {
    await page.goto(`/?time=${PINNED_ISO}&lat=47.6062&lon=-122.3321&zoom=4`);
    await expect(utcClock(page)).toHaveText(PINNED_CLOCK);
    await expect(page).toHaveURL(/time=2026-06-21T08:24:00\.000Z/);

    const roundTripUrl = page.url();
    const fresh = await browser.newPage();
    await fresh.goto(roundTripUrl);
    await expect(utcClock(fresh)).toHaveText(PINNED_CLOCK);
    await expect.poll(() => fresh.url()).toContain('lat=47.6062');
    await expect(fresh.locator('.loading-error')).toHaveCount(0);
    await fresh.close();
  });
});

test.describe('E2E-06 — city selection through Leaflet', () => {
  test('clicking the London marker populates the map-point readouts', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);

    const tooltip = page.locator('.city-label', { hasText: 'London' });
    await expect(tooltip).toBeVisible();
    const box = await tooltip.boundingBox();
    // The tooltip renders above the marker (offset [0,-6]). Click the marker
    // path whose center is nearest the tooltip's bottom edge — that is the
    // London circleMarker (radius 4 px is too small to click blindly).
    const target = await page.evaluate((tooltipBox) => {
      const anchorX = tooltipBox.x + tooltipBox.width / 2;
      const anchorY = tooltipBox.y + tooltipBox.height + 6;
      let best = null;
      let bestDist = Infinity;
      for (const p of document.querySelectorAll('.leaflet-overlay-pane path')) {
        const r = p.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const d = Math.hypot(cx - anchorX, cy - anchorY);
        if (d < bestDist) {
          bestDist = d;
          best = { x: cx, y: cy };
        }
      }
      return best;
    }, box);
    await page.mouse.click(target.x, target.y);

    await expect(page.locator('#hover-coords')).toHaveText('51.51°N, 0.13°W');
    await expect(page.locator('#hover-local-time')).not.toHaveText(/^--|Unavailable/);
    await expect(page.locator('#hover-sunrise')).not.toHaveText('--');
    await expect(page.locator('#hover-sunset')).not.toHaveText('--');
  });
});

test.describe('E2E-07 — geolocation success path', () => {
  test.use({ geolocation: { latitude: 47.6062, longitude: -122.3321 }, permissions: ['geolocation'] });

  test('Use My Location populates the browser-location card', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expectBooted(page);

    // Geolocation must not be requested before the button is used.
    await expect(page.locator('#browser-location-details')).toBeHidden();

    await page.locator('#my-location-btn').click();
    await expect(page.locator('#browser-location-details')).toBeVisible();
    await expect(page.locator('#browser-nearest-city')).toHaveText('Seattle, WA USA');
    await expect(page.locator('#browser-sunrise')).not.toHaveText('--');
    await expect(page.locator('#browser-sunset')).not.toHaveText('--');
    await expect(page.locator('#browser-location-status')).toContainText(
      'Using your browser-reported location near Seattle'
    );
    await expect(page.locator('.loading-error')).toHaveCount(0);
  });
});

test.describe('E2E-08 — geolocation denial path', () => {
  test('denied geolocation shows inline feedback and stays usable', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expectBooted(page);

    await page.locator('#my-location-btn').click();
    await expect(page.locator('#browser-location-status')).toContainText('Permission denied');
    await expect(page.locator('#browser-location-details')).toBeHidden();
    await expect(page.locator('#map.leaflet-container')).toBeVisible();
    await expect(utcClock(page)).toHaveText(PINNED_CLOCK);
    await expect
      .poll(() => page.locator('#my-location-btn').textContent(), { timeout: 5000 })
      .toBe('Use My Location');
  });
});

test.describe('E2E-09 — share URL generation', () => {
  test('Share produces the canonical pinned URL through the clipboard fallback', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      window.__capturedShareUrl = '';
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (text) => {
            window.__capturedShareUrl = text;
            return Promise.resolve();
          }
        },
        configurable: true
      });
    });

    await page.goto(`/?time=${PINNED_ISO}`);
    await page.locator('#share-btn').click();

    // The clipboard fallback receives the canonical share URL; the params are
    // URLSearchParams-encoded (colons percent-escaped), so parse them back.
    await expect
      .poll(() =>
        page.evaluate((expectedIso) => {
          const captured = window.__capturedShareUrl;
          if (!captured) return false;
          const params = new URL(captured).searchParams;
          return (
            params.get('time') === expectedIso &&
            params.get('lat') !== null &&
            params.get('lon') !== null &&
            params.get('zoom') !== null
          );
        }, PINNED_ISO)
      )
      .toBe(true);
  });
});

test.describe('E2E-10 — 2D dependency failure state', () => {
  test('blocked Leaflet CDN shows the failure banner with a reload action', async ({ page }) => {
    await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', (route) => route.abort());
    await page.goto('/');

    const banner = page.locator('.loading-error');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Leaflet (map library) could not be loaded');
    await expect(banner.locator('button', { hasText: 'Reload page' })).toBeVisible();
  });
});
