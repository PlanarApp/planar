#!/usr/bin/env bash
# Start (and update) prod from registry images, data in ./data: ./start.sh
# Idempotent: a repeat pulls fresh images and recreates only changed containers; a running stack is backed up first (ops/backup.sh).
# Missing in .env → generated: POSTGRES_PASSWORD, PLANAR_SECRET_KEY, VAPID keys; PLANAR_DOMAIN defaults to localhost (self-signed TLS).
set -euo pipefail
cd "$(dirname "$0")"

touch .env && chmod 600 .env
# a key is added only if it has no value in .env; existing secrets are never replaced
add() { grep -qE "^$1=.+" .env || { sed -i "/^$1=/d" .env; echo "$1=$2" >>.env; }; }
# compose.prod.yml is gone: compose.yml keeps the data in ./data itself
sed -i '/^COMPOSE_FILE=compose.yml:compose.prod.yml$/d' .env
add POSTGRES_PASSWORD "$(openssl rand -hex 24)"
add PLANAR_SECRET_KEY "$(openssl rand -base64 32)"
add PLANAR_DOMAIN localhost
# Web Push: a P-256 pair (as vapid() in dev.sh, but openssl — no Node on the server); an incomplete pair is replaced
if ! grep -qE '^VAPID_PUBLIC_KEY=.+' .env || ! grep -qE '^VAPID_PRIVATE_KEY=.+' .env; then
  b64u() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
  # SEC1 DER of a P-256 key: the private scalar is bytes 8–39, the uncompressed public point is the last 65
  der=$(openssl ecparam -name prime256v1 -genkey -noout | openssl ec -outform DER 2>/dev/null | base64 -w0)
  sed -i '/^VAPID_\(PUBLIC_KEY\|PRIVATE_KEY\)=/d' .env
  echo "VAPID_PUBLIC_KEY=$(base64 -d <<<"$der" | tail -c 65 | b64u)" >>.env
  echo "VAPID_PRIVATE_KEY=$(base64 -d <<<"$der" | head -c 39 | tail -c 32 | b64u)" >>.env
fi
add VAPID_SUBJECT "mailto:admin@$(grep -oP '^PLANAR_DOMAIN=\K.+' .env)"

docker compose pull
# migrations are not rolled back: back up before the update; on the first start there is no stack yet — nothing to back up
if [ -n "$(docker compose ps -q --status running postgres)" ] && [ -n "$(docker compose ps -q --status running api)" ]; then
  ./ops/backup.sh
fi
docker compose up -d
docker compose ps
