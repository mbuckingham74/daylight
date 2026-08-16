#!/usr/bin/env bash
# Regression test for D-06: nginx add_header inheritance.
#
# Under nginx inheritance semantics, a location that declares its own
# add_header directive does NOT inherit server-scope add_header directives.
# The immutable-asset regex location declares its own
# `add_header Cache-Control ...`, so before D-06 was fixed, asset responses
# silently lost the server-level security headers that index.html/globe.html
# re-declared for themselves.
#
# This test launches the exact pinned nginx image from docker-compose.yml
# with the real nginx.conf and asserts actual HTTP response headers:
#   scenario 1: HTML responses keep security headers + "no-cache" (no immutable)
#   scenario 2: JS assets keep security headers + one-year immutable cache
#   scenario 3: CSS assets keep security headers + one-year immutable cache
#   scenario 4: SVG/PNG image assets keep security headers + immutable cache
#   scenario 5: `nginx -t` passes with the pinned image and current config
#
# A static drift guard (which runs without Docker) additionally asserts the
# canonical security-header set is declared in all four add_header scopes:
# server, = /index.html, = /globe.html, and the immutable-asset regex.
#
# Usage: bash tests/nginx-headers.test.sh   (run from anywhere)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_CONF="${ROOT}/nginx.conf"
HTML_DIR="${ROOT}/html"

IMAGE="$(sed -n 's/^[[:space:]]*image:[[:space:]]*//p' "${ROOT}/docker-compose.yml" | head -1)"
[[ -n "${IMAGE}" ]] || { echo "FAIL: could not extract image reference from docker-compose.yml" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "  ok: $*"; }

echo "== Static drift guard: canonical security headers in all add_header scopes"
# The complete set must appear 4 times: server scope + the three locations
# that each declare their own add_header (index.html, globe.html, assets).
for name in \
  'add_header X-Frame-Options' \
  'add_header X-Content-Type-Options' \
  'add_header Referrer-Policy' \
  'add_header X-XSS-Protection' \
  'add_header Permissions-Policy' \
  'add_header Content-Security-Policy-Report-Only'; do
  n="$(grep -c -- "${name}" "${NGINX_CONF}" || true)"
  [[ "${n}" -eq 4 ]] || fail "expected 4 declarations of '${name}' in nginx.conf, found ${n}"
done
ok "canonical header set declared at server scope and in all 3 add_header locations"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "SKIP: docker unavailable — static drift guard ran; HTTP header checks skipped"
  exit 0
fi

CONTAINER="daylight-nginx-headers-test"
cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== Scenario 5: nginx -t with pinned image ${IMAGE}"
docker run --rm \
  -v "${HTML_DIR}:/usr/share/nginx/html:ro" \
  -v "${NGINX_CONF}:/etc/nginx/conf.d/default.conf:ro" \
  "${IMAGE}" nginx -t
ok "nginx configuration is valid"

echo "== Serving real responses with pinned image"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER}" -p 127.0.0.1::80 \
  -v "${HTML_DIR}:/usr/share/nginx/html:ro" \
  -v "${NGINX_CONF}:/etc/nginx/conf.d/default.conf:ro" \
  "${IMAGE}" >/dev/null
PORT="$(docker port "${CONTAINER}" 80 | head -1 | grep -oE '127\.0\.0\.1:[0-9]+' | head -1 | cut -d: -f2)"
[[ -n "${PORT}" ]] || fail "could not determine the mapped container port"

for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || fail "nginx did not become ready"
ok "nginx serving on 127.0.0.1:${PORT}"

# Every request URL is built here from the mapped local port and literal
# resource paths — curl is invoked only with those regular variables, never
# with a shell parameter (keeps these real HTTP checks free of
# bash/taint-ssrf / CWE-918). Fetching is inlined below so no positional
# parameter flows into a curl URL.
BASE_URL="http://127.0.0.1:${PORT}"
HTML_URLS=("${BASE_URL}/" "${BASE_URL}/index.html" "${BASE_URL}/globe.html")
ASSET_URLS=("${BASE_URL}/app.js" "${BASE_URL}/style.css" "${BASE_URL}/favicon.svg" "${BASE_URL}/assets/globe/clouds.png")

CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://server.arcgisonline.com https://*.arcgisonline.com; connect-src 'self' https://server.arcgisonline.com https://*.arcgisonline.com; font-src 'self'; worker-src 'self' blob:; report-uri /csp-report"

SECURITY_HEADERS=(
  "X-Frame-Options:SAMEORIGIN"
  "X-Content-Type-Options:nosniff"
  "Referrer-Policy:strict-origin-when-cross-origin"
  "X-XSS-Protection:1; mode=block"
  "Permissions-Policy:camera=(), microphone=(), geolocation=(self), interest-cohort=()"
  "Content-Security-Policy-Report-Only:${CSP}"
)

assert_header_in() { # response-text name expected-value
  local h="$1" name="$2" expected="$3"
  local found
  found="$(printf '%s\n' "${h}" | grep -i "^${name}:" | head -1 | sed 's/^[^:]*:[[:space:]]*//' || true)"
  [[ "${found}" == "${expected}" ]] \
    || fail "expected header '${name}: ${expected}', got '${found:-<missing>}'"
}

assert_single_header_in() { # response-text name
  local h="$1" name="$2"
  local n
  n="$(printf '%s\n' "${h}" | grep -ic "^${name}:" || true)"
  [[ "${n}" -eq 1 ]] || fail "expected exactly one '${name}' header, found ${n}"
}

check_security_headers_in() { # response-text
  local h="$1" pair name
  for pair in "${SECURITY_HEADERS[@]}"; do
    name="${pair%%:*}"
    assert_header_in "${h}" "${name}" "${pair#*:}"
  done
}

check_html_response() { # response-text
  local h="$1"
  assert_single_header_in "${h}" "Cache-Control"
  assert_header_in "${h}" "Cache-Control" "no-cache"
  check_security_headers_in "${h}"
}

check_immutable_asset_response() { # response-text
  local h="$1"
  assert_single_header_in "${h}" "Cache-Control"
  assert_header_in "${h}" "Cache-Control" "public, max-age=31536000, immutable"
  check_security_headers_in "${h}"
}

echo "== Scenario 1: HTML responses"
for url in "${HTML_URLS[@]}"; do
  h="$(curl -fsSI --max-time 5 "${url}" | tr -d '\r')"
  check_html_response "${h}"
  ok "${url#${BASE_URL}}: security headers present, Cache-Control: no-cache"
done

echo "== Scenario 2: JavaScript asset"
check_immutable_asset_response "$(curl -fsSI --max-time 5 "${ASSET_URLS[0]}" | tr -d '\r')"
ok "/app.js: security headers present, Cache-Control: public, max-age=31536000, immutable"

echo "== Scenario 3: CSS asset"
check_immutable_asset_response "$(curl -fsSI --max-time 5 "${ASSET_URLS[1]}" | tr -d '\r')"
ok "/style.css: security headers present, Cache-Control: public, max-age=31536000, immutable"

echo "== Scenario 4: SVG and image assets"
for url in "${ASSET_URLS[@]:2}"; do
  check_immutable_asset_response "$(curl -fsSI --max-time 5 "${url}" | tr -d '\r')"
  ok "${url#${BASE_URL}}: security headers present, Cache-Control: public, max-age=31536000, immutable"
done

echo "== All nginx header tests passed"
