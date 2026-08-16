#!/usr/bin/env bash
# Regression tests for deploy.sh control flow.
#
# Protects against N-01: the staging precondition previously required the
# live deployment directory to not exist, so every deployment after the first
# aborted. These tests run the real deploy.sh against a sandbox with
# ssh/rsync/git/docker/npx mocked to execute the remote commands locally.
#
# Protects the Foxguard pre-deployment gate: the gate must run locally,
# before the first remote mutation, and fail closed. The mocked ssh/rsync
# exit 99 if invoked before the mocked npx has run, mechanically proving the
# ordering; the mocked npx records the exact gate command and honors a
# configurable exit status (pass / violation / cannot-execute).
#
# Scenarios covered:
#   1. First deployment (no live directory) succeeds with Foxguard passing.
#   2. Repeat deployment (live directory exists) succeeds and replaces it.
#   3. Staged Compose validation failure leaves the live deployment intact.
#   4. A stale staging directory fails clearly and is cleaned up.
#   5. Foxguard reports a violation: deploy exits non-zero, zero mutation.
#   6. Foxguard cannot execute: deploy fails closed, zero mutation.
#   7. A dirty worktree is refused before Foxguard runs.
#
# Usage: bash tests/deploy.test.sh   (run from anywhere)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/daylight-deploy-test.XXXXXX")"
trap 'rm -rf -- "${SANDBOX}"' EXIT

BIN="${SANDBOX}/bin"
LIVE_PARENT="${SANDBOX}/deployments"
mkdir -p "${BIN}" "${LIVE_PARENT}"

cat >"${BIN}/npx" <<'EOF'
#!/usr/bin/env bash
# Mock foxguard via npx. Records the invocation, then exits with the status
# chosen by the test: 0 = pass, 1 = finding/violation, 127 = cannot execute.
echo "$*" >"${FOXGUARD_LOG}"
exit "${FOXGUARD_EXIT:-0}"
EOF

cat >"${BIN}/ssh" <<'EOF'
#!/usr/bin/env bash
# Simulate the remote host: execute the remote command locally so the
# deployment control flow can be tested without a VPS. stdin (heredocs) is
# preserved for the "bash -s" invocation.
#
# Ordering guard: no remote command may run before the Foxguard gate, so if
# npx has not logged an invocation yet, abort with 99 (which fails the
# deploy under set -e). This mechanically proves the gate precedes every
# ssh/rsync/docker mutation.
[[ -f "${FOXGUARD_LOG}" ]] || { echo "ordering violation: ssh before foxguard" >&2; exit 99; }
echo "$*" >>"${SSH_LOG}"
exec bash -c "${*:2}"
EOF

cat >"${BIN}/rsync" <<'EOF'
#!/usr/bin/env bash
# Simulate rsync over ssh: copy the source files into the (local) target.
set -euo pipefail
[[ -f "${FOXGUARD_LOG}" ]] || { echo "ordering violation: rsync before foxguard" >&2; exit 99; }
echo "$*" >>"${RSYNC_LOG}"
args=("$@")
target="${args[${#args[@]}-1]}"
target="${target#*:}"
mkdir -p "${target}"
for src in "${args[@]:0:${#args[@]}-1}"; do
  [[ "${src}" == -* ]] && continue
  cp -R "${src}" "${target}"
done
EOF

cat >"${BIN}/git" <<'EOF'
#!/usr/bin/env bash
# Always-clean worktree with a deterministic commit for stable staging names,
# unless DIRTY_GIT=1 simulates uncommitted changes.
case "${1:-}" in
  status)
    if [[ "${DIRTY_GIT:-0}" == "1" ]]; then
      printf 'M deploy.sh\n'
    fi
    exit 0 ;;
  rev-parse) printf '%s\n' 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' ;;
  *) exit 0 ;;
esac
EOF

