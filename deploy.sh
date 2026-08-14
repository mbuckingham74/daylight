#!/usr/bin/env bash
set -euo pipefail

SERVER="michael@100.120.233.4"
REMOTE_DIR="/home/michael/deployments/daylight"
SOURCE_REPOSITORY="https://github.com/mbuckingham74/daylight.git"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy a dirty worktree." >&2
  exit 1
fi

SOURCE_COMMIT="$(git rev-parse HEAD)"
STAGING_DIR="/home/michael/deployments/.daylight-stage-${SOURCE_COMMIT:0:12}"

cleanup() {
  ssh "${SERVER}" "test ! -d '${STAGING_DIR}' || rm -rf -- '${STAGING_DIR}'"
}
trap cleanup EXIT

echo "Deploying Daylight Map to forkstech.com..."

# Stage the committed artifact without disturbing the live container.
ssh "${SERVER}" "test ! -e '${REMOTE_DIR}' && test ! -e '${STAGING_DIR}' && install -d -m 0700 '${STAGING_DIR}/html'"

# Sync source files
rsync -avz \
  "${PWD}/docker-compose.yml" \
  "${PWD}/nginx.conf" \
  "${SERVER}:${STAGING_DIR}/"

rsync -avz \
  "${PWD}/html/" \
  "${SERVER}:${STAGING_DIR}/html/"

COMPOSE_SHA256="$(shasum -a 256 docker-compose.yml | awk '{print $1}')"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

ssh "${SERVER}" \
  "STAGING_DIR='${STAGING_DIR}' SOURCE_COMMIT='${SOURCE_COMMIT}' SOURCE_REPOSITORY='${SOURCE_REPOSITORY}' COMPOSE_SHA256='${COMPOSE_SHA256}' DEPLOYED_AT='${DEPLOYED_AT}' bash -s" <<'REMOTE'
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
mv -- "${STAGING_DIR}" /home/michael/deployments/daylight
REMOTE

# Recreate only Daylight and preserve the already-reviewed image identity.
ssh "${SERVER}" "cd '${REMOTE_DIR}' && docker compose -p daylight up -d --no-deps --pull never daylight-static"
trap - EXIT

echo "Deployment complete. Site should be available at https://daylight.forkstech.com"
