const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  main,
  checkReferences,
  updateReferences,
  parseReferenceUrl,
  contentVersion
} = require('../scripts/asset-versions.js');

// D-03: every locally served immutable asset must be referenced from HTML
// with a ?v= stamp derived from its current contents. These tests drive the
// real checker/updater against throwaway fixture trees.

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-assets-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function readFixture(dir) {
  return fs.readFileSync(path.join(dir, 'html', 'index.html'), 'utf8');
}

function versionOf(dir, rel) {
  return contentVersion(path.join(dir, rel));
}

function fixtureHtml(styleRef, scriptLine = null) {
  const line = scriptLine === null ? '' : scriptLine;
  return `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="${styleRef}" />
</head>
<body>
  ${line}
</body>
</html>`;
}

function appScriptLine(dir) {
  return `<script src="app.js?v=${versionOf(dir, 'html/app.js')}"></script>`;
}

// Create asset files first, then let the html builder compute versions from
// the real files, so the fixture never hardcodes hashes.
function withFixture(assetFiles, buildHtml) {
  const dir = makeFixture(assetFiles);
  fs.writeFileSync(path.join(dir, 'html', 'index.html'), buildHtml(dir));
  return dir;
}

const STYLE_CSS = 'body { color: #123456; }';
const APP_JS = 'document.title = "daylight";';

describe('asset-versions checker — D-03', () => {
  test('correct content-derived versions pass', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/app.js': APP_JS },
      (d) => fixtureHtml('style.css?v=' + versionOf(d, 'html/style.css'), appScriptLine(d))
    );
    assert.deepEqual(checkReferences({ root: dir, htmlFiles: ['html/index.html'] }), []);
  });

  test('stale version fails and names the asset with expected and actual values', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/app.js': APP_JS },
      (d) => fixtureHtml('style.css?v=deadbeef', appScriptLine(d))
    );
    const errors = checkReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].problem, 'stale');
    assert.equal(errors[0].asset, 'style.css');
    assert.equal(errors[0].actual, 'deadbeef');
    assert.equal(errors[0].expected, versionOf(dir, 'html/style.css'));
  });

  test('missing required version fails', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/app.js': APP_JS },
      (d) => fixtureHtml('style.css', appScriptLine(d))
    );
    const errors = checkReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].problem, 'missing');
    assert.equal(errors[0].asset, 'style.css');
    assert.equal(errors[0].expected, versionOf(dir, 'html/style.css'));
  });

  test('external CDN URLs are ignored', () => {
    const dir = makeFixture({
      'html/index.html': `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-x" crossorigin="" />
  <script src="https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/tz.js"></script>
  <link rel="stylesheet" href="data:text/css,body{}" />
</head>
<body></body>
</html>`
    });
    assert.deepEqual(checkReferences({ root: dir, htmlFiles: ['html/index.html'] }), []);
  });

  test('other query parameters are preserved by the parser and the updater', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/app.js': APP_JS },
      (d) => fixtureHtml('style.css?x=1&v=deadbeef&y=2', appScriptLine(d))
    );
    const errors = checkReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].problem, 'stale');

    const updated = updateReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.deepEqual(updated, ['html/index.html']);
    const html = readFixture(dir);
    const expected = versionOf(dir, 'html/style.css');
    assert.ok(html.includes(`href="style.css?x=1&v=${expected}&y=2"`), html);
    assert.deepEqual(checkReferences({ root: dir, htmlFiles: ['html/index.html'] }), []);
  });

  test('fragments are stripped for version checks and ./ relative paths resolve', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/vendor/lib.js': APP_JS },
      (d) => fixtureHtml(
        './style.css?v=' + versionOf(d, 'html/style.css') + '#frag',
        `<script src="./vendor/lib.js?v=${versionOf(d, 'html/vendor/lib.js')}"></script>`
      )
    );
    assert.deepEqual(checkReferences({ root: dir, htmlFiles: ['html/index.html'] }), []);
    assert.deepEqual(parseReferenceUrl('#fragment-only').kind, 'ignored');
    assert.deepEqual(parseReferenceUrl('globe.html').kind, 'ignored');
  });

  test('importmap JSON values are version-checked and updatable', () => {
    const dir = makeFixture({
      'html/vendor/three.module.min.js': APP_JS,
      'html/index.html': `<!DOCTYPE html>
<html>
<body>
  <script type="importmap">
  {
    "imports": {
      "three": "./vendor/three.module.min.js?v=20260805a",
      "three/addons/": "./vendor/addons/"
    }
  }
  </script>
</body>
</html>`
    });
    const errors = checkReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].asset, './vendor/three.module.min.js');
    assert.equal(errors[0].problem, 'stale');

    updateReferences({ root: dir, htmlFiles: ['html/index.html'] });
    const html = readFixture(dir);
    const expected = versionOf(dir, 'html/vendor/three.module.min.js');
    assert.ok(html.includes(`"three": "./vendor/three.module.min.js?v=${expected}"`), html);
    assert.deepEqual(checkReferences({ root: dir, htmlFiles: ['html/index.html'] }), []);
  });

  test('non-immutable extensions and empty paths are ignored', () => {
    assert.deepEqual(parseReferenceUrl('globe.html').kind, 'ignored');
    assert.deepEqual(parseReferenceUrl('/').kind, 'ignored');
    assert.deepEqual(parseReferenceUrl('').kind, 'ignored');
    assert.deepEqual(parseReferenceUrl('#').kind, 'ignored');
    assert.deepEqual(parseReferenceUrl('mailto:x@y.z').kind, 'external');
    assert.deepEqual(parseReferenceUrl('blob:abc123').kind, 'external');
  });

  test('update mode is deterministic and check mode never mutates files', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/app.js': APP_JS },
      (d) => fixtureHtml('style.css?v=old', appScriptLine(d))
    );
    const before = readFixture(dir);
    checkReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.equal(readFixture(dir), before, 'check mode must not write');

    updateReferences({ root: dir, htmlFiles: ['html/index.html'] });
    const once = readFixture(dir);
    const second = updateReferences({ root: dir, htmlFiles: ['html/index.html'] });
    assert.deepEqual(second, [], 'second update must be a no-op');
    assert.equal(readFixture(dir), once);
    assert.deepEqual(checkReferences({ root: dir, htmlFiles: ['html/index.html'] }), []);
  });

  test('CLI mode: stale fails, --write fixes, then --check passes', () => {
    const dir = withFixture(
      { 'html/style.css': STYLE_CSS, 'html/app.js': APP_JS },
      (d) => fixtureHtml('style.css?v=deadbeef', appScriptLine(d))
    );
    const cliArgs = (extra) => ['node', 'scripts/asset-versions.js'].concat(extra).concat(['--root', dir]);
    assert.equal(main(cliArgs(['--check'])), 1, 'stale version must fail the check');
    assert.equal(main(cliArgs(['--write'])), 0, 'write mode must fix and succeed');
    const html = readFixture(dir);
    assert.ok(html.includes('style.css?v=' + versionOf(dir, 'html/style.css')), html);
    assert.equal(main(cliArgs(['--check'])), 0, 'check must pass after the update');
  });
});
