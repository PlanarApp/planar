#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DEV=(docker compose -f compose.dev.yml)

testdb() {
  if [ "$(docker inspect -f '{{.State.Running}}' planar-testdb 2>/dev/null || true)" = true ]; then
    :
  elif docker inspect planar-testdb >/dev/null 2>&1; then
    docker start planar-testdb >/dev/null
  else
    # parallel copies share one container; a race between two creates — the second gets an error and just starts/waits
    # the test database does not need reliability: without fsync DROP DATABASE (checkpoint) does not slow down under host load
    docker run -d --name planar-testdb -p 55432:5432 -e POSTGRES_PASSWORD=postgres \
      pgvector/pgvector:pg18 -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
      >/dev/null 2>&1 || docker start planar-testdb >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 60); do
    docker exec planar-testdb pg_isready -U postgres -h localhost >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "planar-testdb не поднялся" >&2
  return 1
}

# VAPID keys for Web Push: appended to ./.env if they are missing there (no external packages)
vapid() {
  touch .env
  grep -qE '^VAPID_PUBLIC_KEY=.+' .env && grep -qE '^VAPID_PRIVATE_KEY=.+' .env && return 0
  # an incomplete pair is removed so that the keys stay paired
  sed -i '/^VAPID_\(PUBLIC_KEY\|PRIVATE_KEY\|SUBJECT\)=/d' .env
  node -e "
    const {privateKey}=require('crypto').generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const j=privateKey.export({format:'jwk'});
    const b=(s)=>Buffer.from(s,'base64url');
    const pub=Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString('base64url');
    console.log('VAPID_PUBLIC_KEY='+pub+'\nVAPID_PRIVATE_KEY='+j.d+'\nVAPID_SUBJECT=mailto:admin@localhost');
  " >> .env
}

# PLANAR_SECRET_KEY (AES-256-GCM of the GitLab token): appended to ./.env if missing there
secretkey() {
  touch .env
  grep -qE '^PLANAR_SECRET_KEY=.+' .env && return 0
  sed -i '/^PLANAR_SECRET_KEY=/d' .env
  echo "PLANAR_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" >> .env
}

# api starts after up -d: wait for a response through the web proxy
waitapi() {
  for _ in $(seq 1 120); do
    curl -sf "http://localhost:${WEB_PORT:-5173}/api/health" >/dev/null && return 0
    sleep 2
  done
  echo "api не отвечает" >&2
  return 1
}

# seed: api applies migrations on start; wait for /api/health on the api port for up to ~5 min
waitapidirect() {
  for _ in $(seq 1 150); do
    curl -sf "http://localhost:${API_PORT:-3000}/api/health" >/dev/null && return 0
    sleep 2
  done
  echo "api не отвечает (миграции не применены?)" >&2
  return 1
}

# prod-smoke: builds web and api, brings up compose.yml (postgres, api, caddy) in an isolated project,
# seeds the DB, runs e2e/prod through Caddy and stops everything. Ports and project come from env (HTTP_PORT, HTTPS_PORT, COMPOSE_PROJECT_NAME).
prodsmoke() {
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-planar-prod-smoke}"
  export HTTP_PORT="${HTTP_PORT:-8080}" HTTPS_PORT="${HTTPS_PORT:-8443}"
  export PLANAR_SUBNET="${PLANAR_SUBNET:-172.30.0.0/24}" PLANAR_DOMAIN= POSTGRES_PASSWORD=smoke-pg-pass
  export PUBLIC_URL="http://localhost:$HTTP_PORT" COOKIE_SECURE=false
  P=(docker compose -f compose.yml -f compose.build.yml -f deploy/compose.smoke.yml)
  local rc=0
  # the stack's data in a temp dir; its files belong to container users — removed from a container
  SMOKE_TMP="$(mktemp -d)"
  export PLANAR_DATA_DIR="$SMOKE_TMP/data"
  trap '"${P[@]}" down -v --remove-orphans --rmi local >/dev/null 2>&1 || true; docker run --rm -v "$SMOKE_TMP:/t" alpine:3.20 rm -rf /t/data >/dev/null 2>&1 || true; rm -rf "$SMOKE_TMP"' EXIT
  pnpm install --frozen-lockfile || return 1 # for seed and e2e; web is built in the caddy image
  "${P[@]}" up -d --build || return 1
  for _ in $(seq 1 90); do
    curl -sf "$PUBLIC_URL/api/health" >/dev/null && break
    sleep 2
  done
  curl -sf "$PUBLIC_URL/api/health" >/dev/null || { echo "prod-стек не отвечает" >&2; "${P[@]}" logs --tail 40 >&2; return 1; }
  echo "api uid: $("${P[@]}" exec -T api id -u)"
  local img; img="$(docker inspect --format '{{.Image}}' "$("${P[@]}" ps -q api)")"
  echo "api image MB: $(( $(docker image inspect --format '{{.Size}}' "$img") / 1000000 ))"
  local cimg; cimg="$(docker inspect --format '{{.Image}}' "$("${P[@]}" ps -q caddy)")"
  echo "caddy image MB: $(( $(docker image inspect --format '{{.Size}}' "$cimg") / 1000000 ))"
  "${P[@]}" exec -T -e PLANAR_DOMAIN=planar.example.com caddy caddy validate --config /etc/caddy/Caddyfile || return 1
  local pg; pg="$("${P[@]}" port postgres 5432)"
  DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@127.0.0.1:${pg##*:}/planar" pnpm --filter @planar/api seed || return 1
  E2E_BASE_URL="$PUBLIC_URL" pnpm --filter @planar/e2e prod || rc=$?
  [ $rc = 0 ] && echo "prod-smoke: OK"
  return $rc
}

