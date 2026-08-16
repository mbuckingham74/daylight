#!/usr/bin/env node
/**
 * asset-versions.js — D-03 cache-version contract checker/updater.
 *
 * nginx serves .js/.css/.svg/.ico/.png/.jpg/.jpeg/.webp with
 * `Cache-Control: public, max-age=31536000, immutable`, so every locally
 * served asset of those types must be referenced from HTML with a `?v=`
 * stamp derived from the file contents. Manually invented date stamps have
 * drifted from file contents before (D-03), leaving returning visitors with
 * stale assets for up to a year.
 *
 * This script recomputes the expected stamp as a short SHA-256 prefix of the
 * current file contents and fails when a reference is missing or stale, so
 * an asset change can no longer ship without its version bump.
 *
 *   node scripts/asset-versions.js --check   # CI-safe: read-only, exit 1 on drift
 *   node scripts/asset-versions.js --write   # explicit, deterministic rewrite
 *
 * References are read from href/src attributes and from
 * <script type="importmap"> JSON. External (CDN) URLs, data:/mailto:/blob:
 * URLs, fragments, and non-immutable extensions (html, etc.) are ignored.
 * Paths are resolved relative to the referencing HTML file, with a leading
 * "/" treated as site-root-relative.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION_LENGTH = 8;
const VERSION_PARAM = 'v';
const IMMUTABLE_EXTENSIONS = new Set(['.js', '.css', '.svg', '.ico', '.png', '.jpg', '.jpeg', '.webp']);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function htmlFilesIn(root) {
  const htmlDir = path.join(root, 'html');
  return fs.readdirSync(htmlDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => 'html/' + name)
    .sort();
}

function contentVersion(filePath) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return hash.slice(0, VERSION_LENGTH);
}

function extractReferences(htmlText) {
  const refs = [];
  const attrRe = /\b(href|src)\s*=\s*(["'])([^"']+)\2/g;
  let m;
  while ((m = attrRe.exec(htmlText)) !== null) {
    refs.push({ name: m[1], quote: m[2], url: m[3] });
  }
  const importMapRe = /<script[^>]*\btype\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = importMapRe.exec(htmlText)) !== null) {
    let map;
    try {
      map = JSON.parse(m[1]);
    } catch (e) {
      continue;
    }
    if (!map || typeof map.imports !== 'object') continue;
    for (const target of Object.values(map.imports)) {
      if (typeof target === 'string') refs.push({ name: null, quote: '"', url: target });
    }
  }
  return refs;
}

function parseReferenceUrl(url) {
  const hashIndex = url.indexOf('#');
  const withoutFragment = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(withoutFragment)) return { kind: 'external' };
  const qIndex = withoutFragment.indexOf('?');
  const pathPart = qIndex === -1 ? withoutFragment : withoutFragment.slice(0, qIndex);
  const query = qIndex === -1 ? '' : withoutFragment.slice(qIndex + 1);
  if (pathPart === '') return { kind: 'ignored' };
  const ext = path.extname(pathPart).toLowerCase();
  if (!IMMUTABLE_EXTENSIONS.has(ext)) return { kind: 'ignored' };
  return { kind: 'immutable', pathPart, query, fragment };
}

function getVersion(query) {
  for (const part of query.split('&')) {
    if (part === VERSION_PARAM) return '';
    if (part.startsWith(VERSION_PARAM + '=')) return part.slice(2);
  }
  return null;
}

function setVersion(query, value) {
  const parts = query.split('&');
  let found = false;
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === VERSION_PARAM || parts[i].startsWith(VERSION_PARAM + '=')) {
      parts[i] = VERSION_PARAM + '=' + value;
      found = true;
    }
  }
  if (!found) parts.push(VERSION_PARAM + '=' + value);
  return parts.filter((part) => part !== '').join('&');
}

function resolveAssetPath(htmlPath, pathPart) {
  const rel = pathPart.replace(/^\/+/, '');
  return path.resolve(path.dirname(htmlPath), rel);
}

function checkReferences({ root, htmlFiles }) {
  const errors = [];
  for (const relHtml of htmlFiles) {
    const htmlPath = path.join(root, relHtml);
    const refs = extractReferences(fs.readFileSync(htmlPath, 'utf8'));
    for (const ref of refs) {
      const parsed = parseReferenceUrl(ref.url);
      if (parsed.kind !== 'immutable') continue;
      const assetPath = resolveAssetPath(htmlPath, parsed.pathPart);
      if (!fs.existsSync(assetPath)) {
        errors.push({ htmlFile: relHtml, asset: parsed.pathPart, expected: null, actual: null, problem: 'file-missing' });
        continue;
      }
      const expected = contentVersion(assetPath);
      const actual = getVersion(parsed.query);
      if (actual === null) {
        errors.push({ htmlFile: relHtml, asset: parsed.pathPart, expected, actual: null, problem: 'missing' });
      } else if (actual !== expected) {
        errors.push({ htmlFile: relHtml, asset: parsed.pathPart, expected, actual, problem: 'stale' });
      }
    }
  }
  return errors;
}

function updateReferences({ root, htmlFiles }) {
  const updated = [];
  for (const relHtml of htmlFiles) {
    const htmlPath = path.join(root, relHtml);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const replacements = [];
    for (const ref of extractReferences(html)) {
      const parsed = parseReferenceUrl(ref.url);
      if (parsed.kind !== 'immutable') continue;
      const assetPath = resolveAssetPath(htmlPath, parsed.pathPart);
      if (!fs.existsSync(assetPath)) continue;
      const newUrl = parsed.pathPart + '?' + setVersion(parsed.query, contentVersion(assetPath)) + parsed.fragment;
      const oldRaw = (ref.name === null ? '' : ref.name + '=') + ref.quote + ref.url + ref.quote;
      const newRaw = (ref.name === null ? '' : ref.name + '=') + ref.quote + newUrl + ref.quote;
      if (oldRaw !== newRaw) replacements.push([oldRaw, newRaw]);
    }
    let out = html;
    for (const [oldRaw, newRaw] of replacements) out = out.split(oldRaw).join(newRaw);
    if (out !== html) {
      fs.writeFileSync(htmlPath, out);
      updated.push(relHtml);
    }
  }
  return updated;
}

function formatError(e) {
  if (e.problem === 'missing') return `${e.htmlFile}: ${e.asset}: missing ?v= (expected ${e.expected})`;
  if (e.problem === 'file-missing') return `${e.htmlFile}: ${e.asset}: referenced asset file not found`;
  return `${e.htmlFile}: ${e.asset}: stale ?v=${e.actual} (expected ${e.expected})`;
}

function main(argv) {
  const args = argv.slice(2);
  const mode = args.includes('--write') ? 'write' : 'check';
  const rootIndex = args.indexOf('--root');
  const root = (rootIndex !== -1 && args[rootIndex + 1]) ? path.resolve(args[rootIndex + 1]) : DEFAULT_ROOT;
  const htmlFiles = htmlFilesIn(root);
  const errors = checkReferences({ root, htmlFiles });

  if (mode === 'write') {
    for (const e of errors) console.error(`note: ${formatError(e)}`);
    const updated = updateReferences({ root, htmlFiles });
    for (const f of updated) console.log(`updated: ${f}`);
    const remaining = checkReferences({ root, htmlFiles });
    if (remaining.length > 0) {
      for (const e of remaining) console.error(`error: ${formatError(e)}`);
      return 1;
    }
    console.log('asset version stamps are now current');
    return 0;
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`error: ${formatError(e)}`);
    return 1;
  }
  console.log('all local immutable asset references have current content versions');
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = {
  VERSION_LENGTH,
  main,
  checkReferences,
  updateReferences,
  extractReferences,
  parseReferenceUrl,
  contentVersion,
  getVersion,
  setVersion,
  htmlFilesIn
};
