#!/usr/bin/env bash
set -euo pipefail

# ForksTech daylight deployment. The pinned nginx image digest is defined in
# docker-compose.yml; deployment uses --pull never so the running image
# identity is never silently changed, and the image must already be present
# on the host (checked before the live directory is replaced).

SERVER="${SERVER:-michael@100.120.233.4}"
REMOTE_DIR="${REMOTE_DIR:-/home/michael/deployments/daylight}"
SOURCE_REPOSITORY="https://github.com/mbuckingham74/daylight.git"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy a dirty worktree." >&2
  exit 1
fi

SOURCE_COMMIT="$(git rev-parse HEAD)"
STAGING_DIR="$(dirname "${REMOTE_DIR}")/.daylight-stage-${SOURCE_COMMIT:0:12}"
BACKUP_DIR="${REMOTE_DIR}.old"

# Mandatory Foxguard pre-deployment gate. Runs locally against the committed
# repository; nothing on the remote host is touched until Foxguard passes.
# A scan violation, or Foxguard itself failing to run (missing tool, network,
# malformed baseline), aborts deployment before any remote mutation. There is
# no bypass.
if ! npx foxguard --baseline foxguard-baseline.json .; then
  echo "Foxguard pre-deployment gate FAILED. Deployment aborted; no remote changes were made." >&2
  exit 1
fi

cleanup() {
  # If a replacement was interrupted (backup exists but no live directory),
  # restore the previous deployment before doing anything else.
  ssh "${SERVER}" "test ! -d '${BACKUP_DIR}' || test -e '${REMOTE_DIR}' || mv -- '${BACKUP_DIR}' '${REMOTE_DIR}'" || true
  # Remove this deployment's staging directory. This also self-heals a stale
  # staging directory left by a crashed run of the same commit: the failing
  # precondition below reports it, and the next re-run proceeds.
  ssh "${SERVER}" "test ! -d '${STAGING_DIR}' || rm -rf -- '${STAGING_DIR}'" || true
}
trap cleanup EXIT

echo "Deploying Daylight Map to forkstech.com..."

# Stage the committed artifact without disturbing the live container. A
# staging directory for this commit already existing means a previous run
# crashed before finishing; fail clearly here (cleanup above removes it on
# exit, so simply re-running is the recovery path).
ssh "${SERVER}" "if test -e '${STAGING_DIR}'; then echo 'Staging directory ${STAGING_DIR} already exists (previous deployment may have crashed). Re-run deploy.sh to retry after cleanup.' >&2; exit 1; fi; install -d -m 0700 '${STAGING_DIR}/html'"

# Sync source files into the staging directory (never over the live install).
rsync -avz \
  "${PWD}/docker-compose.yml" \
  "${PWD}/nginx.conf" \
  "${SERVER}:${STAGING_DIR}/"

rsync -avz \
  "${PWD}/html/" \
  "${SERVER}:${STAGING_DIR}/html/"

COMPOSE_SHA256="$(shasum -a 256 docker-compose.yml | awk '{print $1}')"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Write deployment metadata, validate the staged Compose model, verify the
# pinned image is provisioned, and only then atomically replace the installed
# deployment: the live directory is renamed aside (BACKUP_DIR) and the
# validated staging directory takes its place. If anything fails before the
# swap completes, cleanup() restores the previous deployment.
ssh "${SERVER}" \
  "STAGING_DIR='${STAGING_DIR}' REMOTE_DIR='${REMOTE_DIR}' SOURCE_COMMIT='${SOURCE_COMMIT}' SOURCE_REPOSITORY='${SOURCE_REPOSITORY}' COMPOSE_SHA256='${COMPOSE_SHA256}' DEPLOYED_AT='${DEPLOYED_AT}' bash -s" <<'REMOTE'
set -euo pipefail
cat >"${STAGING_DIR}/.deployment.json" <<JSON
{
  "service": "daylight",
  "source_repository": "${SOURCE_REPOSITORY}",
  "source_commit": "${SOURCE_COMMIT}",
  "deployed_at": "${DEPLOYED_AT}",
  "compose_sha256": "${COMPOSE_SHA256}"
}
JSON
chmod 0644 "${STAGING_DIR}/.deployment.json"
docker compose -p daylight -f "${STAGING_DIR}/docker-compose.yml" config --quiet

# The pinned image must already exist on the host: --pull never never
# downloads. Detect absence and explain instead of failing cryptically later.
PINNED_IMAGE="$(docker compose -p daylight -f "${STAGING_DIR}/docker-compose.yml" config --images | sed -n '1p')"
if ! docker image inspect "${PINNED_IMAGE}" >/dev/null 2>&1; then
  echo "Pinned image ${PINNED_IMAGE} is not present on the host." >&2
  echo "Provision it first, e.g.: docker pull ${PINNED_IMAGE}" >&2
  exit 1
fi

# Replace the installed deployment with the validated staging directory.
BACKUP_DIR="${REMOTE_DIR}.old"
if [[ -e "${REMOTE_DIR}" ]]; then
  rm -rf -- "${BACKUP_DIR}"
  mv -- "${REMOTE_DIR}" "${BACKUP_DIR}"
fi
mv -- "${STAGING_DIR}" "${REMOTE_DIR}"
rm -rf -- "${BACKUP_DIR}"
REMOTE

# Recreate only Daylight and preserve the already-reviewed image identity.
ssh "${SERVER}" "cd '${REMOTE_DIR}' && docker compose -p daylight up -d --no-deps --pull never daylight-static"
trap - EXIT

echo "Deployment complete. Site should be available at https://daylight.forkstech.com"