freeport() { node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"; }

# stack <name>: isolated dev stack planar-<name> (task ID) with free ports, its own subnet and an always clean seeded DB.
# Prints export lines for eval: eval "$(./dev.sh stack PJ-3)" → WEB_PORT, API_PORT, DEV_PG_PORT, E2E_BASE_URL, COMPOSE_PROJECT_NAME
stack() {
  [ -n "${1:-}" ] || { echo "usage: ./dev.sh stack <ID> [down]" >&2; return 2; }
  export COMPOSE_PROJECT_NAME
  COMPOSE_PROJECT_NAME="planar-$(printf %s "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' -)"
  if [ "${2:-}" = down ]; then "${DEV[@]}" down -v >&2; return; fi
  # clean DB: drop the stack and only its pgdata volume (node_modules volumes stay — install is fast)
  "${DEV[@]}" down >&2 || return 1
  docker volume rm -f "${COMPOSE_PROJECT_NAME}_pgdata" >/dev/null
  # shortcut: free ports are picked before up, another process may take one in between — rerun the command then
  export WEB_PORT API_PORT DEV_PG_PORT DEV_SUBNET
  WEB_PORT=$(freeport) API_PORT=$(freeport) DEV_PG_PORT=$(freeport)
  local used i n
  used=" $(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' $(docker network ls -q) 2>/dev/null | tr '\n' ' ') "
  n=$(( $(printf %s "$COMPOSE_PROJECT_NAME" | cksum | cut -d' ' -f1) % 256 ))
  for i in $(seq 0 255); do
    DEV_SUBNET="10.240.$(( (n + i) % 256 )).0/24"
    [[ "$used" == *" $DEV_SUBNET "* ]] || break
  done
  "${DEV[@]}" up -d >&2 || return 1
  waitapidirect >&2 || return 1
  "${DEV[@]}" exec -T api pnpm --filter @planar/api seed >&2 || return 1
  waitapi >&2 || return 1
  echo "export COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME WEB_PORT=$WEB_PORT API_PORT=$API_PORT DEV_PG_PORT=$DEV_PG_PORT E2E_BASE_URL=http://localhost:$WEB_PORT"
}

# browser e2e on a fresh isolated stack (DEV_STACK = task ID, default vis): tests start from a clean seeded DB and do not touch dev data
e2eweb() {
  local env rc=0
  env="$(stack "${DEV_STACK:-vis}")" || return 1
  eval "$env"
  pnpm --filter @planar/e2e exec playwright test -c web/playwright.config.ts "$@" || rc=$?
  "${DEV[@]}" stop >/dev/null
  return $rc
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  vapid) vapid; secretkey ;;
  up) vapid; secretkey; "${DEV[@]}" up -d --build ;;
  # up-ai: the same plus ai-runner and squid for agent actions (compose.dev.ai.yml)
  up-ai) vapid; secretkey; "${DEV[@]}" -f compose.dev.ai.yml up -d --build ;;
  down) "${DEV[@]}" -f compose.dev.ai.yml down ;;
  # reset: deletes volumes (DB, node_modules, pnpm store) and brings everything up again
  reset) "${DEV[@]}" down -v && "${DEV[@]}" up -d --build ;;
  seed) waitapidirect && "${DEV[@]}" exec -T api pnpm --filter @planar/api seed "$@" ;;
  logs) "${DEV[@]}" logs -f "$@" ;;
  stack) stack "$@" ;;
  e2e-web) e2eweb "$@" ;;
  e2e) waitapi && E2E_BASE_URL="http://localhost:${WEB_PORT:-5173}" pnpm --filter @planar/e2e test "$@" ;;
  measure) waitapi && E2E_BASE_URL="http://localhost:${WEB_PORT:-5173}" pnpm --filter @planar/e2e measure "$@" ;;
  prod-smoke) prodsmoke ;;
  testdb) testdb ;;
  test) testdb && pnpm test "$@" ;;
  *) echo "usage: ./dev.sh up|up-ai|down|reset|seed|logs|stack|e2e|e2e-web|measure|prod-smoke|test|testdb|vapid" >&2; exit 2 ;;
esac
