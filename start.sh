#!/usr/bin/env bash
# Start (and update) prod from registry images, data in ./data: ./start.sh
# Idempotent: a repeat pulls fresh images and recreates only changed containers; a running stack is backed up first (ops/backup.sh).
# Missing in .env → generated: POSTGRES_PASSWORD, PLANAR_SECRET_KEY; PLANAR_DOMAIN defaults to localhost (self-signed TLS).
set -euo pipefail
cd "$(dirname "$0")"

touch .env && chmod 600 .env
# a key is added only if it has no value in .env; existing secrets are never replaced
add() { grep -qE "^$1=.+" .env || { sed -i "/^$1=/d" .env; echo "$1=$2" >>.env; }; }
add COMPOSE_FILE compose.yml:compose.prod.yml
add POSTGRES_PASSWORD "$(openssl rand -hex 24)"
add PLANAR_SECRET_KEY "$(openssl rand -base64 32)"
add PLANAR_DOMAIN localhost

mkdir -p data/postgres data/api data/caddy/data data/caddy/config
docker compose pull
# migrations are not rolled back: back up before the update; on the first start there is no stack yet — nothing to back up
if [ -n "$(docker compose ps -q --status running postgres)" ] && [ -n "$(docker compose ps -q --status running api)" ]; then
  ./ops/backup.sh
fi
# api runs as node in the image: the bind-mounted directory must belong to it
docker compose run --rm --no-deps -T -u root --entrypoint chown api -R node:node /data
docker compose up -d
docker compose ps