cat >"${BIN}/docker" <<'EOF'
#!/usr/bin/env bash
# Minimal docker-compose simulation for deploy.sh control-flow tests.
set -euo pipefail
[[ -f "${FOXGUARD_LOG}" ]] || { echo "ordering violation: docker before foxguard" >&2; exit 99; }
echo "$*" >>"${DOCKER_LOG}"
joined="$*"
if [[ "${FAIL_VALIDATION:-0}" == "1" ]] && [[ "${joined}" == *"config --quiet"* ]]; then
  echo "simulated: docker compose config failed" >&2
  exit 1
fi
case "${joined}" in
  *"config --quiet"*) exit 0 ;;
  *"config --images"*) printf '%s\n' 'nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752' ;;
  *"image inspect"*) exit 0 ;;
  *"up -d"*) touch "${UP_MARKER:-/tmp/daylight-up-marker}" ; exit 0 ;;
  *) exit 0 ;;
esac
EOF

chmod +x "${BIN}"/*

export SERVER="test@host"
export REMOTE_DIR="${LIVE_PARENT}/daylight"
export FAIL_VALIDATION=0
export UP_MARKER="${SANDBOX}/up-ran"
export FOXGUARD_EXIT=0
export FOXGUARD_LOG="${SANDBOX}/foxguard-ran"
export SSH_LOG="${SANDBOX}/ssh-log"
export RSYNC_LOG="${SANDBOX}/rsync-log"
export DOCKER_LOG="${SANDBOX}/docker-log"
export DIRTY_GIT=0

run_deploy() {
  (cd "${ROOT}" && PATH="${BIN}:${PATH}" bash deploy.sh)
}

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_exists() { [[ -e "$1" ]] || fail "expected '$1' to exist"; }
assert_missing() { [[ ! -e "$1" ]] || fail "expected '$1' to be absent"; }
assert_gate_ran() {
  assert_exists "${FOXGUARD_LOG}"
  grep -q -- "--baseline foxguard-baseline.json" "${FOXGUARD_LOG}" \
    || fail "foxguard gate must use the baseline invocation"
}

STAGING_DIR="${LIVE_PARENT}/.daylight-stage-deadbeefdead"

echo "== Scenario 1: first deployment (no live directory) succeeds, gate first"
run_deploy
assert_gate_ran
assert_exists "${REMOTE_DIR}/docker-compose.yml"
assert_exists "${REMOTE_DIR}/nginx.conf"
assert_exists "${REMOTE_DIR}/html/index.html"
assert_exists "${REMOTE_DIR}/.deployment.json"
grep -q '"source_commit": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"' "${REMOTE_DIR}/.deployment.json" \
  || fail "deployment.json missing source_commit"
grep -q '"compose_sha256"' "${REMOTE_DIR}/.deployment.json" \
  || fail "deployment.json missing compose_sha256"
grep -q '"deployed_at"' "${REMOTE_DIR}/.deployment.json" \
  || fail "deployment.json missing deployed_at"
assert_exists "${UP_MARKER}"
# The ssh/rsync/docker mocks exit 99 if invoked before the gate, so reaching
# this point with a completed deployment proves the gate ran first.
assert_exists "${SSH_LOG}"
rm -f "${UP_MARKER}"

echo "== Scenario 2: repeat deployment (live directory exists) replaces it"
touch "${REMOTE_DIR}/html/STALE-MARKER"
run_deploy
assert_missing "${REMOTE_DIR}/html/STALE-MARKER"
assert_exists "${REMOTE_DIR}/html/index.html"
assert_exists "${REMOTE_DIR}/.deployment.json"
assert_exists "${UP_MARKER}"
assert_missing "${REMOTE_DIR}.old"
assert_missing "${STAGING_DIR}"
rm -f "${UP_MARKER}"

echo "== Scenario 3: validation failure leaves the live deployment intact"
touch "${REMOTE_DIR}/html/SURVIVOR-MARKER"
FAIL_VALIDATION=1
if run_deploy; then fail "deploy should have failed with validation error"; fi
FAIL_VALIDATION=0
assert_exists "${REMOTE_DIR}/html/SURVIVOR-MARKER"
assert_exists "${REMOTE_DIR}/html/index.html"
assert_missing "${REMOTE_DIR}.old"
assert_missing "${STAGING_DIR}"
[[ ! -e "${UP_MARKER}" ]] || fail "up -d must not run after validation failure"

echo "== Scenario 4: stale staging directory fails clearly and is cleaned up"
mkdir -p "${STAGING_DIR}"
if run_deploy 2>"${SANDBOX}/err.txt"; then fail "deploy should have refused"; fi
grep -q "already exists" "${SANDBOX}/err.txt" || fail "expected a clear stale-staging message"
assert_missing "${STAGING_DIR}"
assert_exists "${REMOTE_DIR}/html/index.html"

echo "== Scenario 5: Foxguard violation aborts with zero remote mutation"
rm -f "${FOXGUARD_LOG}" "${SSH_LOG}" "${RSYNC_LOG}" "${DOCKER_LOG}"
touch "${REMOTE_DIR}/html/SENTINEL-MARKER"
FOXGUARD_EXIT=1
if run_deploy 2>"${SANDBOX}/err-fox.txt"; then fail "deploy must fail when Foxguard reports a violation"; fi
FOXGUARD_EXIT=0
grep -q "Foxguard pre-deployment gate FAILED" "${SANDBOX}/err-fox.txt" \
  || fail "expected a clear Foxguard-gate failure message"
assert_exists "${FOXGUARD_LOG}"
assert_missing "${SSH_LOG}"
assert_missing "${RSYNC_LOG}"
assert_missing "${DOCKER_LOG}"
assert_missing "${STAGING_DIR}"
assert_exists "${REMOTE_DIR}/html/SENTINEL-MARKER"
[[ ! -e "${UP_MARKER}" ]] || fail "up -d must not run after a failed Foxguard gate"

echo "== Scenario 6: Foxguard cannot execute, deployment fails closed"
rm -f "${FOXGUARD_LOG}" "${SSH_LOG}" "${RSYNC_LOG}" "${DOCKER_LOG}"
FOXGUARD_EXIT=127
if run_deploy 2>"${SANDBOX}/err-fgx.txt"; then fail "deploy must fail closed when Foxguard cannot run"; fi
FOXGUARD_EXIT=0
grep -q "Foxguard pre-deployment gate FAILED" "${SANDBOX}/err-fgx.txt" \
  || fail "expected a clear Foxguard-gate failure message"
assert_missing "${SSH_LOG}"
assert_missing "${RSYNC_LOG}"
assert_missing "${DOCKER_LOG}"
assert_missing "${STAGING_DIR}"
assert_exists "${REMOTE_DIR}/html/SENTINEL-MARKER"

echo "== Scenario 7: dirty worktree refused, Foxguard never runs"
rm -f "${FOXGUARD_LOG}" "${SSH_LOG}" "${RSYNC_LOG}" "${DOCKER_LOG}"
DIRTY_GIT=1
if run_deploy 2>"${SANDBOX}/err-dirty.txt"; then fail "deploy must refuse a dirty worktree"; fi
DIRTY_GIT=0
grep -q "Refusing to deploy a dirty worktree" "${SANDBOX}/err-dirty.txt" \
  || fail "expected a dirty-worktree refusal message"
assert_missing "${FOXGUARD_LOG}"
assert_missing "${SSH_LOG}"
assert_missing "${STAGING_DIR}"
assert_exists "${REMOTE_DIR}/html/SENTINEL-MARKER"

echo "== Contract: pinned digest and --pull never preserved"
grep -q "sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752" "${ROOT}/docker-compose.yml" \
  || fail "pinned nginx digest changed"
grep -q -- "--pull never" "${ROOT}/deploy.sh" || fail "deploy.sh must keep --pull never"

echo "== All deploy control-flow tests passed"
