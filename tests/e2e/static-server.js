/**
 * static-server.js — Minimal localhost-only static server for the Playwright
 * E2E suite (T-01).
 *
 * Serves html/ exactly as the application expects: same relative URLs, query
 * strings (?v= asset stamps) ignored, real content types, and a genuine 404
 * for missing files (mirroring the nginx behavior contract).
 *
 * This is a test-only dependency: it never runs in production, binds to
 * 127.0.0.1 only, is started/stopped automatically by the Playwright
 * webServer option, and leaves no background processes behind.
 *
 * The browser suite still exercises the application's real external runtime
 * dependencies (Leaflet, SunCalc, tz-lookup CDNs and Esri tiles) over the
 * network; this server only provides the Daylight origin itself.
 *
 * Usage: node tests/e2e/static-server.js [port]   (default 4173)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const HTML_DIR = path.resolve(__dirname, '..', '..', 'html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8'
};

function resolveRequestPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  let candidate = path.normalize(path.join(HTML_DIR, decoded));
  if (candidate !== HTML_DIR && !candidate.startsWith(HTML_DIR + path.sep)) return null;
  if (candidate.endsWith(path.sep)) candidate = candidate.slice(0, -1);
  return candidate === HTML_DIR ? path.join(HTML_DIR, 'index.html') : candidate;
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://' + req.headers.host).pathname;
  } catch (e) {
    res.writeHead(400);
    res.end();
    return;
  }

  let filePath;
  try {
    filePath = resolveRequestPath(pathname);
  } catch (e) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (!filePath) {
    res.writeHead(404);
    res.end();
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
});

const port = Number(process.argv[2]) || DEFAULT_PORT;
server.listen(port, HOST, () => {
  process.stdout.write(`E2E static server on http://${HOST}:${port}\n`);
});
