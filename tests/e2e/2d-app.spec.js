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

test.describe('E2E-14 — Forks geolocation resolves to Forks', () => {
  test.use({ geolocation: { latitude: 47.9503, longitude: -124.3856 }, permissions: ['geolocation'] });

  test('Use My Location labels the Olympic Peninsula reference as Forks', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expectBooted(page);

    await page.locator('#my-location-btn').click();
    await expect(page.locator('#browser-location-details')).toBeVisible();
    await expect(page.locator('#browser-nearest-city')).toHaveText('Forks, WA USA');
    await expect(page.locator('#browser-location-status')).toContainText(
      'Using your browser-reported location near Forks'
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

test.describe('E2E-15 — X-01 city marker keyboard accessibility', () => {
  const cityMarker = (page, name) =>
    page.locator(`.leaflet-overlay-pane path.city-marker[aria-label="${name}"]`);

  const activeElementLabel = (page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el && el.getAttribute ? el.getAttribute('aria-label') : null;
    });

  test('X01-1 — London marker is keyboard reachable with a meaningful accessible name', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    const london = cityMarker(page, 'London');
    await expect(london).toBeVisible();

    // The marker path is a button-like control with the canonical label.
    await expect(london).toHaveAttribute('tabindex', '0');
    await expect(london).toHaveAttribute('role', 'button');
    await expect(london).toHaveAttribute('aria-label', 'London');

    // Real sequential keyboard navigation: body -> map container -> marker.
    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('map');
    await page.keyboard.press('Tab');
    await expect.poll(() => activeElementLabel(page)).toBe('London');

    // The focused marker must expose the visible focus indicator.
    const focusState = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = window.getComputedStyle(el);
      return { focusVisible: el.matches(':focus-visible'), stroke: cs.stroke, strokeWidth: cs.strokeWidth };
    });
    expect(focusState.focusVisible).toBe(true);
    expect(focusState.stroke).toBe('rgb(255, 216, 92)');
    expect(focusState.strokeWidth).toBe('4px');
  });

  test('X01-2 — Enter on the focused London marker selects the city', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await cityMarker(page, 'London').focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#location-info h2')).toHaveText('London');
    await expect(page.locator('#hover-coords')).toHaveText('51.51°N, 0.13°W');
    await expect(page.locator('#hover-local-time')).not.toHaveText(/^--|Unavailable/);
    await expect(page.locator('#hover-sunrise')).not.toHaveText('--');
    await expect(page.locator('#hover-sunset')).not.toHaveText('--');
  });

  test('X01-3 — Space on the focused London marker selects the city without scrolling', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await cityMarker(page, 'London').focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');

    await expect(page.locator('#location-info h2')).toHaveText('London');
    await expect(page.locator('#hover-coords')).toHaveText('51.51°N, 0.13°W');
    await expect(page.locator('#hover-sunrise')).not.toHaveText('--');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test('X01-4 — second marker (New York) has a unique name and activates via keyboard', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(cityMarker(page, 'New York')).toHaveAttribute('aria-label', 'New York');

    // Tab from the focused London marker reaches New York in canonical order.
    await cityMarker(page, 'London').focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => activeElementLabel(page)).toBe('New York');
    await page.keyboard.press('Enter');

    await expect(page.locator('#location-info h2')).toHaveText('New York');
    await expect(page.locator('#hover-coords')).toHaveText('40.71°N, 74.01°W');
    await expect(page.locator('#hover-sunrise')).not.toHaveText('--');
  });

  test('X01-5 — all 15 city markers are button-like controls in canonical order', async ({ page }) => {
    const { markerCities } = require('../../html/cities.js');
    const expectedLabels = markerCities.map(city => city.markerName || city.name);
    expect(expectedLabels).toHaveLength(15);

    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(page.locator('.leaflet-overlay-pane path.city-marker')).toHaveCount(15);
    await expect(page.locator('.leaflet-overlay-pane path.city-marker[role="button"]')).toHaveCount(15);
    await expect(page.locator('.leaflet-overlay-pane path.city-marker[tabindex="0"]')).toHaveCount(15);

    const actualLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.leaflet-overlay-pane path.city-marker'))
        .map(path => path.getAttribute('aria-label'))
    );
    expect(actualLabels).toEqual(expectedLabels);
  });
});

