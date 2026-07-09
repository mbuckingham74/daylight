#!/usr/bin/env bash
set -euo pipefail

SERVER="michael@100.120.233.4"
REMOTE_DIR="/home/michael/docker-configs/daylight"

echo "Deploying Daylight Map to forkstech.com..."

# Ensure target directory exists
ssh "${SERVER}" "mkdir -p ${REMOTE_DIR}/html"

# Sync source files
rsync -avz --delete \
  "${PWD}/docker-compose.yml" \
  "${SERVER}:${REMOTE_DIR}/"

rsync -avz --delete \
  "${PWD}/html/" \
  "${SERVER}:${REMOTE_DIR}/html/"

# Pull and start the container
ssh "${SERVER}" "cd ${REMOTE_DIR} && docker compose pull && docker compose up -d"

echo "Deployment complete. Site should be available at https://daylight.forkstech.com"
