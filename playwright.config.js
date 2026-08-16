/**
 * Playwright configuration for the Daylight E2E smoke suite (T-01).
 *
 * Chromium only. The application origin is served by the minimal local
 * static server (tests/e2e/static-server.js) via the webServer option —
 * started/stopped automatically, bound to 127.0.0.1, and never used in
 * production. External runtime dependencies (Leaflet, SunCalc, tz-lookup
 * CDNs and Esri tiles) are fetched by the real browser from the internet,
 * exactly as in production; the suite never waits on tile traffic.
 */
const { defineConfig } = require('@playwright/test');

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: `node tests/e2e/static-server.js ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 15000
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