test.describe('E2E-16 — X-02 mobile bottom-sheet keyboard accessibility', () => {
  // The app's mobile bottom sheet is active at the existing <=480px breakpoint.
  test.use({ viewport: { width: 390, height: 844 } });

  const handle = (page) => page.locator('#panel-handle');

  test('X02-1 — pointer tap still cycles the bottom sheet', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(handle(page)).toBeVisible();
    await expect(page.locator('#info-panel')).toHaveClass(/half/);

    await handle(page).click();
    await expect(page.locator('#info-panel')).toHaveClass(/full/);
    await handle(page).click();
    await expect(page.locator('#info-panel')).toHaveClass(/collapsed/);
    await handle(page).click();
    await expect(page.locator('#info-panel')).toHaveClass(/half/);
  });

  test('X02-2 — handle is keyboard reachable with a meaningful accessible name', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(handle(page)).toBeVisible();

    // Native button semantics with a truthful initial state (half).
    await expect(handle(page)).toHaveAttribute('type', 'button');
    await expect(handle(page)).toHaveAttribute('aria-controls', 'info-panel');
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(handle(page)).toHaveAttribute('aria-label', 'Enlarge information panel');

    // Real sequential Tab navigation must reach the handle (fresh page load:
    // map container -> 15 city markers -> zoom controls -> handle).
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() =>
        document.activeElement && document.activeElement.id === 'panel-handle');
    }
    expect(reached).toBe(true);
  });

  test('X02-3 — Enter on the focused handle advances the sheet', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await handle(page).focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#info-panel')).toHaveClass(/full/);
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('panel-handle');
  });

  test('X02-4 — Space on the focused handle advances exactly one state without scrolling', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await handle(page).focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');

    await expect(page.locator('#info-panel')).toHaveClass(/full/);
    // Exactly one advance: the next state is full, not collapsed.
    await expect(page.locator('#info-panel')).not.toHaveClass(/collapsed/);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test('X02-5 — accessible state stays truthful across the full cycle', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    const expectState = async (stateClass, expanded, label) => {
      await expect(page.locator('#info-panel')).toHaveClass(new RegExp(`\\b${stateClass}\\b`));
      await expect(handle(page)).toHaveAttribute('aria-expanded', expanded);
      await expect(handle(page)).toHaveAttribute('aria-label', label);
    };

    await expectState('half', 'true', 'Enlarge information panel');
    await handle(page).focus();
    await page.keyboard.press('Enter');
    await expectState('full', 'true', 'Collapse information panel');
    await page.keyboard.press('Enter');
    await expectState('collapsed', 'false', 'Expand information panel');
    await page.keyboard.press('Enter');
    await expectState('half', 'true', 'Enlarge information panel');
  });
});

test.describe('E2E-16 — X-02 desktop hidden behavior', () => {
  test('X02-6 — desktop keeps the sheet handle hidden and out of the tab order', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await expect(page.locator('#panel-handle')).toBeHidden();

    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() =>
        document.activeElement && document.activeElement.id === 'panel-handle');
    }
    expect(reached).toBe(false);
  });
});

test.describe('E2E-17 — X-03 view-mode accessibility state', () => {
  // The 2D map and 3D globe are separate documents (/ and globe.html)
  // cross-navigated by links, so inert is not applicable between views:
  // X-03 here is truthful current-page state on the navigation links plus
  // regression protection that hidden in-document content is never
  // keyboard-reachable on either view.

  test('X03-1 — the current 2D view is exposed truthfully on initial load', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);

    // The home link points at the current page: marked as current.
    await expect(page.locator('#home-link')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#home-link')).toHaveAttribute('href', '/');
    // The 3D destination link is an ordinary navigation link: no false state.
    await expect(page.locator('#globe-link')).not.toHaveAttribute('aria-current', /.+/);
    await expect(page.locator('#globe-link')).not.toHaveAttribute('aria-pressed', /.+/);
    // Exactly one current-page claim on the 2D view — never ambiguous.
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('X03-2 — switching to the 3D view clears the 2D current-page claim', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await page.locator('#globe-link').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/globe\.html/);

    // On the globe page every link points away from the current page, so
    // none may claim to be current.
    await expect(page.locator('#map-link')).not.toHaveAttribute('aria-current', /.+/);
    await expect(page.locator('#home-link')).not.toHaveAttribute('aria-current', /.+/);
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  });

  test('X03-3 — keyboard activation of the view link keeps focus valid', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);

    // Real sequential Tab navigation reaches the 3D Globe link.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() =>
        document.activeElement && document.activeElement.id === 'globe-link');
    }
    expect(reached).toBe(true);

    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/globe\.html/);

    // Cross-document navigation: focus resets to the document body, never
    // inside hidden/inactive content.
    const focusInfo = await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      insideHidden: !!(document.activeElement.closest && document.activeElement.closest('[hidden]'))
    }));
    expect(focusInfo.tag).toBe('BODY');
    expect(focusInfo.insideHidden).toBe(false);
  });

  test('X03-4 — hidden in-document content is never keyboard reachable on either view', async ({ page }) => {
    const walkForbidden = async (selector) => {
      let hit = false;
      for (let i = 0; i < 50 && !hit; i++) {
        await page.keyboard.press('Tab');
        hit = await page.evaluate((sel) => {
          const el = document.activeElement;
          return !!(el && el.closest && el.closest(sel));
        }, selector);
      }
      return hit;
    };

    // 2D view: the inactive tab panel is hidden (display:none) and must
    // never receive focus.
    await page.goto(`/?time=${PINNED_ISO}`);
    await page.locator('#solar-tab').click();
    await expect(page.locator('#map-page')).toBeHidden();
    expect(await walkForbidden('#map-page')).toBe(false);
    await page.locator('#map-tab').click();
    await expect(page.locator('#solar-page')).toBeHidden();
    expect(await walkForbidden('#solar-page')).toBe(false);

    // 3D view: error card and loading overlay are hidden (display:none)
    // and must never receive focus.
    await page.goto(`/globe.html?time=${PINNED_ISO}`);
    await expect(page.locator('#globe-error')).toBeHidden();
    await expect(page.locator('#globe-loading')).toBeHidden();
    expect(await walkForbidden('#globe-error')).toBe(false);
    expect(await walkForbidden('#globe-loading')).toBe(false);
  });

  test('X03-5 — returning to the 2D view restores the current-page state', async ({ page }) => {
    await page.goto(`/?time=${PINNED_ISO}`);
    await page.locator('#globe-link').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/globe\.html/);
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);

    await page.locator('#map-link').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.locator('#home-link')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  });
});

test.describe('E2E-18 — UI-01 global map framing', () => {
  // Reads the production page's read-only Leaflet verification handle
  // (window.__daylightMap) to assert geographic framing — center, bounds,
  // unobscured safe-area width, and the coverage floor — rather than an
  // exact zoom constant, matching the __daylightGlobe pattern in
  // globe.spec.js.
  const mapState = (page) =>
    page.evaluate(() => {
      const h = window.__daylightMap;
      const bounds = h.getBounds();
      return {
        zoom: h.getView().zoom,
        center: h.getView().center,
        minZoom: h.getMinZoom(),
        containerWidth: h.getContainerSize().x,
        safeAreaWidth: h.getSafeAreaWidth(),
        worldWidth: 256 * Math.pow(2, h.getMinZoom()),
        containerSpan: bounds.east - bounds.west,
        safeAreaSpan: 360 * h.getSafeAreaWidth() / (256 * Math.pow(2, h.getMinZoom()))
      };
    });

  // The product contract concerns the unobscured visible map area, not the
  // full Leaflet container. The safe area may be up to ~1.5x the world width
  // before the duplicate geography becomes substantial, so the framing check
  // is on the safe area.
  const expectSafeAreaFraming = async (page) => {
    const s = await mapState(page);
    expect(s.zoom).toBe(s.minZoom);
    // No substantial duplicate in the safe area: safe area can be at most
    // 1.5x the world width.
    expect(s.safeAreaWidth).toBeLessThanOrEqual(s.worldWidth * 1.5);
    // Recognizable global overview in the safe area: at least 90° of the
    // world visible (i.e., 25% of the globe).
    expect(s.safeAreaSpan).toBeGreaterThan(90);
  };

  test.describe('wide desktop', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('UI01-1 — fresh wide-desktop load frames a single recognizable world around the panel', async ({ page }) => {
      await page.goto('/');
      await expectBooted(page);
      await expectSafeAreaFraming(page);
      const s = await mapState(page);
      // 1920×1080 keeps zoom 3 (safe area 1584 > 1.5× world at zoom 2).
      expect(s.minZoom).toBe(3);
      expect(s.zoom).toBe(3);

      // Composition: the framed geographic center occupies the unobstructed
      // area right of the persistent left control panel, not hidden behind it.
      const c = await page.evaluate(() => {
        const h = window.__daylightMap;
        const p = h.toContainerPoint(20, 0);
        const safe = h.getSafeAreaCenter();
        return { x: p.x, safeX: safe.x, containerWidth: h.getContainerSize().x };
      });
      expect(c.x).toBeGreaterThan(c.containerWidth * 0.25);
      expect(Math.abs(c.x - c.safeX)).toBeLessThan(2);
    });

    test('UI01-2 — zooming out stops at the coverage floor before the multi-world span', async ({ page }) => {
      await page.goto('/');
      await expectBooted(page);

      // Zoom well in first over the open map (wheel), then scroll back out
      // hard; the map must floor at its coverage zoom, never return to the
      // duplicate-world state.
      await page.mouse.move(1200, 540);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, -500);
      }
      await page.waitForTimeout(400);
      const zoomedIn = await mapState(page);
      expect(zoomedIn.zoom).toBeGreaterThan(zoomedIn.minZoom);

      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 500);
      }

      await expectSafeAreaFraming(page);
    });

    test('UI01-3 — Reset View restores the new global framing', async ({ page }) => {
      await page.goto(`/?time=${PINNED_ISO}`);
      await expectBooted(page);
      await expectSafeAreaFraming(page);
      const initial = await mapState(page);

      // Perturb away from the overview: wheel-zoom in over the open map,
      // then drag the view.
      await page.mouse.move(1400, 500);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, -500);
      }
      await page.waitForTimeout(400);
      await page.mouse.down();
      await page.mouse.move(800, 500, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const perturbed = await mapState(page);
      expect(perturbed.zoom).toBeGreaterThan(initial.zoom);
      expect(Math.abs(perturbed.center.lng - initial.center.lng)).toBeGreaterThan(1);

      await page.locator('#reset-view-btn').click();

      await expect(async () => {
        const s = await mapState(page);
        expect(s.zoom).toBe(s.minZoom);
        expect(Math.abs(s.center.lat - initial.center.lat)).toBeLessThan(0.5);
        expect(Math.abs(s.center.lng - initial.center.lng)).toBeLessThan(0.5);
      }).toPass({ timeout: 10000 });
      await expectSafeAreaFraming(page);

      // Reset also clears the shared view params from the pinned address bar.
      await expect(page).not.toHaveURL(/lat=|lon=|zoom=/);
      await expect(page).toHaveURL(/time=/);
    });

    test('UI01-4 — an explicit shared map view is restored untouched', async ({ page }) => {
      await page.goto(`/?time=${PINNED_ISO}&lat=47.6062&lon=-122.3321&zoom=4`);
      await expectBooted(page);
      const s = await mapState(page);
      expect(s.zoom).toBe(4);
      expect(s.center.lat).toBeCloseTo(47.6062, 1);
      expect(s.center.lng).toBeCloseTo(-122.3321, 1);
      // The explicit view is honored even though the coverage floor is lower.
      expect(s.worldWidth).toBeGreaterThanOrEqual(s.containerWidth);
    });
  });

  test.describe('intermediate desktop', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test('UI01-5 — 1366 desktop keeps the safe area free of substantial duplicate', async ({ page }) => {
      await page.goto('/');
      await expectBooted(page);
      const s = await mapState(page);
      // 1366 safe area is 1030 (~1.006x world at zoom 2): zoom 2 stays.
      expect(s.minZoom).toBe(2);
      expect(s.zoom).toBe(2);
      await expectSafeAreaFraming(page);
      // Ordinary east/west wrapping preserved: the visible longitude span
      // is bounded by the safe area, not the (wider) container.
      expect(s.safeAreaSpan).toBeLessThan(360 * 1.5);
    });
  });

  test.describe('small laptop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('UI01-6 — 1280 laptop keeps the safe area free of substantial duplicate', async ({ page }) => {
      await page.goto('/');
      await expectBooted(page);
      const s = await mapState(page);
      // 1280 safe area is 944 (< 1024 = world at zoom 2): zoom 2 fits.
      expect(s.minZoom).toBe(2);
      expect(s.zoom).toBe(2);
      await expectSafeAreaFraming(page);
      expect(s.safeAreaSpan).toBeLessThan(360);
    });
  });

  test.describe('mobile bottom sheet', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('UI01-7 — mobile keeps its existing sane framing', async ({ page }) => {
      await page.goto('/');
      await expectBooted(page);

      await expect(async () => {
        const s = await mapState(page);
        expect(s.zoom).toBe(2);
      }).toPass({ timeout: 10000 });
      await expectSafeAreaFraming(page);
      const s = await mapState(page);
      expect(s.minZoom).toBe(2);
      // The bottom sheet does not obstruct the horizontal safe area.
      expect(s.safeAreaWidth).toBe(s.containerWidth);

      // Reset View preserves the same mobile framing and clear view params.
      await page.locator('#reset-view-btn').click();
      await expect(async () => {
        const r = await mapState(page);
        expect(r.zoom).toBe(2);
      }).toPass({ timeout: 10000 });
      const r = await mapState(page);
      expect(r.containerSpan).toBeGreaterThan(90);
      expect(r.containerSpan).toBeLessThan(360);
      await expect(page).not.toHaveURL(/lat=|lon=|zoom=/);
    });
  });
});
